import { pool } from '../core/database';

export interface Submission {
  expenseId: string;
  organizationId: string;
  connectionId: string;
  status: string;
}

const LOCK_DURATION_MS = 10 * 60 * 1000;

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
): Promise<void> {
  await pool.query(
    `WITH updated_expense AS (
       UPDATE expenses
       SET odoo_id = $3, status = $4::expenses_status_enum, total = $5, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2
     )
     UPDATE expense_submissions
     SET status = 'sent', sent_at = now(), locked_until = NULL, next_attempt_at = NULL,
         last_error_code = NULL, last_error_message = NULL, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId, odooId, expenseStatus, total],
  );
}

export async function markRejected(
  organizationId: string,
  expenseId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `WITH updated_submission AS (
       UPDATE expense_submissions
       SET status = 'failed', locked_until = NULL, next_attempt_at = NULL,
           last_error_code = $3, last_error_message = $4, updated_at = now()
       WHERE organization_id = $1 AND expense_id = $2 AND status IN ('pending', 'sending')
       RETURNING expense_id
     )
     UPDATE expenses
     SET status = 'draft', updated_at = now()
     WHERE organization_id = $1 AND status = 'submitted'
       AND expense_id IN (SELECT expense_id FROM updated_submission)`,
    [organizationId, expenseId, errorCode, errorMessage],
  );
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
     WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId, errorCode, errorMessage, nextAttemptAt],
  );
}
