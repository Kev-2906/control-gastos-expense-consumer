import { decrypt } from '../../core/crypto';
import { RetryLaterError } from '../../core/errors';
import { OdooConnection } from '../../repositories/odoo-connection.repository';
import { OdooAttachmentClient } from './odoo-attachment.client';
import { OdooCatalogClient } from './odoo-catalog.client';
import { OdooExpenseClient } from './odoo-expense.client';
import { OdooHttpClient, OdooSession } from './odoo-http.client';

export interface OdooClients {
  expenses: OdooExpenseClient;
  catalog: OdooCatalogClient;
  attachments: OdooAttachmentClient;
}

type OdooClientsScope = Pick<
  OdooSession,
  'organizationId' | 'connectionId' | 'expenseId' | 'companyOdooId'
>;

export function openOdooClients(
  connection: OdooConnection | null,
  scope: OdooClientsScope,
): OdooClients {
  if (!connection || connection.status === 'invalid') {
    throw new RetryLaterError('ODOO_CONNECTION_INVALID', 'The Odoo connection is not usable');
  }
  const http = new OdooHttpClient({
    ...scope,
    baseUrl: connection.baseUrl,
    dbName: connection.dbName,
    apiKey: decrypt(connection.apiKeyEncrypted),
  });
  return {
    expenses: new OdooExpenseClient(http),
    catalog: new OdooCatalogClient(http),
    attachments: new OdooAttachmentClient(http),
  };
}
