import * as submissions from '../repositories/expense-submission.repository';
import { ExpenseSubmitted } from './send-expense/send-expense.service';

const BATCH_SIZE = 100;

export async function publishPending(
  publish: (event: ExpenseSubmitted) => Promise<void>,
): Promise<number> {
  let published = 0;
  let batch = await submissions.findUnpublished(BATCH_SIZE);

  while (batch.length > 0) {
    for (const { organizationId, expenseId } of batch) {
      await publish({ organizationId, expenseId });
      await submissions.markPublished(organizationId, expenseId);
      published += 1;
    }
    batch = await submissions.findUnpublished(BATCH_SIZE);
  }
  return published;
}
