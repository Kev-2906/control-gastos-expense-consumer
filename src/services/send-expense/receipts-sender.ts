import { OdooAttachmentClient } from '../../clients/odoo/odoo-attachment.client';
import { downloadReceipt } from '../../clients/bucket/s3.client';
import * as submissions from '../../repositories/expense-submission.repository';
import { Submission } from '../../repositories/expense-submission.repository';
import * as receipts from '../../repositories/receipt.repository';

export async function sendReceipts(
  attachments: OdooAttachmentClient,
  { organizationId, expenseId }: Submission,
  odooExpenseId: number,
): Promise<void> {
  for (const receipt of await receipts.findNotSent(organizationId, expenseId)) {
    await submissions.renewLock(organizationId, expenseId);

    const existing = await attachments.find(odooExpenseId, receipt.receiptId);
    const attachmentId =
      existing ??
      (await attachments.upload(odooExpenseId, {
        ...receipt,
        content: await downloadReceipt(organizationId, expenseId, receipt.receiptId),
      }));

    await receipts.markSent(organizationId, expenseId, receipt.receiptId, attachmentId);
  }
}
