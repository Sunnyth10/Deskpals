import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

if (process.argv.includes('--smoke')) {
  await build({
    entryPoints: ['test/smoke.ts'], outfile: 'dist-test/smoke.js',
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'info',
  });
} else {
  const common = { bundle: true, logLevel: 'info', sourcemap: false };
  await Promise.all([
    build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
    build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload.js',
      platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] }),
    build({ ...common, entryPoints: ['src/renderer/renderer.ts'], outfile: 'dist/renderer.js',
      platform: 'browser', format: 'iife', target: 'chrome120', minify: true }),
  ]);
  copyFileSync('src/renderer/index.html', 'dist/index.html');
}
