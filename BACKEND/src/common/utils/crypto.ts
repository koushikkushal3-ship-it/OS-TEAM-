import { ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

function key(): Buffer {
  if (env.MFA_ENCRYPTION_KEY.length < 32) {
    throw new ServiceUnavailableException('MFA_ENCRYPTION_KEY is not configured (32+ characters required)');
  }
  return createHash('sha256').update(env.MFA_ENCRYPTION_KEY).digest();
}

/** AES-256-GCM. Output: base64(iv).base64(tag).base64(ciphertext) */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
