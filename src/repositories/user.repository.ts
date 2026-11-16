import { PoolClient } from 'pg';
import { Recipient } from './notification.repository';

export async function findActiveAdmins(
  client: PoolClient,
  organizationId: string,
): Promise<Recipient[]> {
  const { rows } = await client.query<Recipient>(
    `SELECT u.user_id AS "userId", u.email, u.name, u.status
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.organization_id = $1 AND u.status = 'active' AND r.role_name = 'TENANT_ADMIN'`,
    [organizationId],
  );
  return rows;
}
