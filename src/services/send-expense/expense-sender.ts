import { OdooClients } from '../../clients/odoo/odoo-clients.factory';
import { OdooExpense, OdooExpenseClient } from '../../clients/odoo/odoo-expense.client';
import { toLoadQuery } from '../../clients/odoo/odoo-expense.payload';
import { RetryLaterError } from '../../core/errors';
import * as submissions from '../../repositories/expense-submission.repository';
import { Submission } from '../../repositories/expense-submission.repository';
import {
  ensureReferencesAreUsable,
  findUsableCategory,
  SendableExpense,
} from './expense.validator';
import { sendReceipts } from './receipts-sender';

const ODOO_DRAFT_STATE = 'draft';

export async function sendToOdoo(
  odoo: OdooClients,
  submission: Submission,
  expense: SendableExpense,
): Promise<OdooExpense> {
  const { organizationId, expenseId } = submission;

  const existing = await odoo.expenses.find();
  if (existing && existing.state !== ODOO_DRAFT_STATE) return existing;

  const category = await findUsableCategory(odoo.catalog, expense);
  await ensureReferencesAreUsable(odoo.catalog, expense);

  await submissions.renewLock(organizationId, expenseId);
  const odooId = await odoo.expenses.createOrUpdate(toLoadQuery(expense, category.hasCost));

  await sendReceipts(odoo.attachments, submission, odooId);

  const current = await readOrRetryLater(odoo.expenses, odooId);
  if (current.state !== ODOO_DRAFT_STATE) return current;

  await submissions.renewLock(organizationId, expenseId);
  await odoo.expenses.submit(odooId);
  return readOrRetryLater(odoo.expenses, odooId);
}

async function readOrRetryLater(
  odooExpenses: OdooExpenseClient,
  odooId: number,
): Promise<OdooExpense> {
  const expense = await odooExpenses.read(odooId);
  if (!expense) {
    throw new RetryLaterError('ODOO_TEMPORARY', `Odoo expense ${odooId} is not readable`);
  }
  return expense;
}
