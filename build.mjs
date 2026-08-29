#!/usr/bin/env node
// build.mjs - AMADEUS HUD release builder.
//
// Produces a minified, self-contained copy of the wallpaper in dist/ that can
// be zipped or pointed at by Lively Wallpaper directly. The dev tree stays
// untouched; index.html in dist keeps the same relative script paths.
//
// Security: brain-key.js / openrouter-key.js are intentionally EXCLUDED and
// their <script> tags stripped — secrets never ship in a dist artifact. The
// chat tier degrades gracefully when the key globals are absent.
//
// Usage:  npm install && npm run build

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

// Files that must never appear in a distribution artifact.
const SECRET_FILES = new Set(['brain-key.js', 'openrouter-key.js']);
// Already-minified vendor bundles are copied verbatim.
const VENDOR_DIRS = ['lib', 'live2d', 'sounds'];
const STATIC_FILES = ['LivelyInfo.json', 'LivelyProperties.json', 'thumbnail.png'];
// First-party sources eligible for minification.
const SOURCE_DIRS = ['modules'];
const ROOT_SOURCES = ['live2d_controller.js', 'wallpaper.js'];

let esbuild;
try {
  esbuild = await import('esbuild');
} catch (err) {
  console.error('[build] esbuild is not installed. Run:  npm install');
  process.exit(1);
}

async function minifyJs(src) {
  const res = await esbuild.transform(src, {
    minify: true,
    target: ['chrome110'],
    legalComments: 'none',
  });
  return res.code;
}

async function minifyCss(src) {
  const res = await esbuild.transform(src, {
    loader: 'css',
    minify: true,
    legalComments: 'none',
  });
  return res.code;
}

async function writeMinifiedJs(relPath) {
  const abs = path.join(ROOT, relPath);
  const code = await fs.readFile(abs, 'utf8');
  const out = await minifyJs(code);
  const dest = path.join(DIST, relPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, out);
  return { relPath, before: code.length, after: out.length };
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  let totalBefore = 0;
  let totalAfter = 0;
  let fileCount = 0;

  // 1. Vendor bundles & binary assets: copy verbatim.
  for (const dir of VENDOR_DIRS) {
    await fs.cp(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
  }
  for (const file of STATIC_FILES) {
    await fs.copyFile(path.join(ROOT, file), path.join(DIST, file));
  }

  // 2. First-party JS: minify in place (same relative paths).
  const jsTargets = [...ROOT_SOURCES];
  for (const d of SOURCE_DIRS) {
    const files = await fs.readdir(path.join(ROOT, d));
    for (const f of files) {
      if (f.endsWith('.js')) jsTargets.push(`${d}/${f}`);
    }
  }

  for (const rel of jsTargets) {
    const { before, after } = await writeMinifiedJs(rel);
    totalBefore += before;
    totalAfter += after;
    fileCount++;
  }

  // 3. Stylesheet: minify.
  const css = await fs.readFile(path.join(ROOT, 'style.css'), 'utf8');
  const cssOut = await minifyCss(css);
  await fs.writeFile(path.join(DIST, 'style.css'), cssOut);
  totalBefore += css.length;
  totalAfter += cssOut.length;
  fileCount++;

  // 4. index.html: keep structure, strip secret key <script> tags.
  let html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const scriptTagRe = /<script src="([^"]+)"><\/script>/g;
  const tags = [...html.matchAll(scriptTagRe)];
  const stripped = [];
  for (const [tag, src] of tags) {
    if (SECRET_FILES.has(path.posix.basename(src))) {
      html = html.replace(tag, '');
      stripped.push(src);
    }
  }
  await fs.writeFile(path.join(DIST, 'index.html'), html);

  const pct = totalBefore ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : '0';
  console.log(`[build] dist/ ready — ${fileCount} minified files, ` +
    `${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB (${pct}% smaller)`);
  console.log(`[build] copied vendor dirs: ${VENDOR_DIRS.join(', ')}`);
  if (stripped.length) console.log(`[build] stripped secret scripts: ${stripped.join(', ')}`);
}

main().catch((err) => {
  console.error('[build] failed:', err);
  process.exit(1);
});
