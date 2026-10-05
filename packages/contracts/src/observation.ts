/** Keep fictional business payloads useful, while bounding records and removing credentials.
 * Input: value, depth, secrets, from external envelopes/responses or caller-selected schemas.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function safeObservation(value: unknown, depth = 0, secrets: string[] = []): unknown {
  if (depth > 8) return '[depth limit]';
  if (typeof value === 'string') {
    let text = value.replace(/(https?:\/\/|amqps?:\/\/)([^/\s@]+)@/g, '$1[redacted]@');
    for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
    return text.length > 8000 ? text.slice(0, 8000) + '[truncated]' : text;
  }
  if (value instanceof Error)
    return { name: value.name, message: safeObservation(value.message, depth + 1, secrets) };
  if (Array.isArray(value))
    return [
      ...value.slice(0, 100).map((x) => safeObservation(x, depth + 1, secrets)),
      ...(value.length > 100 ? [{ truncatedItems: value.length - 100 }] : []),
    ];
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 60)
        .map(([key, item]) => [
          key,
          /password|secret|token|authorization|cookie|private.?key|idempotency.?key|^env$|^config$/i.test(
            key,
          )
            ? '[redacted]'
            : safeObservation(item, depth + 1, secrets),
        ]),
    );
  }
  return typeof value === 'bigint' ? value.toString() : value;
}
