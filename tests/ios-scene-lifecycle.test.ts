import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { patchAppDelegate, sceneManifest } = require('../plugins/withIosSceneLifecycle.js');

test('prebuild moves window creation to a scene and preserves Firebase initialization', () => {
  const original = `class AppDelegate {
  var window: UIWindow?
    window = UIWindow(frame: UIScreen.main.bounds)
    FirebaseApp.configure()
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
}`;
  const patched = patchAppDelegate(original);
  assert.equal(patchAppDelegate(patched), patched);
  assert.equal((patched.match(/factory.startReactNative/g) ?? []).length, 1);
  assert.ok(patched.includes('FirebaseApp.configure()'));
  assert.ok(!patched.includes('UIScreen.main.bounds'));
  assert.ok(patched.includes('UIWindow(windowScene: windowScene)'));
  assert.ok(patched.includes('launchOptions[.url] = context.url'));
  assert.ok(patched.includes('launchOptions[.userActivityDictionary]'));
});

test('scene manifest registers a single app scene and rejects unsupported templates', () => {
  const manifest = sceneManifest();
  assert.equal(manifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName,
    '$(PRODUCT_MODULE_NAME).SceneDelegate');
  assert.throws(() => patchAppDelegate('unexpected template'), /cannot migrate/);
});
