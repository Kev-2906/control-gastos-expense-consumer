import { OdooAttachmentClient } from '../../clients/odoo/odoo-attachment.client';
import { downloadReceipt } from '../../clients/bucket/s3.client';
import * as submissions from '../../repositories/expense-submission.repository';
import { Submission } from '../../repositories/expense-submission.repository';
import * as receipts from '../../repositories/receipt.repository';
import { ReceiptToSend } from '../../repositories/receipt.repository';

export async function sendReceipts(
  attachments: OdooAttachmentClient,
  submission: Submission,
  odooExpenseId: number,
): Promise<void> {
  const { organizationId, expenseId } = submission;
  await removeDeletedReceipts(attachments, submission, odooExpenseId);

  for (const receipt of await receipts.findNotSent(organizationId, expenseId)) {
    await submissions.renewLock(organizationId, expenseId);

    const attachmentId =
      (await attachments.find(odooExpenseId, receipt.receiptId)) ??
      (await uploadReceipt(attachments, submission, odooExpenseId, receipt));

    await receipts.markSent(organizationId, expenseId, receipt.receiptId, attachmentId);
  }
}

async function removeDeletedReceipts(
  attachments: OdooAttachmentClient,
  { organizationId, expenseId }: Submission,
  odooExpenseId: number,
): Promise<void> {
  const keptReceiptIds = new Set(await receipts.findIds(organizationId, expenseId));
  const removed = (await attachments.findPortalReceipts(odooExpenseId)).filter(
    (attachment) => !keptReceiptIds.has(attachment.receiptId),
  );
  if (removed.length === 0) return;

  await submissions.renewLock(organizationId, expenseId);
  await attachments.delete(removed.map((attachment) => attachment.attachmentId));
}

async function uploadReceipt(
  attachments: OdooAttachmentClient,
  { organizationId, expenseId }: Submission,
  odooExpenseId: number,
  receipt: ReceiptToSend,
): Promise<number> {
  const content = await downloadReceipt(organizationId, expenseId, receipt.receiptId);
  await submissions.renewLock(organizationId, expenseId);

  const uploadedMeanwhile = await attachments.find(odooExpenseId, receipt.receiptId);
  return uploadedMeanwhile ?? attachments.upload(odooExpenseId, { ...receipt, content });
}
