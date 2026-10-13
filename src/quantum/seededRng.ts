/**
 * Seeded deterministic PRNG (mulberry32).
 * Returns a function producing floats in [0, 1), same contract as Math.random().
 */

export const DEFAULT_RNG_SEED = 0x5eed1234;

export function createRng(seed: number = DEFAULT_RNG_SEED): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
