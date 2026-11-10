import { pool, transaction } from '../core/database';
import * as statusLogs from './expense-status-log.repository';
import * as notifications from './notification.repository';
import { NotificationData } from './notification.repository';

export interface Submission {
  expenseId: string;
  organizationId: string;
  connectionId: string;
  status: string;
}

const LOCK_DURATION_MS = 10 * 60 * 1000;
const EXPENSE_SENT_NOTIFICATION = 'expense_sent';

export interface ExpenseSentNotice {
  organizationId: string;
  expenseId: string;
  notificationId: string;
  recipient: { email: string; name: string } | null;
  type: string;
  data: NotificationData;
}

interface SentExpenseRow {
  status: string;
  description: string | null;
  paymentMode: string;
  currency: string | null;
  userId: string;
  email: string;
  name: string;
  userStatus: string;
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
    `UPDATE expense_submissions SET published_at = now(), updated_at = now()
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
): Promise<ExpenseSentNotice | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<SentExpenseRow>(
      `SELECT e.status, e.description, e.payment_mode AS "paymentMode", c.name AS currency,
              u.user_id AS "userId", u.email, u.name, u.status AS "userStatus"
       FROM expenses e
       JOIN reporters r ON r.reporter_id = e.reporter_id AND r.organization_id = e.organization_id
       JOIN users u ON u.user_id = r.user_id AND u.organization_id = r.organization_id
       LEFT JOIN currencies c ON c.currency_id = e.currency_id
       WHERE e.organization_id = $1 AND e.expense_id = $2
       FOR UPDATE OF e`,
      [organizationId, expenseId],
    );
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

    const expense = rows[0];
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

    const data: NotificationData = {
      expenseDescription: expense.description,
      total,
      currency: expense.currency,
      paymentMode: expense.paymentMode,
      status: expenseStatus,
      previousStatus: expense.status,
    };
    const notificationId = await notifications.create(
      client,
      organizationId,
      expense.userId,
      expenseId,
      EXPENSE_SENT_NOTIFICATION,
      data,
    );
    return {
      organizationId,
      expenseId,
      notificationId,
      recipient:
        expense.userStatus === 'active' ? { email: expense.email, name: expense.name } : null,
      type: EXPENSE_SENT_NOTIFICATION,
      data,
    };
  });
}

export async function markRejected(
  organizationId: string,
  expenseId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await transaction(async (client) => {
    const failed = await client.query(
      `UPDATE expense_submissions
       SET status = 'failed', locked_until = NULL, next_attempt_at = NULL,
           last_error_code = $3, last_error_message = $4, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2 AND status IN ('pending', 'sending')`,
      [organizationId, expenseId, errorCode, errorMessage],
    );
    if (failed.rowCount === 0) return;

    const returned = await client.query(
      `UPDATE expenses
       SET status = 'draft', updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2 AND status = 'submitted'`,
      [organizationId, expenseId],
    );
    if (returned.rowCount === 0) return;

    await statusLogs.create(client, organizationId, expenseId, 'submitted', 'draft', 'portal');
  });
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
