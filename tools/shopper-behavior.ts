/** Seeded choices are reproducible; IDs, timings and competing outcomes are not. Optional learning exercise: adjust only this policy to explore conversion/abandonment. Keep results within the quantity limit and never change stock from a shopper.
 * Input: random, from caller seed and fictional product population.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function shopperBehavior(random: () => number) {
  return { quantity: 1 + Math.floor(random() * 3), abandons: random() < 0.15 };
}
/** Return reproducible random choices from a caller-supplied seed.
 * Input: seed, from caller seed and fictional product population.
 * Communicates with local computation/presentation only; no direct network or database calls.
 */
export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
