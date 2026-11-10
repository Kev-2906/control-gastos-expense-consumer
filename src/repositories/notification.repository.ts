import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool } from '../core/database';

const NOTIFICATIONS_CHANNEL = 'notifications';
const ACTIVE_USER = 'active';

export interface NotificationData {
  expenseDescription?: string | null;
  total?: number | null;
  currency?: string | null;
  paymentMode?: string | null;
  status?: string | null;
  previousStatus?: string | null;
  errorCode?: string | null;
  count?: number;
  connectionName?: string;
}

export interface Recipient {
  userId: string;
  email: string;
  name: string;
  status: string;
}

export interface Notice {
  organizationId: string;
  notificationId: string;
  expenseId: string | null;
  recipient: { email: string; name: string } | null;
  type: string;
  data: NotificationData;
}

export async function create(
  client: PoolClient,
  organizationId: string,
  recipient: Recipient,
  expenseId: string | null,
  type: string,
  data: NotificationData,
): Promise<Notice> {
  const notificationId = randomUUID();
  await client.query(
    `INSERT INTO notifications (notification_id, organization_id, user_id, expense_id, type, data)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [notificationId, organizationId, recipient.userId, expenseId, type, JSON.stringify(data)],
  );
  await client.query('SELECT pg_notify($1, $2)', [
    NOTIFICATIONS_CHANNEL,
    JSON.stringify({ organizationId, userId: recipient.userId, notificationId }),
  ]);
  return {
    organizationId,
    notificationId,
    expenseId,
    recipient:
      recipient.status === ACTIVE_USER ? { email: recipient.email, name: recipient.name } : null,
    type,
    data,
  };
}

export async function markEmailed(
  organizationId: string,
  notificationIds: string[],
): Promise<void> {
  if (notificationIds.length === 0) return;
  await pool.query(
    `UPDATE notifications SET emailed_at = now(), updated_at = now()
     WHERE organization_id = $1 AND notification_id = ANY($2::uuid[])`,
    [organizationId, notificationIds],
  );
}
