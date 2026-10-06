import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const lockPath = join(root, 'ios/Podfile.lock');
const providerPath = join(root, 'ios/Pods/Target Support Files/Pods-Temis/ExpoModulesProvider.swift');
const errors = [];
const lock = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : '';
for (const pod of ['ExpoImagePicker', 'ExpoImageManipulator', 'EXImageLoader']) {
  if (!lock.includes(`- ${pod} (`)) errors.push(`${pod} is missing from ios/Podfile.lock`);
}
const provider = existsSync(providerPath) ? readFileSync(providerPath, 'utf8') : '';
for (const module of ['ImagePickerModule.self', 'ImageManipulatorModule.self']) {
  if (!provider.includes(module)) errors.push(`${module} is missing from ExpoModulesProvider`);
}
try {
  const description = execFileSync('/usr/bin/plutil', ['-extract', 'NSPhotoLibraryUsageDescription', 'raw', '-o', '-', join(root, 'ios/Temis/Info.plist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!description.trim()) errors.push('NSPhotoLibraryUsageDescription is empty');
} catch { errors.push('NSPhotoLibraryUsageDescription is missing from ios/Temis/Info.plist'); }
if (errors.length) {
  console.error(`[ios-profile-native] ${errors.join('\n[ios-profile-native] ')}`);
  console.error('Run npm run ios:prepare-profile-native, then build a new native app. A JS reload alone does not add native modules.');
  process.exitCode = 1;
} else console.info('[ios-profile-native] Photo pods, native registration and privacy description are present.');
