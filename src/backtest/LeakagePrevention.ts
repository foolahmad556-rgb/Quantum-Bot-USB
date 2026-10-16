import type { Candle } from '../domain/types';

export interface ChronologicalSplit {
  train: Candle[];
  validation: Candle[];
  test: Candle[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function splitChronologically(candles: Candle[], trainFraction: number, validationFraction: number): ChronologicalSplit {
  if (trainFraction <= 0 || validationFraction <= 0 || trainFraction + validationFraction >= 1) throw new Error('fractions must be positive and leave test data');
  const trainEnd = Math.floor(candles.length * trainFraction);
  const validationEnd = trainEnd + Math.floor(candles.length * validationFraction);
  return { train: candles.slice(0, trainEnd), validation: candles.slice(trainEnd, validationEnd), test: candles.slice(validationEnd) };
}

export function assertNoLeakage(...sets: Candle[][]): ValidationResult {
  const errors: string[] = [];
  for (let i = 0; i < sets.length - 1; i++) {
    const current = sets[i];
    const next = sets[i + 1];
    if (!current.length || !next.length) { errors.push('empty split'); continue; }
    if (current.at(-1)!.timestamp >= next[0].timestamp) errors.push(`split ${i} overlaps next split`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateOosResult(input: { testStart: number; lastTrainingTimestamp: number }): ValidationResult {
  const valid = input.testStart > input.lastTrainingTimestamp;
  return { valid, errors: valid ? [] : ['OOS test starts at or before last training timestamp'] };
}
