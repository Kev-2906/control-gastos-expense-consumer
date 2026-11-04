import { EXTERNAL_ID_MODULE, OdooLoadQuery } from './odoo-expense.payload';
import { OdooHttpClient, WRITE_TIMEOUT_MS } from './odoo-http.client';
import { parseLoadResponse } from './odoo-response';

export const EXPENSE_MODEL = 'hr.expense';

export interface OdooExpense {
  odooId: number;
  state: string;
  total: number;
}

export class OdooExpenseClient {
  constructor(private readonly http: OdooHttpClient) {}

  async find(): Promise<OdooExpense | null> {
    const [externalId] = await this.http.searchRead<{ res_id: number }>('ir.model.data', {
      domain: [
        ['module', '=', EXTERNAL_ID_MODULE],
        ['name', '=', this.http.session.expenseId],
        ['model', '=', EXPENSE_MODEL],
      ],
      fields: ['res_id'],
      limit: 1,
    });
    return externalId ? this.read(externalId.res_id) : null;
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
}
