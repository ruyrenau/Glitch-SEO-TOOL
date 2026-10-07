import crypto from 'crypto';

const DEV_FALLBACK = 'glitch-dev-only-credentials-key-do-not-use-in-production';
let warned = false;

/** 32-byte key from CREDENTIALS_KEY. Production refuses to run without it. */
function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new Error('CREDENTIALS_KEY must be set in production to store credentials');
    if (!warned && process.env.NODE_ENV !== 'test') {
      console.warn('[glitch] CREDENTIALS_KEY is not set; using an insecure development key.');
      warned = true;
    }
  }
  return crypto.createHash('sha256').update(raw ?? DEV_FALLBACK).digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(token: string): string {
  const [v, iv, tag, data] = token.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** For display only: "abcd…wxyz". */
export function maskSecret(s: string): string {
  return s.length <= 8 ? '••••' : `${s.slice(0, 4)}…${s.slice(-4)}`;
}
