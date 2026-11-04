import { pool } from '../core/database';

export interface ExpenseForOdoo {
  expenseId: string;
  description: string | null;
  notes: string | null;
  date: string | null;
  quantity: number;
  total: number | null;
  paymentMode: string;
  employeeOdooId: number;
  companyOdooId: number;
  productOdooId: number | null;
  currencyId: string | null;
  currencyOdooId: number | null;
  paymentMethodOdooId: number | null;
  analyticAccountOdooIds: number[];
}

export async function findForOdoo(
  organizationId: string,
  expenseId: string,
  connectionId: string,
): Promise<ExpenseForOdoo | null> {
  const { rows } = await pool.query<ExpenseForOdoo>(
    `SELECT
       e.expense_id AS "expenseId",
       e.description,
       e.notes,
       e.date::text AS date,
       e.quantity::float8 AS quantity,
       e.total::float8 AS total,
       e.payment_mode AS "paymentMode",
       r.odoo_id AS "employeeOdooId",
       c.odoo_id AS "companyOdooId",
       category.odoo_id AS "productOdooId",
       e.currency_id AS "currencyId",
       currency.odoo_currency_id AS "currencyOdooId",
       method.odoo_id AS "paymentMethodOdooId",
       COALESCE(
         (SELECT array_agg(account.odoo_id ORDER BY account.odoo_id)
          FROM project_analytic_accounts project_account
          JOIN analytic_accounts account
            ON account.analytic_account_id = project_account.analytic_account_id
           AND account.organization_id = project_account.organization_id
          WHERE project_account.organization_id = e.organization_id
            AND project_account.project_id = e.project_id),
         '{}'
       ) AS "analyticAccountOdooIds"
     FROM expenses e
     JOIN reporters r
       ON r.reporter_id = e.reporter_id AND r.organization_id = e.organization_id
     JOIN companies c
       ON c.company_id = e.company_id AND c.organization_id = e.organization_id
     LEFT JOIN expense_categories category
       ON category.category_id = e.category_id AND category.organization_id = e.organization_id
     LEFT JOIN connection_currencies currency
       ON currency.currency_id = e.currency_id
      AND currency.connection_id = $3
      AND currency.organization_id = e.organization_id
     LEFT JOIN payment_methods method
       ON method.payment_method_id = e.payment_method_id
      AND method.organization_id = e.organization_id
     WHERE e.organization_id = $1 AND e.expense_id = $2`,
    [organizationId, expenseId, connectionId],
  );
  return rows[0] ?? null;
}
