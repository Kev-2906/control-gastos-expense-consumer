import { RetryLaterError } from '../../core/errors';
import { EXTERNAL_ID_MODULE, OdooLoadQuery } from './odoo-expense.payload';
import { OdooHttpClient, WRITE_TIMEOUT_MS } from './odoo-http.client';
import { parseLoadResponse } from './odoo-response';

export const EXPENSE_MODEL = 'hr.expense';

const EXTERNAL_ID_NOT_FOUND = 'External ID not found in the system';

export interface OdooExpense {
  odooId: number;
  state: string;
  total: number;
}

export class OdooExpenseClient {
  constructor(private readonly http: OdooHttpClient) {}

  async find(): Promise<OdooExpense | null> {
    const odooId = await this.findOdooId();
    return odooId ? this.read(odooId) : null;
  }

  async read(odooId: number): Promise<OdooExpense | null> {
    const [expense] = await this.http.searchRead<{ state: string; total_amount_currency: number }>(
      EXPENSE_MODEL,
      {
        domain: [['id', '=', odooId]],
        fields: ['state', 'total_amount_currency'],
        limit: 1,
        context: this.http.context,
      },
    );
    return expense ? { odooId, state: expense.state, total: expense.total_amount_currency } : null;
  }

  async createOrUpdate({ fields, row }: OdooLoadQuery): Promise<number> {
    const response = await this.http.call(
      EXPENSE_MODEL,
      'load',
      { fields, data: [row], context: this.http.context },
      WRITE_TIMEOUT_MS,
    );
    return parseLoadResponse(response);
  }

  async submit(odooId: number): Promise<void> {
    await this.http.call(
      EXPENSE_MODEL,
      'action_submit',
      { ids: [odooId], context: this.http.context },
      WRITE_TIMEOUT_MS,
    );
  }

  private async findOdooId(): Promise<number | null> {
    let reference: unknown;
    try {
      reference = await this.http.call('ir.model.data', 'check_object_reference', {
        module: EXTERNAL_ID_MODULE,
        xml_id: this.http.session.expenseId,
      });
    } catch (error) {
      if (error instanceof RetryLaterError && error.message.startsWith(EXTERNAL_ID_NOT_FOUND)) {
        return null;
      }
      throw error;
    }
    if (!Array.isArray(reference)) {
      throw new RetryLaterError(
        'ODOO_INVALID_RESPONSE',
        'Odoo returned no reference for the External ID',
      );
    }
    const [model, odooId] = reference as [string, number | false];
    return model === EXPENSE_MODEL && odooId ? odooId : null;
  }
}
