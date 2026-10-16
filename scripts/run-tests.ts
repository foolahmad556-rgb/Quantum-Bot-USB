import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const testDir = join(process.cwd(), 'src', 'tests');
const files = (await readdir(testDir))
  .filter((file) => /\.(test|regression)\.ts$/.test(file))
  .sort();

for (const file of files) {
  const path = join(testDir, file);
  console.log(`\n=== ${path} ===`);
  const child = spawn(process.execPath, ['--import', 'tsx', path], { stdio: 'inherit' });
  const code = await new Promise<number>((resolve) => {
    child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
  });
  if (code !== 0) process.exit(code);
}

console.log(`\nAll ${files.length} test files passed`);
