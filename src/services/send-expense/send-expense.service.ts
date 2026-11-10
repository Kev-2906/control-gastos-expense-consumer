import { openOdooClients } from '../../clients/odoo/odoo-clients.factory';
import { RetryLaterError } from '../../core/errors';
import * as submissions from '../../repositories/expense-submission.repository';
import { Submission } from '../../repositories/expense-submission.repository';
import * as expenses from '../../repositories/expense.repository';
import * as connections from '../../repositories/odoo-connection.repository';
import { OdooConnection } from '../../repositories/odoo-connection.repository';
import { sendToOdoo } from './expense-sender';
import { ensureIsSendable } from './expense.validator';
import { emailExpenseSent } from './expense-sent.notifier';
import { handleSendFailure } from './send-failure.handler';

export interface ExpenseSubmitted {
  organizationId: string;
  expenseId: string;
}

const FINISHED_STATUSES = ['sent', 'failed'];
const SENT_EXPENSE_STATUSES = ['submitted', 'approved', 'posted', 'in_payment', 'paid', 'refused'];

export async function sendExpense(
  { organizationId, expenseId }: ExpenseSubmitted,
  previousFailures: number,
): Promise<void> {
  const submission = await submissions.find(organizationId, expenseId);
  if (!submission || FINISHED_STATUSES.includes(submission.status)) return;

  const connection = await connections.find(organizationId, submission.connectionId);
  ensureIsNotPaused(connection);
  await claimOrRetryLater(submission);

  try {
    await send(submission, connection);
  } catch (error) {
    await handleSendFailure(submission, error, previousFailures);
  }
}

async function send(submission: Submission, connection: OdooConnection | null): Promise<void> {
  const { organizationId, expenseId, connectionId } = submission;

  const expense = await expenses.findForOdoo(organizationId, expenseId, connectionId);
  ensureIsSendable(expense);

  const odoo = openOdooClients(connection, {
    organizationId,
    connectionId,
    expenseId,
    companyOdooId: expense.companyOdooId,
  });
  const sent = await sendToOdoo(odoo, submission, expense);

  const notice = await submissions.markSent(
    organizationId,
    expenseId,
    sent.odooId,
    expenseStatusOf(sent.state),
    sent.total,
  );
  await emailExpenseSent(notice);
}

function ensureIsNotPaused(connection: OdooConnection | null): void {
  if (connection?.sendsPausedUntil && connection.sendsPausedUntil > new Date()) {
    throw new RetryLaterError('ODOO_CONNECTION_PAUSED', 'The Odoo connection is paused');
  }
}

async function claimOrRetryLater({ organizationId, expenseId }: Submission): Promise<void> {
  const claimed = await submissions.claim(organizationId, expenseId);
  if (!claimed) throw new RetryLaterError('SUBMISSION_LOCKED', 'Another consumer holds the lock');
}

function expenseStatusOf(odooState: string): string {
  return SENT_EXPENSE_STATUSES.includes(odooState) ? odooState : 'submitted';
}
