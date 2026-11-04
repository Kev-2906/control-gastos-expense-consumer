import { pool } from '../core/database';

export interface OdooConnection {
  connectionId: string;
  baseUrl: string;
  dbName: string;
  apiKeyEncrypted: string;
  status: string;
  sendsPausedUntil: Date | null;
}

export async function find(
  organizationId: string,
  connectionId: string,
): Promise<OdooConnection | null> {
  const { rows } = await pool.query<OdooConnection>(
    `SELECT
       connection_id AS "connectionId",
       base_url AS "baseUrl",
       db_name AS "dbName",
       api_key_encrypted AS "apiKeyEncrypted",
       status,
       sends_paused_until AS "sendsPausedUntil"
     FROM odoo_connections
     WHERE organization_id = $1 AND connection_id = $2`,
    [organizationId, connectionId],
  );
  return rows[0] ?? null;
}

export async function pauseSends(
  organizationId: string,
  connectionId: string,
  until: Date,
): Promise<void> {
  await pool.query(
    `UPDATE odoo_connections SET sends_paused_until = $3, updated_at = now()
     WHERE organization_id = $1 AND connection_id = $2`,
    [organizationId, connectionId, until],
  );
}
