const { spawn } = require('node:child_process');

const electronPath = require('electron');
const env = { ...process.env };
// Some parent processes set this for Electron-as-Node tooling. The desktop app needs
// Electron's normal main-process runtime instead.
delete env.ELECTRON_RUN_AS_NODE;

const args = process.argv.slice(2);
const debugIndex = args.indexOf('--debug');
if (debugIndex !== -1) {
  args.splice(debugIndex, 1);
  env.COMPANION_DESK_DEBUG = '1';
}
const debugCompanionIndex = args.findIndex((arg) => arg.startsWith('--debug-companion='));
if (debugCompanionIndex !== -1) {
  const [, companion] = args[debugCompanionIndex].split('=', 2);
  args.splice(debugCompanionIndex, 1);
  env.COMPANION_DESK_DEBUG = '1';
  env.COMPANION_DESK_DEBUG_COMPANION = companion;
}

const child = spawn(electronPath, args, {
  env,
  stdio: 'inherit',
  windowsHide: false,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error('could not launch Electron', error);
  process.exitCode = 1;
});
child.on('close', (code, signal) => {
  if (signal) {
    console.error(`Electron exited with signal ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
