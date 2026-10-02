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
export function transition(current: string, next: string): boolean {
  return current === 'accepted' && (next === 'fulfilled' || next === 'failed');
}
