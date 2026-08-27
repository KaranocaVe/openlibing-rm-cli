const SENSITIVE_KEY = /token|password|secret|cookie|authorization|session(?:id)?|refresh/i;

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(nested);
    }
    return redacted;
  }

  return value;
}

export function redactText(value: string): string {
  return value
    .replace(/(sessionId|refreshToken|token|password|authorization|cookie)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}
