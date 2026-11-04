import { Channel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import { ExpenseSubmitted, sendExpense } from '../services/send-expense/send-expense.service';
import { handleRetriesExhausted } from '../services/send-expense/send-failure.handler';

export const EXPENSE_SEND_DELIVERY_LIMIT = 173;

const FAILURES_IN_A_DAY = 29;

const expenseSubmittedSchema = z.object({
  expenseId: z.uuid(),
  organizationId: z.uuid(),
});

export async function handleExpenseSubmitted(
  channel: Channel,
  message: ConsumeMessage,
): Promise<void> {
  const event = parseEvent(message);
  if (!event) {
    console.error('Discarded an invalid expense submitted message');
    channel.nack(message, false, false);
    return;
  }

  const previousFailures = Number(message.properties.headers?.['x-delivery-count'] ?? 0);
  try {
    await sendExpense(event, previousFailures);
    channel.ack(message);
  } catch (error) {
    logDeferred(event, error, previousFailures);

    const isLastAttempt = previousFailures >= EXPENSE_SEND_DELIVERY_LIMIT;
    if (isLastAttempt) await handleRetriesExhausted(event, error);
    channel.reject(message, !isLastAttempt);
  }
}

function parseEvent(message: ConsumeMessage): ExpenseSubmitted | null {
  try {
    const event = expenseSubmittedSchema.safeParse(JSON.parse(message.content.toString()));
    return event.success ? event.data : null;
  } catch {
    return null;
  }
}

function logDeferred(
  { expenseId }: ExpenseSubmitted,
  error: unknown,
  previousFailures: number,
): void {
  const reason = error instanceof Error ? error.message : String(error);
  const description = `Expense ${expenseId} deferred after ${previousFailures + 1} failures: ${reason}`;

  if (previousFailures + 1 >= FAILURES_IN_A_DAY) console.error(description);
  else console.warn(description);
}
