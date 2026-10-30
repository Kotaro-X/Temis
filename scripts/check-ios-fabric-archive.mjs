import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

// Check the actual linked classes, not just whether Xcode compiled successfully.
// A nil NSClassFromString in this generated dictionary aborts on first render.
const archive = resolve(process.argv[2] || 'build/Temis.xcarchive');
const provider = readFileSync('ios/build/generated/ios/RCTThirdPartyComponentsProvider.mm', 'utf8');
const classes = [...provider.matchAll(/NSClassFromString\(@"([^"]+)"\)/g)].map(match => match[1]);
const binary = join(archive, 'Products/Applications/Temis.app/Temis');
const symbols = join(archive, 'dSYMs/Temis.app.dSYM/Contents/Resources/DWARF/Temis');
if (!existsSync(symbols)) throw new Error('Archive dSYM is required to verify linked Fabric classes');
const uuid = file => execFileSync('dwarfdump', ['--uuid', file], { encoding: 'utf8' }).match(/UUID: ([\w-]+)/)?.[1];
if (!uuid(binary) || uuid(binary) !== uuid(symbols)) throw new Error('Archive executable and dSYM UUIDs differ');
const output = execFileSync('nm', [symbols], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const missing = classes.filter(name => !output.includes(`_OBJC_CLASS_$_${name}\n`));
if (missing.length) throw new Error(`Missing Fabric classes (startup crash): ${missing.join(', ')}`);
console.log(`Verified ${classes.length} Fabric component classes in ${archive}`);
