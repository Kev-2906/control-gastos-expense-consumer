import { EXPENSE_MODEL } from './odoo-expense.client';
import { OdooHttpClient, WRITE_TIMEOUT_MS } from './odoo-http.client';
import { parseCreateResponse } from './odoo-response';

const ATTACHMENT_MODEL = 'ir.attachment';

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
  return `portal:${receiptId}`;
}
