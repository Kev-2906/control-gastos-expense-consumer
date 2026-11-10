import { publishEmailRequest } from '../../broker/email-publisher';
import { config } from '../../core/config';
import * as notifications from '../../repositories/notification.repository';
import { ExpenseSentNotice } from '../../repositories/expense-submission.repository';

const EXPENSE_UPDATES_TEMPLATE = 'expense-updates';

export async function emailExpenseSent(notice: ExpenseSentNotice | null): Promise<void> {
  if (!notice) return;
  const { organizationId, expenseId, notificationId, recipient, type, data } = notice;

  try {
    if (recipient) {
      await publishEmailRequest({
        template: EXPENSE_UPDATES_TEMPLATE,
        to: recipient,
        data: {
          updates: [
            {
              type,
              status: data.status,
              expenseDescription: data.expenseDescription,
              total: data.total,
              currency: data.currency,
              paymentMode: data.paymentMode,
              expenseUrl: `${config.FRONTEND_URL}/expenses/${expenseId}`,
            },
          ],
        },
      });
    }
    await notifications.markEmailed(organizationId, notificationId);
  } catch (error) {
    console.warn(
      `Expense ${expenseId} sent, but its email was not published (it will be retried): ${String(error)}`,
    );
  }
}
