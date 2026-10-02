import { it, expect } from 'vitest';
import { seededRandom, shopperBehavior } from '../tools/shopper-behavior';
it('repeats shopper choices with a seed while retaining bounded quantities', () => {
  const a = seededRandom(42),
    b = seededRandom(42);
  for (let i = 0; i < 1000; i++) {
    const x = shopperBehavior(a);
    expect(x).toEqual(shopperBehavior(b));
    expect(x.quantity).toBeGreaterThanOrEqual(1);
    expect(x.quantity).toBeLessThanOrEqual(3);
  }
});
