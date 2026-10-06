import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const ios = join(root, 'ios');
if (!existsSync(join(ios, 'Podfile'))) throw new Error('Generate the iOS project before preparing photo modules.');
const config = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const picker = config.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker');
const description = picker?.[1]?.photosPermission;
if (typeof description !== 'string' || !description.trim()) throw new Error('app.json must define photosPermission for expo-image-picker.');
const plist = join(ios, 'Temis/Info.plist');
let exists = false;
try { execFileSync('/usr/bin/plutil', ['-extract', 'NSPhotoLibraryUsageDescription', 'raw', '-o', '-', plist], { stdio: 'pipe' }); exists = true; } catch { /* Add the key below. */ }
execFileSync('/usr/bin/plutil', [exists ? '-replace' : '-insert', 'NSPhotoLibraryUsageDescription', '-string', description, plist], { stdio: 'inherit' });
// Keep the current generated project and custom Podfile fixes; do not regenerate/clean iOS.
execFileSync('pod', ['install', '--no-repo-update'], { cwd: ios, stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts/check-ios-profile-native.mjs')], { cwd: root, stdio: 'inherit' });
