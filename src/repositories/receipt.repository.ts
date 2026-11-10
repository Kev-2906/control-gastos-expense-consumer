import { pool } from '../core/database';

export interface ReceiptToSend {
  receiptId: string;
  fileName: string;
  contentType: string;
}

export async function findNotSent(
  organizationId: string,
  expenseId: string,
): Promise<ReceiptToSend[]> {
  const { rows } = await pool.query<ReceiptToSend>(
    `SELECT receipt_id AS "receiptId", file_name AS "fileName", content_type AS "contentType"
     FROM receipts
     WHERE organization_id = $1 AND expense_id = $2
       AND status = 'uploaded' AND odoo_attachment_id IS NULL
     ORDER BY created_at ASC, file_name ASC`,
    [organizationId, expenseId],
  );
  return rows;
}

export async function markSent(
  organizationId: string,
  expenseId: string,
  receiptId: string,
  odooAttachmentId: number,
): Promise<void> {
  await pool.query(
    `UPDATE receipts SET odoo_attachment_id = $4, updated_at = now()
     WHERE organization_id = $1 AND expense_id = $2 AND receipt_id = $3`,
    [organizationId, expenseId, receiptId, odooAttachmentId],
  );
}

export async function findIds(organizationId: string, expenseId: string): Promise<string[]> {
  const { rows } = await pool.query<{ receiptId: string }>(
    `SELECT receipt_id AS "receiptId"
     FROM receipts
     WHERE organization_id = $1 AND expense_id = $2`,
    [organizationId, expenseId],
  );
  return rows.map((row) => row.receiptId);
}
