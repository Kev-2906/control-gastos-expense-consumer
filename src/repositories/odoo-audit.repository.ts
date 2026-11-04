import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../core/config';

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS odoo_audit_logs (
    correlation_id   TEXT PRIMARY KEY,
    organization_id  TEXT NOT NULL,
    connection_id    TEXT NOT NULL,
    expense_id       TEXT NOT NULL,
    endpoint         TEXT NOT NULL,
    http_method      TEXT NOT NULL,
    status_code      INTEGER NOT NULL,
    request_payload  TEXT NOT NULL,
    response_payload TEXT NOT NULL,
    duration_ms      INTEGER NOT NULL,
    operation_at     TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS IDX_odoo_audit_logs_organization_created
    ON odoo_audit_logs (organization_id, created_at);

  CREATE TRIGGER IF NOT EXISTS odoo_audit_logs_no_update
    BEFORE UPDATE ON odoo_audit_logs
    BEGIN SELECT RAISE(ABORT, 'odoo_audit_logs only accepts new records'); END;

  CREATE TRIGGER IF NOT EXISTS odoo_audit_logs_no_delete
    BEFORE DELETE ON odoo_audit_logs
    BEGIN SELECT RAISE(ABORT, 'odoo_audit_logs only accepts new records'); END;
`;

const INSERT = `
  INSERT INTO odoo_audit_logs (
    correlation_id, organization_id, connection_id, expense_id, endpoint, http_method,
    status_code, request_payload, response_payload, duration_ms, operation_at
  ) VALUES (
    :correlationId, :organizationId, :connectionId, :expenseId, :endpoint, :httpMethod,
    :statusCode, :requestPayload, :responsePayload, :durationMs, :operationAt
  )
`;

const FILE_CONTENT_FIELD = 'datas';

export interface OdooCallRecord {
  correlationId: string;
  organizationId: string;
  connectionId: string;
  expenseId: string;
  endpoint: string;
  httpMethod: string;
  statusCode: number;
  requestPayload: string;
  responsePayload: string;
  durationMs: number;
  operationAt: string;
}

mkdirSync(dirname(config.ODOO_AUDIT_DB_PATH), { recursive: true });
const database = new DatabaseSync(config.ODOO_AUDIT_DB_PATH);
database.exec(SCHEMA);
const insert = database.prepare(INSERT);

export function recordOdooCall(record: OdooCallRecord): void {
  insert.run({ ...record });
}

export function closeAudit(): void {
  database.close();
}

export function toAuditPayload(body: Record<string, unknown>): string {
  return JSON.stringify(body, (key, value: unknown) =>
    key === FILE_CONTENT_FIELD && typeof value === 'string' ? describeFile(value) : value,
  );
}

function describeFile(base64Content: string): { sizeBytes: number; sha256: string } {
  const content = Buffer.from(base64Content, 'base64');
  return {
    sizeBytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
