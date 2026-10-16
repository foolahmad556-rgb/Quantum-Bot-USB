import { createHash } from 'node:crypto';
import type { Candle } from '../domain/types';

export interface DataManifestInput {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  source: string;
}

export interface DataManifest {
  symbol: string;
  timeframe: string;
  startTimestamp: number;
  endTimestamp: number;
  candleCount: number;
  sha256: string;
  source: string;
  createdAt: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function canonical(candles: Candle[]): string {
  return candles.map((c) => [c.timestamp, c.open, c.high, c.low, c.close, c.volume, c.vwap ?? null]).join('|');
}

export function hashCandles(candles: Candle[]): string {
  return createHash('sha256').update(canonical(candles)).digest('hex');
}

export function validateCandles(candles: Candle[], intervalMs: number): ValidationResult {
  const errors: string[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!Number.isFinite(c.timestamp) || !Number.isFinite(c.open) || !Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close) || !Number.isFinite(c.volume)) errors.push(`invalid numeric candle at ${i}`);
    if (c.high < c.low || c.high < c.open || c.high < c.close || c.low > c.open || c.low > c.close) errors.push(`invalid OHLC bounds at ${i}`);
    if (c.volume < 0 || c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) errors.push(`invalid price or volume at ${i}`);
    if (i > 0) {
      const delta = c.timestamp - candles[i - 1].timestamp;
      if (delta <= 0) errors.push(`timestamps not strictly increasing at ${i}`);
      else if (delta !== intervalMs) errors.push(`timestamp gap at ${i}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createDataManifest(input: DataManifestInput): DataManifest {
  if (!input.candles.length) throw new Error('Cannot create manifest for empty dataset');
  const validation = validateCandles(input.candles, 0);
  const errors = validation.errors.filter((error) => !error.includes('timestamp gap'));
  if (errors.length) throw new Error(errors.join('; '));
  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    startTimestamp: input.candles[0].timestamp,
    endTimestamp: input.candles[input.candles.length - 1].timestamp,
    candleCount: input.candles.length,
    sha256: hashCandles(input.candles),
    source: input.source,
    createdAt: new Date().toISOString(),
  };
}

export function validateDataManifest(manifest: DataManifest, candles: Candle[]): ValidationResult {
  const errors: string[] = [];
  if (manifest.candleCount !== candles.length) errors.push('candle count mismatch');
  if (manifest.startTimestamp !== candles[0]?.timestamp || manifest.endTimestamp !== candles[candles.length - 1]?.timestamp) errors.push('range mismatch');
  if (manifest.sha256 !== hashCandles(candles)) errors.push('dataset hash mismatch');
  return { valid: errors.length === 0, errors };
}
