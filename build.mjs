import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

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
    build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
    build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
    build({ ...common, entryPoints: ['src/preload/dashboardPreload.ts'], outfile: 'dist/dashboardPreload.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
    build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js',
      platform: 'browser', format: 'iife', target: 'chrome120', minify: true }),
    build({ ...common, entryPoints: ['src/renderer/dashboard/dashboard.ts'], outfile: 'dist/dashboard.js',
      platform: 'browser', format: 'iife', target: 'chrome120', minify: true }),
  ]);
  copyFileSync('src/renderer/index.html', 'dist/index.html');
  copyFileSync('src/renderer/dashboard/index.html', 'dist/dashboard.html');
}
