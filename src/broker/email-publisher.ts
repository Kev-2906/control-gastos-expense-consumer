import { randomUUID } from 'node:crypto';
import { ConfirmChannel } from 'amqplib';
import { connection } from './connection';

const NOTIFICATIONS_EXCHANGE = 'portal.notifications';
const PUBLISH_CONFIRM_TIMEOUT_MS = 5_000;

export interface EmailRequest {
  template: string;
  to: { email: string; name: string };
  data: unknown;
}

const emailChannel = connection.createChannel({
  setup: async (channel: ConfirmChannel) => {
    await channel.assertExchange(NOTIFICATIONS_EXCHANGE, 'topic', { durable: true });
  },
});

export async function publishEmailRequest({ template, to, data }: EmailRequest): Promise<void> {
  const messageId = randomUUID();
  const type = `email.${template}`;
  await emailChannel.publish(
    NOTIFICATIONS_EXCHANGE,
    type,
    Buffer.from(JSON.stringify({ messageId, type, createdAt: new Date().toISOString(), to, data })),
    {
      persistent: true,
      messageId,
      contentType: 'application/json',
      timeout: PUBLISH_CONFIRM_TIMEOUT_MS,
    },
  );
}

export async function closeEmailChannel(): Promise<void> {
  await emailChannel.close();
}
