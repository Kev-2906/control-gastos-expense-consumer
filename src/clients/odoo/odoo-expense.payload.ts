import { ExpenseForOdoo } from '../../repositories/expense.repository';

export const EXTERNAL_ID_MODULE = 'portal_gastos';

type OdooColumn = [field: string, value: string | number | null];

export interface OdooLoadQuery {
  fields: string[];
  row: string[];
}

export function toLoadQuery(expense: ExpenseForOdoo, categoryHasCost: boolean): OdooLoadQuery {
  const columns = columnsOf(expense, categoryHasCost).filter(([, value]) => value !== null);
  return {
    fields: columns.map(([field]) => field),
    row: columns.map(([, value]) => String(value)),
  };
}

function columnsOf(expense: ExpenseForOdoo, categoryHasCost: boolean): OdooColumn[] {
  return [
    ['id', `${EXTERNAL_ID_MODULE}.${expense.expenseId}`],
    ['name', expense.description],
    ['description', expense.notes],
    ['employee_id/.id', expense.employeeOdooId],
    ['company_id/.id', expense.companyOdooId],
    ['product_id/.id', expense.productOdooId],
    ['date', expense.date],
    ['quantity', expense.quantity],
    ['total_amount_currency', categoryHasCost ? null : expense.total],
    ['currency_id/.id', expense.currencyOdooId],
    ['payment_mode', expense.paymentMode],
    ['payment_method_line_id/.id', expense.paymentMethodOdooId],
    ['analytic_distribution', analyticDistributionOf(expense.analyticAccountOdooIds)],
  ];
}

function analyticDistributionOf(accountOdooIds: number[]): string | null {
  if (accountOdooIds.length === 0) return null;
  return JSON.stringify({ [accountOdooIds.join(',')]: 100 });
}
