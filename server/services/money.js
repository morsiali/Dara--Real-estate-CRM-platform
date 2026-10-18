// Money helpers. Amounts are integer minor units (AED fils = 1/100). Rates are integer basis points.
export const MINOR = { AED: 100, USD: 100, EUR: 100, GBP: 100, SAR: 100 };

export function toMinor(major, currency = 'AED') {
  const n = Number(major);
  if (!Number.isFinite(n)) throw new Error('amount must be a number');
  return Math.round(n * (MINOR[currency] ?? 100));
}
export const toMajor = (minor, currency = 'AED') => minor / (MINOR[currency] ?? 100);

/**
 * Gross commission = value × bp / 10000, computed in integer math.
 * Rounding policy (BR-040): round half away from zero to the nearest minor unit.
 */
export function commission(valueMinor, bp) {
  if (!Number.isInteger(valueMinor) || !Number.isInteger(bp)) throw new Error('integers required');
  const num = BigInt(valueMinor) * BigInt(bp);
  const q = num / 10000n; const r = num % 10000n;
  const abs = r < 0n ? -r : r;
  const rounded = abs * 2n >= 10000n ? q + (num < 0n ? -1n : 1n) : q;
  return Number(rounded);
}
