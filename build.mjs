import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

const SECRET_FILES = new Set(['brain-key.js', 'openrouter-key.js']);
const VENDOR_DIRS = ['lib', 'live2d', 'sounds'];
const STATIC_FILES = ['LivelyInfo.json', 'LivelyProperties.json', 'thumbnail.png'];
const SOURCE_DIRS = ['modules'];
const ROOT_SOURCES = ['live2d_controller.ts', 'wallpaper.ts'];

let esbuild;
try {
  esbuild = await import('esbuild');
} catch (err) {
  console.error('[build] esbuild is not installed. Run:  npm install');
  process.exit(1);
}

async function compileTs(src) {
  const res = await esbuild.transform(src, {
    loader: 'ts',
    target: ['chrome110'],
    sourcemap: 'inline',
    legalComments: 'none',
  });
  return res.code;
}

async function minifyJs(src) {
  const res = await esbuild.transform(src, {
    loader: 'js',
    minify: true,
    target: ['chrome110'],
    sourcemap: 'external',
    sourcesContent: true,
    legalComments: 'none',
  });
  return res;
}

async function minifyCss(src) {
  const res = await esbuild.transform(src, {
    loader: 'css',
    minify: true,
    sourcemap: 'external',
    sourcesContent: true,
    legalComments: 'none',
  });
  return res;
}

async function writeDevOutput(relPath) {
  const abs = path.join(ROOT, relPath.replace(/\.js$/, '.ts'));
  const code = await fs.readFile(abs, 'utf8');
  const out = await compileTs(code);
  const dest = path.join(SRC, relPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, out);
  return { relPath, before: code.length, after: out.length };
}

async function writeDistOutput(relPath) {
  const srcPath = path.join(SRC, relPath);
  const code = await fs.readFile(srcPath, 'utf8');
  const { code: minified, map } = await minifyJs(code);
  const dest = path.join(DIST, relPath);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, minified);
  if (map) {
    await fs.writeFile(dest + '.map', map);
  }
  return { relPath, before: code.length, after: minified.length };
}

async function scanForSecretImports(dir, label) {
  const findings = [];
  const jsRe = /import\s*\(\s*['"]([^'"]+\.js)['"]\s*\)/g;
  const walk = async (d) => {
    let entries;
    try { entries = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const code = await fs.readFile(full, 'utf8');
      const rel = path.relative(ROOT, full);
      for (const m of code.matchAll(jsRe)) {
        const imported = path.posix.basename(m[1]);
        if (SECRET_FILES.has(imported)) {
          findings.push({ file: rel, import: m[1] });
        }
      }
    }
  };
  await walk(dir);
  if (findings.length) {
    console.error('[' + label + '] dynamic import of secret files found:');
    for (const f of findings) console.error('  ' + f.file + ' -> ' + f.import);
    process.exit(1);
  }
}

async function main() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.rm(SRC, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  await fs.mkdir(SRC, { recursive: true });

  let totalBefore = 0;
  let totalAfter = 0;
  let fileCount = 0;

  for (const dir of VENDOR_DIRS) {
    await fs.cp(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });
  }
  for (const file of STATIC_FILES) {
    await fs.copyFile(path.join(ROOT, file), path.join(DIST, file));
  }

  const tsTargets = [...ROOT_SOURCES];
  for (const d of SOURCE_DIRS) {
    const files = await fs.readdir(path.join(ROOT, d));
    for (const f of files) {
      if (f.endsWith('.ts')) tsTargets.push(path.join(d, f));
    }
  }

  for (const rel of tsTargets) {
    const jsRel = rel.replace(/\.ts$/, '.js');
    const { before, after } = await writeDevOutput(jsRel);
    totalBefore += before;
    totalAfter += after;
    fileCount++;
  }

  for (const rel of tsTargets) {
    const jsRel = rel.replace(/\.ts$/, '.js');
    const { before, after } = await writeDistOutput(jsRel);
    totalBefore += before;
    totalAfter += after;
    fileCount++;
  }

  const css = await fs.readFile(path.join(ROOT, 'style.css'), 'utf8');
  const cssOut = await minifyCss(css);
  await fs.writeFile(path.join(DIST, 'style.css'), cssOut.code);
  if (cssOut.map) {
    await fs.writeFile(path.join(DIST, 'style.css.map'), cssOut.map);
  }
  totalBefore += css.length;
  totalAfter += cssOut.code.length;
  fileCount++;

  let html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
  const scriptTagRe = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  const tags = [...html.matchAll(scriptTagRe)];
  const stripped = [];
  for (const [tag, src] of tags) {
    if (SECRET_FILES.has(path.posix.basename(src))) {
      html = html.replace(tag, '');
      stripped.push(src);
    }
  }
  // Source index.html loads first-party modules from src/ (unminified dev output);
  // inside dist/ they live at the module root, so strip the src/ prefix.
  const devPathRe = new RegExp('src="src/', 'gi');
  html = html.replace(devPathRe, 'src="');
  await fs.writeFile(path.join(DIST, 'index.html'), html);

  await scanForSecretImports(SRC, 'build');
  await scanForSecretImports(DIST, 'build');

  const pct = totalBefore ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : '0';
  console.log('[build] dist/ ready -- ' + fileCount + ' minified files, ' +
    Math.round(totalBefore / 1024) + ' KB -> ' + Math.round(totalAfter / 1024) + ' KB (' + pct + '% smaller)');
  console.log('[build] dev output: src/ (unminified)');
  console.log('[build] copied vendor dirs: ' + VENDOR_DIRS.join(', '));
  if (stripped.length) console.log('[build] stripped secret scripts: ' + stripped.join(', '));
}

async function watch() {
  await main();
  console.log('[watch] Watching for TypeScript and CSS changes...');
  const watchPaths = [
    path.join(ROOT, 'modules'),
    path.join(ROOT, 'wallpaper.ts'),
    path.join(ROOT, 'live2d_controller.ts'),
    path.join(ROOT, 'style.css'),
  ];

  let debounceTimer = null;
  const triggerRebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      console.log('[watch] Change detected. Rebuilding...');
      try {
        await main();
      } catch (e) {
        console.error('[watch] Build error:', e);
      }
    }, 150);
  };

  for (const wp of watchPaths) {
    try {
      fs.watch(wp, { recursive: true }, triggerRebuild);
    } catch {
      // ignore missing watch targets
    }
  }
}

if (process.argv.includes('--watch') || process.argv.includes('-w')) {
  watch().catch((err) => {
    console.error('[watch] failed:', err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error('[build] failed:', err);
    process.exit(1);
  });
}