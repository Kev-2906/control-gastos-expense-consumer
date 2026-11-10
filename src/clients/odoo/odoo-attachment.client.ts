import { EXPENSE_MODEL } from './odoo-expense.client';
import { OdooHttpClient, WRITE_TIMEOUT_MS } from './odoo-http.client';
import { parseCreateResponse } from './odoo-response';

const ATTACHMENT_MODEL = 'ir.attachment';
const RECEIPT_MARKER_PREFIX = 'portal:';

export interface PortalReceiptAttachment {
  attachmentId: number;
  receiptId: string;
}

export interface ReceiptFile {
  receiptId: string;
  fileName: string;
  contentType: string;
  content: Buffer;
}

export class OdooAttachmentClient {
  constructor(private readonly http: OdooHttpClient) {}

  async find(odooExpenseId: number, receiptId: string): Promise<number | null> {
    const [attachment] = await this.http.searchRead<{ id: number }>(ATTACHMENT_MODEL, {
      domain: [
        ['res_model', '=', EXPENSE_MODEL],
        ['res_id', '=', odooExpenseId],
        ['description', '=', receiptMarker(receiptId)],
      ],
      fields: ['id'],
      limit: 1,
    });
    return attachment?.id ?? null;
  }

  async findPortalReceipts(odooExpenseId: number): Promise<PortalReceiptAttachment[]> {
    const attachments = await this.http.searchRead<{ id: number; description: string }>(
      ATTACHMENT_MODEL,
      {
        domain: [
          ['res_model', '=', EXPENSE_MODEL],
          ['res_id', '=', odooExpenseId],
          ['description', '=like', `${RECEIPT_MARKER_PREFIX}%`],
        ],
        fields: ['description'],
      },
    );
    return attachments.map((attachment) => ({
      attachmentId: attachment.id,
      receiptId: attachment.description.slice(RECEIPT_MARKER_PREFIX.length),
    }));
  }

  async delete(attachmentIds: number[]): Promise<void> {
    await this.http.call(
      ATTACHMENT_MODEL,
      'unlink',
      { ids: attachmentIds, context: this.http.context },
      WRITE_TIMEOUT_MS,
    );
  }

  async upload(odooExpenseId: number, file: ReceiptFile): Promise<number> {
    const response = await this.http.call(
      ATTACHMENT_MODEL,
      'create',
      {
        vals_list: [
          {
            name: file.fileName,
            res_model: EXPENSE_MODEL,
            res_id: odooExpenseId,
            mimetype: file.contentType,
            description: receiptMarker(file.receiptId),
            datas: file.content.toString('base64'),
          },
        ],
        context: { ...this.http.context, image_no_postprocess: true },
      },
      WRITE_TIMEOUT_MS,
    );
    return parseCreateResponse(response);
  }
}

function receiptMarker(receiptId: string): string {
  return `${RECEIPT_MARKER_PREFIX}${receiptId}`;
}
