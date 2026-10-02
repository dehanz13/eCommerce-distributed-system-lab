export function row<T>(raw: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    out[name] =
      value instanceof Date ? value.toISOString() : key === 'total_cents' ? Number(value) : value;
  }
  return out as T;
}
