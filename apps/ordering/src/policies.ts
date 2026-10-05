/** Calculate integer-cent totals and reject invalid money or quantities.
 * Input: items, from the owning cart/order calculation.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function total(items: ReadonlyArray<{ priceCents: number; quantity: number }>): number {
  let sum = 0;
  for (const x of items) {
    if (
      !Number.isSafeInteger(x.priceCents) ||
      x.priceCents < 0 ||
      !Number.isInteger(x.quantity) ||
      x.quantity <= 0
    )
      throw new Error('INVALID_MONEY');
    sum += x.priceCents * x.quantity;
  }
  if (!Number.isSafeInteger(sum)) throw new Error('INVALID_MONEY');
  return sum;
}
/** Permit only acceptance-to-terminal order transitions.
 * Input: current, next, from the persisted order state and received outcome.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function transition(current: string, next: string): boolean {
  return current === 'accepted' && (next === 'fulfilled' || next === 'failed');
}
