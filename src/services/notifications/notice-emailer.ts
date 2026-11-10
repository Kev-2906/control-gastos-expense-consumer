import { publishEmailRequest } from '../../broker/email-publisher';
import { config } from '../../core/config';
import * as notifications from '../../repositories/notification.repository';
import { Notice } from '../../repositories/notification.repository';

const EXPENSE_UPDATES_TEMPLATE = 'expense-updates';
const PATHS = {
  expenses: '/expenses',
  odooConnections: '/odoo-connections',
};

export async function emailNotices(notices: Notice[]): Promise<void> {
  const groups = new Map<string, Notice[]>();
  for (const notice of notices) {
    const key = `${notice.organizationId}|${notice.recipient?.email ?? notice.notificationId}`;
    groups.set(key, [...(groups.get(key) ?? []), notice]);
  }

  for (const group of groups.values()) {
    const [{ organizationId, recipient }] = group;
    const ids = group.map((notice) => notice.notificationId);
    try {
      if (recipient) {
        await publishEmailRequest({
          template: EXPENSE_UPDATES_TEMPLATE,
          to: { email: recipient.email, name: recipient.name },
          data: { updates: group.map((notice) => updateOf(notice)) },
        });
      }
      await notifications.markEmailed(organizationId, ids);
    } catch (error) {
      console.warn(
        `Notification email for ${ids.length} notices was not published (it will be retried): ${String(error)}`,
      );
    }
  }
}

function updateOf({ type, expenseId, data }: Notice): Record<string, unknown> {
  return {
    type,
    status: data.status ?? null,
    expenseDescription: data.expenseDescription ?? null,
    total: data.total ?? null,
    currency: data.currency ?? null,
    paymentMode: data.paymentMode ?? null,
    errorCode: data.errorCode ?? null,
    count: data.count ?? null,
    connectionName: data.connectionName ?? null,
    url: `${config.FRONTEND_URL}${pathOf(type, expenseId)}`,
  };
}

function pathOf(type: string, expenseId: string | null): string {
  if (expenseId) return `${PATHS.expenses}/${expenseId}`;
  return type === 'odoo_connection_invalid' ? PATHS.odooConnections : PATHS.expenses;
}
