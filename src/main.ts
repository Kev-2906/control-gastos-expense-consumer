import { auditPool } from './core/audit-database';
import { pool } from './core/database';
import { startConsuming, stopConsuming } from './broker/rabbitmq';

async function shutdown(): Promise<void> {
  await stopConsuming();
  await pool.end();
  await auditPool.end();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

startConsuming();
console.info('Expense consumer started');
