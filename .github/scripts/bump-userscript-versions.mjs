#!/usr/bin/env node
// Bumps the last number of `// @version` in every .user.js a push modified, so Greasy Fork
// (and Tampermonkey / Violentmonkey) see a new version and auto-update.
//
//   node .github/scripts/bump-userscript-versions.mjs <commit before the push> <commit after the push>
//
// A file is left alone when the push already changed its @version line (a manual bump wins), when it
// is new in the push, or when it lives in a backup/ folder. 1.2.0 -> 1.2.1, 2.5 -> 2.6, 3.5.9 -> 3.5.10.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [before, after] = process.argv.slice(2);
if (!before || !after || /^0+$/.test(before)) {
  console.log('No base commit to compare against, nothing to bump.');
  process.exit(0);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

let changed;
try {
  changed = git('diff', '--name-only', '--diff-filter=M', '-z', before, after, '--', '*.user.js')
    .split('\0')
    .filter(Boolean);
} catch {
  console.log(`Cannot diff ${before}..${after} (history rewritten?), nothing to bump.`);
  process.exit(0);
}

const VERSION_LINE = /^(\/\/ @version[ \t]+)(\S*?)(\d+)([ \t]*\r?)$/m;
const VERSION_DIFF = /^[+-]\/\/ @version\b/m;

for (const file of changed) {
  if (/(^|\/)backup\//i.test(file)) {
    console.log(`skip ${file}: backup folder`);
    continue;
  }
  if (VERSION_DIFF.test(git('diff', '-U0', before, after, '--', file))) {
    console.log(`skip ${file}: @version already changed in this push`);
    continue;
  }
  const text = readFileSync(file, 'utf8');
  const m = text.match(VERSION_LINE);
  if (!m) {
    console.log(`skip ${file}: no numeric // @version line`);
    continue;
  }
  const next = `${m[2]}${Number(m[3]) + 1}`;
  writeFileSync(file, text.replace(VERSION_LINE, (_all, head, _prefix, _num, tail) => `${head}${next}${tail}`));
  console.log(`bump ${file}: ${m[2]}${m[3]} -> ${next}`);
}
