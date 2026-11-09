import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../core/config';

const CONNECTION_SETTINGS = `
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;
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

const database = new DatabaseSync(config.ODOO_AUDIT_DB_PATH);
database.exec(CONNECTION_SETTINGS);
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
