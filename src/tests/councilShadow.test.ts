import assert from 'node:assert/strict';
import { councilEnforced } from '../app/TradingPipeline';

delete process.env.COUNCIL_ENFORCE;
assert.equal(councilEnforced(), false, 'default is shadow mode');
process.env.COUNCIL_ENFORCE = 'true';
assert.equal(councilEnforced(), true);
process.env.COUNCIL_ENFORCE = 'yes-please';
assert.equal(councilEnforced(), false, 'only the exact value true enforces');
console.log('PASS councils default to shadow mode');
