#!/usr/bin/env node
// Verifies no dev UI citations are active or left in source before commit/push.
// - Checks if VITE_MASTHEAD_DEV_CITATIONS=1 (global kill-switch)
// - Scans staged files for data-ui-cite= (temporary marker) but skips the reusable helper file itself
// Run by git hooks or `npm run verify:no-citations`.
// Blocks commit/push if citations would leak.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const FLAG = process.env.VITE_MASTHEAD_DEV_CITATIONS;
if (FLAG === '1') {
  console.error('BLOCKED: VITE_MASTHEAD_DEV_CITATIONS=1 (citation mode enabled). Disable before commit/push.');
  process.exit(1);
}

const markerRegex = /data-ui-cite=/i;
let files = [];
try {
  const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' }).trim();
  files = staged ? staged.split('\n') : [];
} catch {
  files = ['src'];
}

let found = false;
for (const f of files) {
  if (!f.startsWith('src/') && !f.includes('src')) continue;
  if (f.endsWith('/DevCite.tsx')) continue; // exclude the reusable helper itself
  if (!existsSync(f)) continue;
  const content = readFileSync(f, 'utf8');
  if (markerRegex.test(content)) {
    console.error(`BLOCKED: Temporary citation marker (data-ui-cite=) found in ${f}. Remove the DevCite wrapper before commit.`);
    found = true;
  }
}

if (found) process.exit(1);
console.log('No dev citations active or present. OK to commit/push.');