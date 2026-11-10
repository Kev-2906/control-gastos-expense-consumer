import { randomUUID } from 'node:crypto';
import { Channel, ConfirmChannel } from 'amqplib';
import { connection } from './connection';
import { closeEmailChannel } from './email-publisher';
import {
  EXPENSE_SEND_DELIVERY_LIMIT,
  handleExpenseSubmitted,
} from './consumers/expense-submitted.consumer';
import { publishPending } from '../services/publish-pending.service';
import { ExpenseSubmitted } from '../services/send-expense/send-expense.service';

const EXPENSES_EXCHANGE = 'portal.expenses';
const DEAD_LETTER_EXCHANGE = 'portal.expenses.dead-letter';
const EXPENSE_SUBMITTED_ROUTING_KEY = 'expense.submitted';
const EXPENSE_SEND_QUEUE = 'backend.expense-send';
const EXPENSE_SEND_DEAD_QUEUE = 'backend.expense-send.dead';
const PREFETCH = 5;
const PUBLISH_CONFIRM_TIMEOUT_MS = 5_000;

const channelWrapper = connection.createChannel({
  setup: async (channel: ConfirmChannel) => {
    await declareTopology(channel);
    await channel.prefetch(PREFETCH);
    await channel.consume(EXPENSE_SEND_QUEUE, (message) => {
      if (!message) return;
      handleExpenseSubmitted(channel, message).catch((error: unknown) =>
        console.error(`Could not settle a message: ${String(error)}`),
      );
    });
  },
});

let publishing = false;

export function startConsuming(): void {
  connection.on('connect', () => void publishPendingOnce());
  connection.on('disconnect', ({ err }) => console.warn(`RabbitMQ disconnected: ${err?.message}`));
}

export async function stopConsuming(): Promise<void> {
  await channelWrapper.close();
  await closeEmailChannel();
  await connection.close();
}

async function declareTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXPENSES_EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });

  await channel.assertQueue(EXPENSE_SEND_DEAD_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(EXPENSE_SEND_DEAD_QUEUE, DEAD_LETTER_EXCHANGE, '#');

  await channel.assertQueue(EXPENSE_SEND_QUEUE, {
    durable: true,
    deadLetterExchange: DEAD_LETTER_EXCHANGE,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': EXPENSE_SEND_DELIVERY_LIMIT,
      'x-delayed-retry-type': 'failed',
      'x-delayed-retry-min': 5 * 60 * 1000,
      'x-delayed-retry-max': 60 * 60 * 1000,
      'x-consumer-timeout': 2 * 60 * 60 * 1000,
    },
  });
  await channel.bindQueue(EXPENSE_SEND_QUEUE, EXPENSES_EXCHANGE, EXPENSE_SUBMITTED_ROUTING_KEY);
}

async function publishPendingOnce(): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    const published = await publishPending(publishExpenseSubmitted);
    if (published > 0) console.info(`Published ${published} pending expense submissions`);
  } catch (error) {
    console.error(`Could not publish the pending expense submissions: ${String(error)}`);
  } finally {
    publishing = false;
  }
}

async function publishExpenseSubmitted(event: ExpenseSubmitted): Promise<void> {
  await channelWrapper.publish(
    EXPENSES_EXCHANGE,
    EXPENSE_SUBMITTED_ROUTING_KEY,
    Buffer.from(JSON.stringify(event)),
    {
      persistent: true,
      messageId: randomUUID(),
      contentType: 'application/json',
      timeout: PUBLISH_CONFIRM_TIMEOUT_MS,
    },
  );
}
