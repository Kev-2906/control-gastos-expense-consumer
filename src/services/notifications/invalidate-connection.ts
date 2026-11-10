import { transaction } from '../../core/database';
import * as submissions from '../../repositories/expense-submission.repository';
import * as notifications from '../../repositories/notification.repository';
import { Notice } from '../../repositories/notification.repository';
import * as connections from '../../repositories/odoo-connection.repository';
import * as users from '../../repositories/user.repository';

export async function invalidateConnection(
  organizationId: string,
  connectionId: string,
): Promise<Notice[]> {
  return transaction(async (client) => {
    const connectionName = await connections.markInvalidIfActive(
      client,
      organizationId,
      connectionId,
    );
    if (connectionName === null) return [];

    const notices: Notice[] = [];
    for (const admin of await users.findActiveAdmins(client, organizationId)) {
      notices.push(
        await notifications.create(client, organizationId, admin, null, 'odoo_connection_invalid', {
          connectionName,
        }),
      );
    }
    for (const { count, ...reporter } of await submissions.countWaitingByReporter(
      client,
      organizationId,
      connectionId,
    )) {
      notices.push(
        await notifications.create(client, organizationId, reporter, null, 'expense_send_delayed', {
          count,
          connectionName,
        }),
      );
    }
    return notices;
  });
}
