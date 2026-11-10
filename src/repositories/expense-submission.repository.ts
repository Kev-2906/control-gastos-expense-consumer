import { PoolClient } from 'pg';
import { pool, transaction } from '../core/database';
import * as statusLogs from './expense-status-log.repository';
import * as notifications from './notification.repository';
import { Notice, Recipient } from './notification.repository';

export interface Submission {
  expenseId: string;
  organizationId: string;
  connectionId: string;
  status: string;
}

const LOCK_DURATION_MS = 10 * 60 * 1000;
const EXPENSE_SENT_NOTIFICATION = 'expense_sent';
const EXPENSE_SEND_FAILED_NOTIFICATION = 'expense_send_failed';

interface ExpenseForNotice {
  status: string;
  description: string | null;
  paymentMode: string;
  currency: string | null;
  reporter: Recipient;
}

const COLUMNS = `
  expense_id AS "expenseId",
  organization_id AS "organizationId",
  connection_id AS "connectionId",
  status
`;

export async function find(organizationId: string, expenseId: string): Promise<Submission | null> {
  const { rows } = await pool.query<Submission>(
    `SELECT ${COLUMNS} FROM expense_submissions WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId],
  );
  return rows[0] ?? null;
}

export async function findUnpublished(limit: number): Promise<Submission[]> {
  const { rows } = await pool.query<Submission>(
    `SELECT ${COLUMNS} FROM expense_submissions
     WHERE status = 'pending' AND published_at IS NULL
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function markPublished(organizationId: string, expenseId: string): Promise<void> {
  await pool.query(
    `UPDATE expense_submissions SET published_at = now(), stuck_notified_at = NULL, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId],
  );
}

export async function claim(organizationId: string, expenseId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE expense_submissions
     SET status = 'sending', attempts = attempts + 1, locked_until = $3, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2
       AND (status = 'pending' OR (status = 'sending' AND locked_until < now()))`,
    [organizationId, expenseId, lockExpiration()],
  );
  return (rowCount ?? 0) > 0;
}

export async function renewLock(organizationId: string, expenseId: string): Promise<void> {
  await pool.query(
    `UPDATE expense_submissions SET locked_until = $3, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId, lockExpiration()],
  );
}

function lockExpiration(): Date {
  return new Date(Date.now() + LOCK_DURATION_MS);
}

export async function markSent(
  organizationId: string,
  expenseId: string,
  odooId: number,
  expenseStatus: string,
  total: number,
): Promise<Notice | null> {
  return transaction(async (client) => {
    const expense = await findForNotice(client, organizationId, expenseId);
    await client.query(
      `UPDATE expenses
       SET odoo_id = $3, status = $4::expenses_status_enum, total = $5, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2`,
      [organizationId, expenseId, odooId, expenseStatus, total],
    );
    await client.query(
      `UPDATE expense_submissions
       SET status = 'sent', sent_at = now(), locked_until = NULL, next_attempt_at = NULL,
           last_error_code = NULL, last_error_message = NULL, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2`,
      [organizationId, expenseId],
    );
    if (!expense) return null;

    if (expense.status !== expenseStatus) {
      await statusLogs.create(
        client,
        organizationId,
        expenseId,
        expense.status,
        expenseStatus,
        'odoo',
      );
    }
    return notifications.create(
      client,
      organizationId,
      expense.reporter,
      expenseId,
      EXPENSE_SENT_NOTIFICATION,
      {
        expenseDescription: expense.description,
        total,
        currency: expense.currency,
        paymentMode: expense.paymentMode,
        status: expenseStatus,
        previousStatus: expense.status,
      },
    );
  });
}

export async function markRejected(
  organizationId: string,
  expenseId: string,
  errorCode: string,
  errorMessage: string,
): Promise<Notice | null> {
  return transaction(async (client) => {
    const failed = await client.query(
      `UPDATE expense_submissions
       SET status = 'failed', locked_until = NULL, next_attempt_at = NULL,
           last_error_code = $3, last_error_message = $4, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2 AND status IN ('pending', 'sending')`,
      [organizationId, expenseId, errorCode, errorMessage],
    );
    if (failed.rowCount === 0) return null;

    const expense = await findForNotice(client, organizationId, expenseId);
    const returned = await client.query(
      `UPDATE expenses
       SET status = 'draft', updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2 AND status = 'submitted'`,
      [organizationId, expenseId],
    );
    if (returned.rowCount === 0 || !expense) return null;

    await statusLogs.create(client, organizationId, expenseId, 'submitted', 'draft', 'portal');
    return notifications.create(
      client,
      organizationId,
      expense.reporter,
      expenseId,
      EXPENSE_SEND_FAILED_NOTIFICATION,
      {
        expenseDescription: expense.description,
        total: expense.total,
        currency: expense.currency,
        paymentMode: expense.paymentMode,
        status: 'draft',
        previousStatus: 'submitted',
        errorCode,
      },
    );
  });
}

export async function countWaitingByReporter(
  client: PoolClient,
  organizationId: string,
  connectionId: string,
): Promise<(Recipient & { count: number })[]> {
  const { rows } = await client.query<Recipient & { count: number }>(
    `SELECT u.user_id AS "userId", u.email, u.name, u.status, COUNT(*)::int AS count
     FROM expense_submissions s
     JOIN expenses e ON e.expense_id = s.expense_id AND e.organization_id = s.organization_id
     JOIN reporters r ON r.reporter_id = e.reporter_id AND r.organization_id = e.organization_id
     JOIN users u ON u.user_id = r.user_id AND u.organization_id = r.organization_id
     WHERE s.organization_id = $1 AND s.connection_id = $2 AND s.status IN ('pending', 'sending')
     GROUP BY u.user_id, u.email, u.name, u.status`,
    [organizationId, connectionId],
  );
  return rows;
}

async function findForNotice(
  client: PoolClient,
  organizationId: string,
  expenseId: string,
): Promise<(ExpenseForNotice & { total: number | null }) | null> {
  const { rows } = await client.query<{
    status: string;
    description: string | null;
    paymentMode: string;
    currency: string | null;
    total: number | null;
    userId: string;
    email: string;
    name: string;
    userStatus: string;
  }>(
    `SELECT e.status, e.description, e.payment_mode AS "paymentMode", c.name AS currency,
            e.total::float8 AS total, u.user_id AS "userId", u.email, u.name, u.status AS "userStatus"
     FROM expenses e
     JOIN reporters r ON r.reporter_id = e.reporter_id AND r.organization_id = e.organization_id
     JOIN users u ON u.user_id = r.user_id AND u.organization_id = r.organization_id
     LEFT JOIN currencies c ON c.currency_id = e.currency_id
     WHERE e.organization_id = $1 AND e.expense_id = $2
     FOR UPDATE OF e`,
    [organizationId, expenseId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    status: row.status,
    description: row.description,
    paymentMode: row.paymentMode,
    currency: row.currency,
    total: row.total,
    reporter: { userId: row.userId, email: row.email, name: row.name, status: row.userStatus },
  };
}

export async function scheduleRetry(
  organizationId: string,
  expenseId: string,
  errorCode: string,
  errorMessage: string,
  nextAttemptAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE expense_submissions
     SET status = 'pending', locked_until = NULL, next_attempt_at = $5,
         last_error_code = $3, last_error_message = $4, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2 AND status = 'sending'`,
    [organizationId, expenseId, errorCode, errorMessage, nextAttemptAt],
  );
}
