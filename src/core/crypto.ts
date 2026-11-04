import { createDecipheriv } from 'node:crypto';
import { config } from './config';

const ALGORITHM = 'aes-256-gcm';
const key = Buffer.from(config.SECRETS_ENCRYPTION_KEY, 'base64');

export function decrypt(payload: string): string {
  const [iv, tag, ciphertext] = payload.split(':');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(ciphertext, 'base64', 'utf8') + decipher.final('utf8');
}
