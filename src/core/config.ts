import { z } from 'zod';

const requiredString = z.string().trim().min(1);

const envSchema = z.object({
  DATABASE_HOST: requiredString,
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USERNAME: requiredString,
  DATABASE_PASSWORD: requiredString,
  DATABASE_NAME: requiredString,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
  RABBITMQ_HOST: requiredString,
  RABBITMQ_PORT: z.coerce.number().int().positive().default(5672),
  RABBITMQ_USER: requiredString,
  RABBITMQ_PASSWORD: requiredString,
  FRONTEND_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  SECRETS_ENCRYPTION_KEY: requiredString,
  STORAGE_REGION: requiredString,
  STORAGE_BUCKET: requiredString,
  STORAGE_ACCESS_KEY_ID: requiredString,
  STORAGE_SECRET_ACCESS_KEY: requiredString,
  AUDIT_DATABASE_HOST: requiredString,
  AUDIT_DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  AUDIT_DATABASE_USERNAME: requiredString,
  AUDIT_DATABASE_PASSWORD: requiredString,
  AUDIT_DATABASE_NAME: requiredString,
});

export const config = envSchema.parse(process.env);
