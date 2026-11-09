import { OdooCatalogClient, OdooCategory } from '../../clients/odoo/odoo-catalog.client';
import { ExpenseRejectedError } from '../../core/errors';
import { ExpenseForOdoo } from '../../repositories/expense.repository';

const NOT_SENDABLE_CODE = 'EXPENSE_NOT_SENDABLE';
const CATEGORY_REQUIRED_CODE = 'EXPENSE_CATEGORY_REQUIRED';
const CATEGORY_UNAVAILABLE_CODE = 'EXPENSE_CATEGORY_UNAVAILABLE';
const CURRENCY_UNAVAILABLE_CODE = 'CURRENCY_UNAVAILABLE';
const PAYMENT_METHOD_UNAVAILABLE_CODE = 'PAYMENT_METHOD_UNAVAILABLE';
const PROJECT_ANALYTIC_ACCOUNT_UNAVAILABLE_CODE = 'PROJECT_ANALYTIC_ACCOUNT_UNAVAILABLE';
const EMPLOYEE_ARCHIVED_CODE = 'EMPLOYEE_ARCHIVED';

export type SendableExpense = ExpenseForOdoo & { productOdooId: number };

export function ensureIsSendable(
  expense: ExpenseForOdoo | null,
): asserts expense is SendableExpense {
  if (!expense) throw new ExpenseRejectedError(NOT_SENDABLE_CODE, 'The expense does not exist');
  if (expense.productOdooId === null) {
    throw new ExpenseRejectedError(CATEGORY_REQUIRED_CODE, 'The expense has no category');
  }
  if (expense.currencyId !== null && expense.currencyOdooId === null) {
    throw new ExpenseRejectedError(
      CURRENCY_UNAVAILABLE_CODE,
      'The currency is not in the connection',
    );
  }
}

export async function findUsableCategory(
  catalog: OdooCatalogClient,
  { productOdooId }: SendableExpense,
): Promise<OdooCategory> {
  const category = await catalog.findCategory(productOdooId);
  if (!category) {
    throw new ExpenseRejectedError(
      CATEGORY_UNAVAILABLE_CODE,
      'The category is archived or cannot be expensed in Odoo',
    );
  }
  return category;
}

export async function ensureReferencesAreUsable(
  catalog: OdooCatalogClient,
  { employeeOdooId, currencyOdooId, paymentMethodOdooId, analyticAccountOdooIds }: SendableExpense,
): Promise<void> {
  if (!(await catalog.isEmployeeActive(employeeOdooId))) {
    throw new ExpenseRejectedError(EMPLOYEE_ARCHIVED_CODE, 'The employee is archived in Odoo');
  }
  if (currencyOdooId !== null && !(await catalog.isCurrencyActive(currencyOdooId))) {
    throw new ExpenseRejectedError(CURRENCY_UNAVAILABLE_CODE, 'The currency is archived in Odoo');
  }
  if (
    paymentMethodOdooId !== null &&
    !(await catalog.isPaymentMethodAllowed(paymentMethodOdooId))
  ) {
    throw new ExpenseRejectedError(
      PAYMENT_METHOD_UNAVAILABLE_CODE,
      'The payment method is not available in Odoo',
    );
  }
  if (!(await catalog.areAnalyticAccountsActive(analyticAccountOdooIds))) {
    throw new ExpenseRejectedError(
      PROJECT_ANALYTIC_ACCOUNT_UNAVAILABLE_CODE,
      'An analytic account of the project is archived or missing in Odoo',
    );
  }
}
