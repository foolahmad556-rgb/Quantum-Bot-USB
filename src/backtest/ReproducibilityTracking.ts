import { createHash } from 'node:crypto';

export interface ReproducibilityInput {
  datasetHash: string;
  strategyVersion: string;
  parameters: Record<string, unknown>;
  seed: number;
  codeVersion: string;
}

export interface ReproducibilityRecord extends ReproducibilityInput {
  inputHash: string;
  createdAt: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function reproducibilityHash(input: ReproducibilityInput): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

export function createReproducibilityRecord(input: ReproducibilityInput): ReproducibilityRecord {
  if (!input.datasetHash) throw new Error('datasetHash is required');
  if (!input.strategyVersion) throw new Error('strategyVersion is required');
  if (!input.codeVersion) throw new Error('codeVersion is required');
  if (!Number.isInteger(input.seed)) throw new Error('seed must be an integer');
  return { ...input, inputHash: reproducibilityHash(input), createdAt: new Date(0).toISOString() };
}
