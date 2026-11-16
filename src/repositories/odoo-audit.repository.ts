import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { auditPool } from '../core/audit-database';
import { RetryLaterError } from '../core/errors';

const INSERT = `
  INSERT INTO odoo_audit_logs (
    correlation_id, organization_id, connection_id, expense_id, endpoint, http_method,
    status_code, request_payload, response_payload, duration_ms, operation_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

const FILE_CONTENT_FIELD = 'datas';
const AUDIT_UNAVAILABLE_CODE = 'AUDIT_UNAVAILABLE';
const RETRY_DELAYS_MS = [500, 1_500];

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

export async function ensureAuditAvailable(): Promise<void> {
  try {
    await auditPool.query('SELECT 1');
  } catch (error) {
    throw auditUnavailable(error);
  }
}

export async function recordOdooCall(record: OdooCallRecord): Promise<void> {
  const values = [
    record.correlationId,
    record.organizationId,
    record.connectionId,
    record.expenseId,
    record.endpoint,
    record.httpMethod,
    record.statusCode,
    record.requestPayload,
    record.responsePayload,
    record.durationMs,
    record.operationAt,
  ];
  for (let attempt = 0; ; attempt += 1) {
    try {
      await auditPool.query(INSERT, values);
      return;
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw auditUnavailable(error);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export function toAuditPayload(body: Record<string, unknown>): string {
  return JSON.stringify(body, (key, value: unknown) =>
    key === FILE_CONTENT_FIELD && typeof value === 'string' ? describeFile(value) : value,
  );
}

function auditUnavailable(error: unknown): RetryLaterError {
  const reason = error instanceof Error ? error.message : String(error);
  return new RetryLaterError(
    AUDIT_UNAVAILABLE_CODE,
    `The audit database is not available: ${reason}`,
  );
}

function describeFile(base64Content: string): { sizeBytes: number; sha256: string } {
  const content = Buffer.from(base64Content, 'base64');
  return {
    sizeBytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}
