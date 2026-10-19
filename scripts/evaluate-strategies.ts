import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { evaluateStrategies, scenarioCandles, walkForwardEvaluation } from '../src/evaluation/StrategyCouncilEvaluation';

const args = process.argv.slice(2), inputIndex = args.indexOf('--input');
const input = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
if (inputIndex >= 0 && (!input || input.startsWith('--'))) throw new Error('--input requires a JSON candle file');
// Include new source files as well as tracked edits in reproducibility metadata.
const sourceHash = createHash('sha256');
const sourceFiles = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
for (const path of sourceFiles) {
  sourceHash.update(path).update('\0');
  try { sourceHash.update(await readFile(path)); }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; sourceHash.update('DELETED'); }
  sourceHash.update('\0');
}
const report: any = { version: 1, executionEnabled: false,
  source: input ? 'USER_SUPPLIED_UNVERIFIED_HISTORICAL' : 'SYNTHETIC_DIAGNOSTICS',
  codeVersion: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeHash: sourceHash.digest('hex'),
  limitations: ['Fixed-horizon next-open diagnostic, not the full live execution/SL/TP lifecycle.',
    'No profitability or deployment approval follows from synthetic results.',
    'Weight ablations preserve hard vetoes; they do not disable risk guards.',
    'Confidence metrics are diagnostic, not evidence that scores are calibrated probabilities.',
    'Input provenance and venue-specific funding/liquidity still require independent verification.'], results: {} };
if (input) {
  const data = JSON.parse(await readFile(input, 'utf8'));
  const intervalIndex = args.indexOf('--interval-ms');
  const intervalMs = intervalIndex >= 0 ? Number(args[intervalIndex + 1]) : 60000;
  report.results.historical = walkForwardEvaluation(data, { intervalMs, ablations: true });
} else {
  for (const kind of ['up', 'down', 'range', 'crash', 'volatile', 'illiquid'] as const) {
    report.results[kind] = evaluateStrategies(scenarioCandles(kind), { ablations: true });
  }
  report.walkForward = walkForwardEvaluation(scenarioCandles('range'));
}
await mkdir('data/evaluation', { recursive: true });
await writeFile('data/evaluation/latest.json', JSON.stringify(report, null, 2));
console.log('Evaluation report: data/evaluation/latest.json');
for (const [name, result] of Object.entries(report.results) as any) {
  if (result.summaries) console.log(name, JSON.stringify(result.summaries['board-weighted']));
}
console.log('Diagnostic only; no live parameters changed.');
