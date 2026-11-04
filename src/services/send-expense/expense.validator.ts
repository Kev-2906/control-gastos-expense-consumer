import { OdooCatalogClient, OdooCategory } from '../../clients/odoo/odoo-catalog.client';
import { ExpenseRejectedError } from '../../core/errors';
import { ExpenseForOdoo } from '../../repositories/expense.repository';

const NOT_SENDABLE_CODE = 'EXPENSE_NOT_SENDABLE';
const REFERENCE_UNAVAILABLE_CODE = 'ODOO_REFERENCE_UNAVAILABLE';

export type SendableExpense = ExpenseForOdoo & { productOdooId: number };

export function ensureIsSendable(
  expense: ExpenseForOdoo | null,
): asserts expense is SendableExpense {
  if (!expense) throw new ExpenseRejectedError(NOT_SENDABLE_CODE, 'The expense does not exist');
  if (expense.productOdooId === null) {
    throw new ExpenseRejectedError(NOT_SENDABLE_CODE, 'The expense has no category');
  }
  if (expense.currencyId !== null && expense.currencyOdooId === null) {
    throw new ExpenseRejectedError(NOT_SENDABLE_CODE, 'The currency is not in the connection');
  }
}

export async function findUsableCategory(
  catalog: OdooCatalogClient,
  { productOdooId }: SendableExpense,
): Promise<OdooCategory> {
  const category = await catalog.findCategory(productOdooId);
  if (!category) throw unavailable('The category is archived or cannot be expensed in Odoo');
  return category;
}

export async function ensureReferencesAreUsable(
  catalog: OdooCatalogClient,
  { currencyOdooId, paymentMethodOdooId, analyticAccountOdooIds }: SendableExpense,
): Promise<void> {
  if (currencyOdooId !== null && !(await catalog.isCurrencyActive(currencyOdooId))) {
    throw unavailable('The currency is archived in Odoo');
  }
  if (
    paymentMethodOdooId !== null &&
    !(await catalog.isPaymentMethodAllowed(paymentMethodOdooId))
  ) {
    throw unavailable('The payment method is not available in Odoo');
  }
  if (!(await catalog.areAnalyticAccountsActive(analyticAccountOdooIds))) {
    throw unavailable('An analytic account of the project is archived or missing in Odoo');
  }
}

function unavailable(message: string): ExpenseRejectedError {
  return new ExpenseRejectedError(REFERENCE_UNAVAILABLE_CODE, message);
}
