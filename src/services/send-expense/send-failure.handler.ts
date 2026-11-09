import { ExpenseRejectedError, RetryLaterError } from '../../core/errors';
import * as submissions from '../../repositories/expense-submission.repository';
import { Submission } from '../../repositories/expense-submission.repository';
import * as connections from '../../repositories/odoo-connection.repository';
import { ExpenseSubmitted } from './send-expense.service';

const RETRIES_EXHAUSTED_CODE = 'ODOO_RETRIES_EXHAUSTED';
const UNEXPECTED_ERROR_CODE = 'UNEXPECTED_ERROR';
const CONNECTION_PAUSE_MS = 4 * 60 * 1000;
const MIN_RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

export async function handleSendFailure(
  { organizationId, expenseId, connectionId }: Submission,
  error: unknown,
  previousFailures: number,
): Promise<void> {
  if (error instanceof ExpenseRejectedError) {
    await submissions.markRejected(organizationId, expenseId, error.code, error.message);
    return;
  }
  const nextAttemptAt = new Date(Date.now() + retryDelayMs(previousFailures + 1));
  if (error instanceof RetryLaterError) {
    await submissions.scheduleRetry(
      organizationId,
      expenseId,
      error.code,
      error.message,
      nextAttemptAt,
    );
    if (error.pausesConnection) {
      await connections.pauseSends(
        organizationId,
        connectionId,
        new Date(Date.now() + CONNECTION_PAUSE_MS),
      );
    }
  } else {
    await releaseAfterUnexpectedError(organizationId, expenseId, error, nextAttemptAt);
  }
  throw error;
}

async function releaseAfterUnexpectedError(
  organizationId: string,
  expenseId: string,
  error: unknown,
  nextAttemptAt: Date,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    await submissions.scheduleRetry(
      organizationId,
      expenseId,
      UNEXPECTED_ERROR_CODE,
      reason,
      nextAttemptAt,
    );
  } catch (scheduleError) {
    console.error(
      `Could not release expense ${expenseId} after an unexpected error: ${String(scheduleError)}`,
    );
  }
}

export async function handleRetriesExhausted(
  { organizationId, expenseId }: ExpenseSubmitted,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Expense ${expenseId} ran out of retries and goes to the dead letter queue`);

  try {
    await submissions.markRejected(
      organizationId,
      expenseId,
      RETRIES_EXHAUSTED_CODE,
      `Retries exhausted: ${reason}`,
    );
  } catch (markError) {
    console.error(`Could not mark expense ${expenseId} as failed: ${String(markError)}`);
  }
}

function retryDelayMs(failures: number): number {
  return Math.min(MIN_RETRY_DELAY_MS * failures, MAX_RETRY_DELAY_MS);
}
