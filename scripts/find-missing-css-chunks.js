// find-missing-css-chunks.js — Fixes Next.js 15.5 CSS extraction bug on Linux.
//
// 1. Creates JS stubs for missing CSS chunk IDs so webpack doesn't hang
// 2. Patches prerendered HTML with proper document structure + CSS links

const fs = require('fs');
const path = require('path');

const CHUNKS = '.next/static/chunks';
const STUB_OUT = path.join(CHUNKS, 'css-stub.js');

// ─── 1. Find and stub missing CSS chunk IDs ──────────────────────────

// Get all chunk IDs webpack knows about
const wpFile = fs.readdirSync(CHUNKS).find(f => f.startsWith('webpack-'));
const wpCode = fs.readFileSync(path.join(CHUNKS, wpFile), 'utf8');
const mapped = new Set();
for (const m of wpCode.matchAll(/(\d+)===e/g)) mapped.add(parseInt(m[1]));
for (const m of wpCode.matchAll(/(\d+):"[a-f0-9]+"/g)) mapped.add(parseInt(m[1]));

// Get IDs from existing chunk files
for (const f of fs.readdirSync(CHUNKS)) {
  const m = f.match(/^(\d+)[-\.]/);
  if (m) mapped.add(parseInt(m[1]));
}

// Get all chunk IDs referenced in ANY chunk's dependency arrays
const entryIds = new Set();
function scanDir(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) { scanDir(fp); continue; }
    if (!f.name.endsWith('.js')) continue;
    const code = fs.readFileSync(fp, 'utf8');
    for (const m of code.matchAll(/\.O\(\d+,\[([\de,]+)\]/g)) {
      for (const id of m[1].split(',')) {
        const num = id === '6e3' ? 6000 : parseInt(id);
        if (!isNaN(num)) entryIds.add(num);
      }
    }
  }
}
scanDir(CHUNKS);

const missing = [...entryIds].filter(id => !mapped.has(id)).sort((a, b) => a - b);

if (missing.length > 0) {
  const stub = missing.map(id =>
    `(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[${id}],{}]);`
  ).join('');
  fs.writeFileSync(STUB_OUT, stub);
  console.log('[css-fix] Stub for CSS chunk IDs:', missing.join(', '));
} else {
  fs.writeFileSync(STUB_OUT, '');
  console.log('[css-fix] No missing CSS chunks');
}

// ─── 2. Patch prerendered HTML files ─────────────────────────────────
// The SWC bug also strips the layout's <html>/<head>/<body> wrapper,
// leaving the HTML in Quirks Mode. We inject the proper structure.

const HEAD_PREFIX = [
  '<!DOCTYPE html>',
  '<html lang="pt-BR">',
  '<head>',
  '<link rel="stylesheet" href="/_next/static/css/generated-tailwind.css"/>',
  '<link rel="stylesheet" href="/_next/static/css/generated-toastify.css"/>',
  '<link rel="preconnect" href="https://fonts.googleapis.com"/>',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous"/>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"/>',
  '<script src="/_next/static/chunks/css-stub.js"></script>',
  '<script>(function(){try{var m=localStorage.getItem("theme-mode");var d=m==="dark"||(m!=="light"&&window.matchMedia("(prefers-color-scheme:dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})()</script>',
].join('');

const BODY_OPEN = '</head><body class="antialiased font-sans">';

const htmlDirs = [
  '.next/server/app',
  '.next/standalone/.next/server/app',
];

let count = 0;
for (const dir of htmlDirs) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.html')) continue;
    const fp = path.join(dir, file);
    let html = fs.readFileSync(fp, 'utf8');

    // Skip if already has DOCTYPE
    if (html.startsWith('<!DOCTYPE')) continue;

    // Prepend head before existing content
    html = HEAD_PREFIX + html;

    // Insert </head><body> before the first visible content (<div hidden)
    html = html.replace('<div hidden', BODY_OPEN + '<div hidden');

    fs.writeFileSync(fp, html);
    count++;
  }
}

console.log(`[css-fix] Patched ${count} HTML files with DOCTYPE + head + body`);
