import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

export async function create(
  client: PoolClient,
  organizationId: string,
  expenseId: string,
  fromStatus: string,
  toStatus: string,
  source: 'portal' | 'odoo',
): Promise<void> {
  await client.query(
    `INSERT INTO expense_status_logs
       (expense_status_log_id, organization_id, expense_id, from_status, to_status, source, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [randomUUID(), organizationId, expenseId, fromStatus, toStatus, source],
  );
}
