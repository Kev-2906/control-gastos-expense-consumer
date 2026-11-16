import { Pool } from 'pg';
import { config } from './config';

const POOL_MAX = 2;
const CONNECTION_TIMEOUT_MS = 3_000;
const QUERY_TIMEOUT_MS = 5_000;

export const auditPool = new Pool({
  host: config.AUDIT_DATABASE_HOST,
  port: config.AUDIT_DATABASE_PORT,
  user: config.AUDIT_DATABASE_USERNAME,
  password: config.AUDIT_DATABASE_PASSWORD,
  database: config.AUDIT_DATABASE_NAME,
  max: POOL_MAX,
  connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  query_timeout: QUERY_TIMEOUT_MS,
});

auditPool.on('error', (error) =>
  console.error(`Audit PostgreSQL idle client error: ${error.message}`),
);
