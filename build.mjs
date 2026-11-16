import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

mkdirSync('dist', { recursive: true });

function buildNativeMacModule() {
  if (process.platform !== 'darwin') return;
  const src = 'src/main/native_focus_mac.mm';
  const out = 'dist/native_focus_mac.node';
  if (!existsSync(src)) return;

  const candidates = [
    path.resolve(process.execPath, '../../include/node'),
    '/opt/homebrew/include/node',
    '/usr/local/include/node',
  ];
  const includeDir = candidates.find((dir) => existsSync(path.join(dir, 'node_api.h')));
  if (!includeDir) {
    console.warn('[build] Warning: node_api.h not found; skipping native macOS module build');
    return;
  }

  try {
    execFileSync('clang', [
      '-bundle',
      '-undefined', 'dynamic_lookup',
      '-fobjc-arc',
      '-framework', 'Cocoa',
      `-I${includeDir}`,
      '-arch', 'arm64',
      '-arch', 'x86_64',
      '-O2',
      '-o', out,
      src,
    ], { stdio: 'inherit' });
    console.log('[build] Built native universal module: dist/native_focus_mac.node');
  } catch (err) {
    try {
      execFileSync('clang', [
        '-bundle',
        '-undefined', 'dynamic_lookup',
        '-fobjc-arc',
        '-framework', 'Cocoa',
        `-I${includeDir}`,
        '-O2',
        '-o', out,
        src,
      ], { stdio: 'inherit' });
      console.log('[build] Built native module (host arch): dist/native_focus_mac.node');
    } catch (err2) {
      console.warn('[build] Warning: Could not compile native macOS module; skipping:', err2.message);
    }
  }
}

if (process.argv.includes('--smoke')) {
  await Promise.all([
    build({
      entryPoints: ['test/smoke.ts'], outfile: 'dist-test/smoke.js',
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'info',
    }),
    build({
      entryPoints: ['test/wellness.test.ts'], outfile: 'dist-test/wellness.js',
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'info',
    }),
  ]);
} else {
  const common = { bundle: true, logLevel: 'info', sourcemap: false };
  await Promise.all([
    build({
      ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron']
    }),
    build({
      ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron']
    }),
    build({
      ...common, entryPoints: ['src/preload/dashboardPreload.ts'], outfile: 'dist/dashboardPreload.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron']
    }),
    build({
      ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js',
      platform: 'browser', format: 'iife', target: 'chrome120', minify: true
    }),
    build({
      ...common, entryPoints: ['src/renderer/dashboard/dashboard.ts'], outfile: 'dist/dashboard.js',
      platform: 'browser', format: 'iife', target: 'chrome120', minify: true
    }),
  ]);
  copyFileSync('src/renderer/index.html', 'dist/index.html');
  copyFileSync('src/renderer/dashboard/index.html', 'dist/dashboard.html');
  copyFileSync('assets/logo.png', 'dist/logo.png');

  buildNativeMacModule();
}
