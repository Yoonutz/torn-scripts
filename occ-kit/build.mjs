// Builds the single-file userscripts from occ-kit + plug-in sources. No dependencies.
//   node occ-kit/build.mjs           build every target (every <app folder>/occ.build.json)
//   node occ-kit/build.mjs --check   fail if a committed .user.js is not what its sources build
//
// occ.build.json (paths relative to that folder):
//   { "out": "x.user.js", "header": "src/header.js", "shell": "occ" | "standalone", "plugins": ["plugins/a.js"],
//     "live": { "dir": "live", "url": "https://raw.githubusercontent.com/.../live/" } }
// "live" (Command Center only): the build also writes <dir>/occ.bundle.js (the script without its
// header) and <dir>/occ.manifest.json (its id and sha256), and the .user.js becomes a loader that
// runs the newest bundle kept from that URL, with this build's copy built in (shell/live.js).
//
// How a file is put together: every core module the shell and plug-ins import is inlined once, in
// dependency order, with its import lines and export keywords removed (top-level names must be
// unique across core, the build checks). Each plug-in is wrapped in its own function scope, so its
// own helpers never collide; its `export default` becomes the value the shell receives. The result
// is one readable file: Torn PDA and Greasy Fork need no @require.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const check = process.argv.includes('--check');

const rel = (p) => relative(repo, p).split('\\').join('/');
const IMPORT_RE = /^import\s+(?:[\s\S]*?)\s+from\s+['"](.+?)['"];?\s*$/gm;

function imports(file, src) {
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) out.push(resolve(dirname(file), m[1]));
  return out;
}

function stripModule(src) {
  return src
    .replace(IMPORT_RE, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, '')
    .replace(/^\s*\n/, '');
}

function topNames(src) {
  const names = [];
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  return names;
}

function buildTarget(dir, cfg) {
  const header = readFileSync(resolve(dir, cfg.header), 'utf8').trim();
  const ver = (header.match(/^\/\/\s*@version\s+(\S+)/m) || [])[1];
  if (!ver) throw new Error(rel(dir) + ': header has no @version');
  const shell = resolve(here, 'shell', cfg.shell + '.js');
  const plugins = (cfg.plugins || []).map((p) => resolve(dir, p));

  // Core modules in dependency order (depth first, each once).
  const order = [];
  const seen = new Set();
  const visit = (file, stack) => {
    if (seen.has(file)) return;
    if (stack.includes(file)) throw new Error('import cycle: ' + stack.concat(file).map(rel).join(' -> '));
    const src = readFileSync(file, 'utf8');
    imports(file, src).forEach((f) => {
      if (!f.startsWith(resolve(here, 'core'))) throw new Error(rel(file) + ' imports ' + rel(f) + ': only occ-kit/core modules can be imported');
      visit(f, stack.concat(file));
    });
    seen.add(file);
    if (file !== shell && !plugins.includes(file)) order.push(file);
  };
  plugins.forEach((p) => visit(p, []));
  visit(shell, []);

  const owner = {};
  [...order, shell].forEach((f) => {
    topNames(readFileSync(f, 'utf8')).forEach((n) => {
      if (owner[n]) throw new Error('name "' + n + '" is declared in both ' + rel(owner[n]) + ' and ' + rel(f));
      owner[n] = f;
    });
  });

  const parts = [];
  parts.push('(function () {');
  parts.push("  'use strict';");
  parts.push('');
  // A live bundle shows which build runs next to the installed version (OCC_BUILD comes from live.js).
  parts.push(cfg.live ? "const VERSION = '" + ver + "' + (typeof OCC_BUILD === 'string' ? ' \\u00b7 ' + OCC_BUILD : '');" : "const VERSION = '" + ver + "';");
  order.forEach((f) => {
    parts.push('');
    parts.push('// ---- ' + rel(f));
    parts.push(stripModule(readFileSync(f, 'utf8')).trimEnd());
  });
  const ids = [];
  plugins.forEach((f, i) => {
    const src = readFileSync(f, 'utf8');
    if (!/^export default\s/m.test(src)) throw new Error(rel(f) + ': a plug-in needs `export default { id, label, ... }`');
    const id = 'PLUGIN_' + i;
    ids.push(id);
    parts.push('');
    parts.push('// ---- plug-in: ' + rel(f));
    parts.push('const ' + id + ' = (function () {');
    parts.push(stripModule(src).replace(/^export default\s/m, 'return ').trimEnd());
    parts.push('})();');
  });
  parts.push('');
  parts.push('// ---- ' + rel(shell));
  parts.push(stripModule(readFileSync(shell, 'utf8')).trimEnd());
  parts.push('');
  parts.push('boot([' + ids.join(', ') + ']);');
  parts.push('})();');
  const body = parts.join('\n');
  const files = [];
  let text;
  if (cfg.live) {
    const bundle = body + '\n';
    const sha = createHash('sha256').update(bundle).digest('hex');
    const id = sha.slice(0, 6);
    const ldir = resolve(dir, cfg.live.dir);
    files.push({ path: join(ldir, 'occ.bundle.js'), text: bundle });
    files.push({ path: join(ldir, 'occ.manifest.json'), text: JSON.stringify({ id, version: ver, sha256: sha, bytes: Buffer.byteLength(bundle) }, null, 2) + '\n' });
    text = [
      header,
      '',
      '// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.',
      '// Loader: runs the newest build kept from GitHub, else the copy built in below (occ-kit/shell/live.js).',
      '(function () {',
      "  'use strict';",
      '',
      "const OCC_BAKED = '" + id + "';",
      "const OCC_LIVE_URL = '" + cfg.live.url + "';",
      '',
      'function occBaked(GM_xmlhttpRequest, GM_getValue, GM_setValue, GM_deleteValue, OCC_BUILD) {',
      body,
      '}',
      '',
      '// ---- ' + rel(resolve(here, 'shell', 'live.js')),
      readFileSync(resolve(here, 'shell', 'live.js'), 'utf8').trimEnd(),
      '})();',
      '',
    ].join('\n');
  } else {
    text = [header, '', '// Built by occ-kit/build.mjs from the sources named below. Edit those, then rebuild.', body, ''].join('\n');
  }
  files.unshift({ path: resolve(dir, cfg.out), text });
  // Torn PDA turns every curly quote in a script into a straight one before running it, so one
  // inside a JS string silently breaks the whole script there. Use \u2019 etc. instead.
  files.forEach((f) => {
    const curly = f.text.split('\n').findIndex((l) => /[\u2018\u2019\u201C\u201D]/.test(l));
    if (curly !== -1) throw new Error(rel(f.path) + ': curly quote on built line ' + (curly + 1) + ' (Torn PDA rewrites them): use \\u2018/\\u2019/\\u201C/\\u201D');
  });
  return { files, ver };
}

function targets() {
  const found = [];
  for (const name of readdirSync(repo).sort()) {
    const dir = join(repo, name);
    if (!statSync(dir).isDirectory()) continue;
    const cfg = join(dir, 'occ.build.json');
    if (existsSync(cfg)) found.push({ dir, cfg: JSON.parse(readFileSync(cfg, 'utf8')) });
  }
  return found;
}

let failed = false;
for (const { dir, cfg } of targets()) {
  const { files, ver } = buildTarget(dir, cfg);
  for (const { path: out, text } of files) {
    const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
    if (check) {
      const cur = existsSync(out) ? readFileSync(out, 'utf8') : '';
      if (cur !== text) {
        failed = true;
        console.error('stale: ' + rel(out) + ' (run node occ-kit/build.mjs and commit the result)');
      } else console.log('ok    ' + rel(out) + ' v' + ver + ' ' + kb + ' KB');
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, text);
      console.log('built ' + rel(out) + ' v' + ver + ' ' + kb + ' KB');
    }
  }
}
if (failed) process.exit(1);
