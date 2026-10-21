import assert from 'node:assert/strict';
import { recoverChunkLoad } from '../lib/chunkRecovery';
const state = new Map<string,string>(), navigations: string[] = [];
const browser = { sessionStorage: { getItem: (k:string)=>state.get(k) ?? null, setItem: (k:string,v:string)=>state.set(k,v) },
  location: { href:'https://example.invalid/?tab=history#trades', replace:(url:string)=>navigations.push(url) } } as any;
const error = new TypeError('Failed to fetch dynamically imported module: https://example.invalid/assets/old.js');
assert.equal(recoverChunkLoad(new Error('Rendering bug'), browser, 1000000), false);
assert.equal(recoverChunkLoad(error, browser, 1000000), true);
assert.equal(recoverChunkLoad(error, browser, 1000001), false);
assert.equal(navigations.length, 1);
const url = new URL(navigations[0]);
assert.equal(url.searchParams.get('tab'), 'history'); assert.equal(url.hash, '#trades');
assert.equal(url.searchParams.get('_ui_reload'), '1000000');
assert.equal(recoverChunkLoad(error, { ...browser, sessionStorage: {getItem(){throw new Error('disabled')}} }, 2000000), false);
assert.equal(recoverChunkLoad(error, browser, 1400000), true);
console.log('PASS chunk recovery: bounded navigation, unrelated errors, disabled storage, preserved route');
