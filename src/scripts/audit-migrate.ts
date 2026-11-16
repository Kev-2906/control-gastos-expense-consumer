import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, escapeIdentifier } from 'pg';
import { z } from 'zod';

const requiredString = z.string().trim().min(1);

const env = z
  .object({
    AUDIT_DATABASE_HOST: requiredString,
    AUDIT_DATABASE_PORT: z.coerce.number().int().positive().default(5432),
    AUDIT_DATABASE_NAME: requiredString,
    AUDIT_DATABASE_USERNAME: requiredString,
    AUDIT_MIGRATION_DATABASE_USERNAME: requiredString,
    AUDIT_MIGRATION_DATABASE_PASSWORD: requiredString,
  })
  .parse(process.env);

const MIGRATIONS_DIR = join(process.cwd(), 'database', 'audit');
const AUDIT_TABLE = 'odoo_audit_logs';

async function migrate(): Promise<void> {
  const client = new Client({
    host: env.AUDIT_DATABASE_HOST,
    port: env.AUDIT_DATABASE_PORT,
    database: env.AUDIT_DATABASE_NAME,
    user: env.AUDIT_MIGRATION_DATABASE_USERNAME,
    password: env.AUDIT_MIGRATION_DATABASE_PASSWORD,
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const file of await sqlFiles()) {
      await client.query(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
      console.info(`Applied ${file}`);
    }
    await client.query(
      `GRANT INSERT ON ${AUDIT_TABLE} TO ${escapeIdentifier(env.AUDIT_DATABASE_USERNAME)}`,
    );
    await client.query('COMMIT');
    console.info(`Granted INSERT on ${AUDIT_TABLE} to ${env.AUDIT_DATABASE_USERNAME}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function sqlFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((file) => file.endsWith('.sql')).sort();
}

migrate().catch((error: unknown) => {
  console.error(
    `Audit migration failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
