import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  host: config.DATABASE_HOST,
  port: config.DATABASE_PORT,
  user: config.DATABASE_USERNAME,
  password: config.DATABASE_PASSWORD,
  database: config.DATABASE_NAME,
  max: config.DATABASE_POOL_MAX,
});

pool.on('error', (error) => console.error(`PostgreSQL idle client error: ${error.message}`));
