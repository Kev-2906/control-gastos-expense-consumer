import { randomUUID } from 'node:crypto';
import { RetryLaterError } from '../../core/errors';
import { recordOdooCall, toAuditPayload } from '../../repositories/odoo-audit.repository';
import { NO_RESPONSE_STATUS, parseResponse } from './odoo-response';

const HTTP_METHOD = 'POST';
const READ_TIMEOUT_MS = 10_000;

export const WRITE_TIMEOUT_MS = 120_000;

export interface OdooSession {
  baseUrl: string;
  dbName: string;
  apiKey: string;
  organizationId: string;
  connectionId: string;
  expenseId: string;
  companyOdooId: number;
}

export class OdooHttpClient {
  readonly context: Record<string, unknown>;

  constructor(readonly session: OdooSession) {
    this.context = { allowed_company_ids: [session.companyOdooId] };
  }

  async searchRead<T>(model: string, query: Record<string, unknown>): Promise<T[]> {
    const response = await this.call(model, 'search_read', query);
    if (!Array.isArray(response)) {
      throw new RetryLaterError(
        'ODOO_INVALID_RESPONSE',
        `Odoo search on ${model} returned no list`,
      );
    }
    return response as T[];
  }

  async call(
    model: string,
    method: string,
    body: Record<string, unknown>,
    timeoutMs = READ_TIMEOUT_MS,
  ): Promise<unknown> {
    const endpoint = `${this.session.baseUrl}/json/2/${model}/${method}`;
    const operationAt = new Date().toISOString();
    const startedAt = performance.now();

    const { statusCode, responsePayload } = await this.post(endpoint, body, timeoutMs);

    recordOdooCall({
      correlationId: randomUUID(),
      organizationId: this.session.organizationId,
      connectionId: this.session.connectionId,
      expenseId: this.session.expenseId,
      endpoint,
      httpMethod: HTTP_METHOD,
      statusCode,
      requestPayload: toAuditPayload(body),
      responsePayload,
      durationMs: Math.round(performance.now() - startedAt),
      operationAt,
    });
    return parseResponse(statusCode, responsePayload);
  }

  private async post(
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ statusCode: number; responsePayload: string }> {
    try {
      const response = await fetch(endpoint, {
        method: HTTP_METHOD,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.session.apiKey}`,
          'X-Odoo-Database': this.session.dbName,
        },
        body: JSON.stringify(body),
      });
      return { statusCode: response.status, responsePayload: await response.text() };
    } catch (error) {
      return {
        statusCode: NO_RESPONSE_STATUS,
        responsePayload: JSON.stringify({
          error: 'ODOO_UNREACHABLE',
          detail: networkFailureOf(error),
        }),
      };
    }
  }
}

function networkFailureOf(error: unknown): string {
  const { name, cause } = error as { name?: string; cause?: { code?: string; message?: string } };
  return cause?.code ?? cause?.message ?? name ?? 'UNKNOWN';
}
