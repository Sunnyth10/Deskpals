const { spawn } = require('node:child_process');

const electronPath = require('electron');
const env = { ...process.env };
// Some parent processes set this for Electron-as-Node tooling. The desktop app needs
// Electron's normal main-process runtime instead.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, process.argv.slice(2), {
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
