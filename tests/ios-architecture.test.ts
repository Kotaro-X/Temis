import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { patchArchitecturePodfile } = require('../plugins/withIosNewArchitecture.js');

test('Podspec evaluation sees the same architecture as the app, regardless of shell overrides', () => {
  const original = "ENV['RCT_NEW_ARCH_ENABLED'] ||= '0' if podfile_properties['newArchEnabled'] == 'false'\n";
  const patched = patchArchitecturePodfile(original);
  assert.equal(patchArchitecturePodfile(patched), patched);
  for (const enabled of [true, false]) {
    for (const inherited of ['', '0', '1']) {
      const result = execFileSync('ruby', ['-e', `podfile_properties = {'newArchEnabled' => '${enabled}'}\n${patched}\nprint ENV['RCT_NEW_ARCH_ENABLED']`], {
        env: { ...process.env, RCT_NEW_ARCH_ENABLED: inherited }, encoding: 'utf8',
      });
      assert.equal(result, enabled ? '1' : '0');
    }
  }
});

test('unexpected Podfile templates fail instead of silently leaving mixed architectures', () => {
  assert.throws(() => patchArchitecturePodfile('use_native_modules!'), /Missing Expo architecture setting/);
});
