import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool } from '../core/database';

const NOTIFICATIONS_CHANNEL = 'notifications';

export interface NotificationData {
  expenseDescription: string | null;
  total: number | null;
  currency: string | null;
  paymentMode: string;
  status: string;
  previousStatus: string | null;
}

export async function create(
  client: PoolClient,
  organizationId: string,
  userId: string,
  expenseId: string,
  type: string,
  data: NotificationData,
): Promise<string> {
  const notificationId = randomUUID();
  await client.query(
    `INSERT INTO notifications (notification_id, organization_id, user_id, expense_id, type, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [notificationId, organizationId, userId, expenseId, type, JSON.stringify(data)],
  );
  await client.query('SELECT pg_notify($1, $2)', [
    NOTIFICATIONS_CHANNEL,
    JSON.stringify({ organizationId, userId, notificationId }),
  ]);
  return notificationId;
}

export async function markEmailed(organizationId: string, notificationId: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET emailed_at = now(), updated_at = now()
     WHERE organization_id = $1 AND notification_id = $2`,
    [organizationId, notificationId],
  );
}
