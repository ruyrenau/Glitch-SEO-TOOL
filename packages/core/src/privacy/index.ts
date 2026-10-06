import crypto from 'crypto';

const SENSITIVE_QUERY_PARAMS = new Set([
  'email', 'token', 'password', 'pwd', 'authorization', 'auth', 'session', 'sessionid',
  'phone', 'address', 'card', 'secret', 'apikey', 'key', 'ssn'
]);

export function anonymizeIp(ip: string, salt: string = 'glitch-salt'): string {
  if (!ip) return '0.0.0.0';
  return crypto.createHmac('sha256', salt).update(ip).digest('hex').substring(0, 16);
}

export function sanitizeQueryString(queryString: string, customSensitives: string[] = []): string {
  if (!queryString) return '';
  const sensitive = new Set([...SENSITIVE_QUERY_PARAMS, ...customSensitives.map(s => s.toLowerCase())]);
  try {
    const clean = queryString.startsWith('?') ? queryString.slice(1) : queryString;
    const params = new URLSearchParams(clean);
    const output = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      if (sensitive.has(key.toLowerCase())) {
        output.set(key, '[REDACTED]');
      } else {
        output.set(key, value);
      }
    }
    const result = output.toString();
    return result ? '?' + result : '';
  } catch {
    return '';
  }
}
