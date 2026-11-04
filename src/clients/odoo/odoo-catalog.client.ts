import { OdooHttpClient } from './odoo-http.client';

export interface OdooCategory {
  hasCost: boolean;
}

export class OdooCatalogClient {
  constructor(private readonly http: OdooHttpClient) {}

  async findCategory(productOdooId: number): Promise<OdooCategory | null> {
    const [product] = await this.http.searchRead<{ standard_price: number }>('product.product', {
      domain: [
        ['id', '=', productOdooId],
        ['can_be_expensed', '=', true],
      ],
      fields: ['standard_price'],
      limit: 1,
      context: this.http.context,
    });
    return product ? { hasCost: product.standard_price > 0 } : null;
  }

  async isCurrencyActive(currencyOdooId: number): Promise<boolean> {
    const found = await this.findIds('res.currency', [['id', '=', currencyOdooId]]);
    return found.length === 1;
  }

  async isPaymentMethodAllowed(paymentMethodOdooId: number): Promise<boolean> {
    const [company] = await this.http.searchRead<{
      company_expense_allowed_payment_method_line_ids: number[];
    }>('res.company', {
      domain: [['id', '=', this.http.session.companyOdooId]],
      fields: ['company_expense_allowed_payment_method_line_ids'],
      limit: 1,
      context: this.http.context,
    });
    const allowed = company?.company_expense_allowed_payment_method_line_ids ?? [];
    if (allowed.length > 0) return allowed.includes(paymentMethodOdooId);

    const found = await this.findIds('account.payment.method.line', [
      ['id', '=', paymentMethodOdooId],
      ['payment_type', '=', 'outbound'],
      ['journal_id.active', '=', true],
    ]);
    return found.length === 1;
  }

  async areAnalyticAccountsActive(accountOdooIds: number[]): Promise<boolean> {
    if (accountOdooIds.length === 0) return true;

    const found = await this.findIds('account.analytic.account', [['id', 'in', accountOdooIds]]);
    return found.length === accountOdooIds.length;
  }

  private findIds(model: string, domain: unknown[]): Promise<{ id: number }[]> {
    return this.http.searchRead<{ id: number }>(model, {
      domain,
      fields: ['id'],
      context: this.http.context,
    });
  }
}
