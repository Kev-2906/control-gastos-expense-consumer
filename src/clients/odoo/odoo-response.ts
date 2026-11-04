import { ExpenseRejectedError, RetryLaterError } from '../../core/errors';

export const NO_RESPONSE_STATUS = 0;

const SERIALIZATION_FAILURE = 'could not serialize access';
const REJECTED_CODE = 'ODOO_REJECTED';
const INVALID_RESPONSE_CODE = 'ODOO_INVALID_RESPONSE';
const CONCURRENCY_CODE = 'ODOO_CONCURRENCY';

export function parseResponse(statusCode: number, body: string): unknown {
  if (statusCode === NO_RESPONSE_STATUS) {
    throw new RetryLaterError('ODOO_UNREACHABLE', 'Odoo server could not be reached', true);
  }
  if (statusCode === 401) {
    throw new RetryLaterError('ODOO_INVALID_API_KEY', 'The Odoo API key was rejected');
  }
  if (statusCode === 403) {
    throw new RetryLaterError('ODOO_ADMIN_REQUIRED', 'The Odoo API key lacks permissions');
  }
  if (statusCode === 413) {
    throw new ExpenseRejectedError(
      'ODOO_PAYLOAD_TOO_LARGE',
      'The Odoo server rejected a receipt because it is too large',
    );
  }
  if (statusCode >= 200 && statusCode < 300) return parseSuccessBody(body);

  const odooMessage = errorMessageOf(body);
  if (statusCode === 409) {
    throw new RetryLaterError(CONCURRENCY_CODE, odooMessage ?? 'Odoo reported a conflict');
  }
  if (statusCode === 429 || statusCode >= 500) {
    throw new RetryLaterError(
      'ODOO_TEMPORARY',
      odooMessage ?? `Odoo responded with status ${statusCode}`,
      true,
    );
  }
  if (!odooMessage) {
    throw new RetryLaterError(INVALID_RESPONSE_CODE, `Odoo responded with status ${statusCode}`);
  }
  throw new ExpenseRejectedError(REJECTED_CODE, odooMessage);
}

export function parseLoadResponse(response: unknown): number {
  const { ids, messages } = (response ?? {}) as {
    ids?: number[] | false;
    messages?: { message?: string }[];
  };
  if (Array.isArray(ids) && typeof ids[0] === 'number') return ids[0];

  const odooMessage = (messages ?? []).map(({ message }) => message).join('; ');
  if (odooMessage.includes(SERIALIZATION_FAILURE)) {
    throw new RetryLaterError(CONCURRENCY_CODE, odooMessage);
  }
  if (!odooMessage) {
    throw new RetryLaterError(INVALID_RESPONSE_CODE, 'Odoo load returned no ids and no messages');
  }
  throw new ExpenseRejectedError(REJECTED_CODE, odooMessage);
}

export function parseCreateResponse(response: unknown): number {
  if (Array.isArray(response) && typeof response[0] === 'number') return response[0];
  throw new RetryLaterError(INVALID_RESPONSE_CODE, 'Odoo create returned no id');
}

function parseSuccessBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RetryLaterError(
      INVALID_RESPONSE_CODE,
      'Odoo responded with something that is not JSON',
    );
  }
}

function errorMessageOf(body: string): string | undefined {
  try {
    const { message } = JSON.parse(body) as { message?: unknown };
    return typeof message === 'string' ? message : undefined;
  } catch {
    return undefined;
  }
}
