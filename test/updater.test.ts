import { isNewerVersion, pickAssetForCurrentPlatform, type ReleaseAsset } from '../src/main/updater';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  PASS: ${msg}`);
}

console.log('=== TEST SUITE: IN-APP UPDATER LOGIC ===');

// Version comparison
assert(isNewerVersion('v1.2.0', '1.1.0'), 'v1.2.0 is newer than 1.1.0');
assert(isNewerVersion('v2.0.0', '1.9.9'), 'v2.0.0 is newer than 1.9.9');
assert(isNewerVersion('1.1.1', '1.1.0'), '1.1.1 is newer than 1.1.0');
assert(!isNewerVersion('v1.1.0', '1.1.0'), 'v1.1.0 is equal to 1.1.0');
assert(!isNewerVersion('v1.0.9', '1.1.0'), 'v1.0.9 is older than 1.1.0');
assert(!isNewerVersion('1.1.0', '1.2.0'), '1.1.0 is older than 1.2.0');

// Asset matching
const mockAssets: ReleaseAsset[] = [
  { name: 'DeskPals-mac-arm64.dmg', browser_download_url: 'https://example.com/arm64.dmg', size: 90000000 },
  { name: 'DeskPals-mac-x64.dmg', browser_download_url: 'https://example.com/x64.dmg', size: 92000000 },
  { name: 'DeskPals-win-x64.exe', browser_download_url: 'https://example.com/win.exe', size: 85000000 },
];

const macArm = pickAssetForCurrentPlatform(mockAssets, 'darwin', 'arm64');
assert(macArm?.name === 'DeskPals-mac-arm64.dmg', 'Picks Apple Silicon dmg for darwin arm64');

const macIntel = pickAssetForCurrentPlatform(mockAssets, 'darwin', 'x64');
assert(macIntel?.name === 'DeskPals-mac-x64.dmg', 'Picks Intel dmg for darwin x64');

const win = pickAssetForCurrentPlatform(mockAssets, 'win32', 'x64');
assert(win?.name === 'DeskPals-win-x64.exe', 'Picks exe for Windows');

console.log('\nALL UPDATER LOGIC TESTS PASSED SUCCESSFULLY!\n');
