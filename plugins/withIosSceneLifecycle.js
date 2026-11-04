const { withAppDelegate, withInfoPlist } = require('@expo/config-plugins');
const fs = require('fs');

const marker = '// @generated Temis scene lifecycle';
function patchAppDelegate(contents) {
  if (contents.includes(marker)) return contents;
  const windowLine = '    window = UIWindow(frame: UIScreen.main.bounds)';
  const start = /    factory\.startReactNative\(\s*withModuleName: "main",\s*in: window,\s*launchOptions: launchOptions\)/;
  if (!contents.includes(windowLine) || !start.test(contents)) {
    throw new Error('Unexpected AppDelegate template: cannot migrate Scene lifecycle safely');
  }
  return contents.replace(windowLine, '    self.initialLaunchOptions = launchOptions')
    .replace(start, '// React Native starts when UIKit connects the window scene.')
    .replace('  var window: UIWindow?', '  var window: UIWindow?\n  var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
    + '\n' + marker + '\n' + fs.readFileSync(require.resolve('./ios/SceneDelegate.swift'), 'utf8');
}

function sceneManifest() {
  return {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      }],
    },
  };
}

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, config => {
    config.modResults.UIApplicationSceneManifest = sceneManifest();
    return config;
  });
  return withAppDelegate(config, config => {
    config.modResults.contents = patchAppDelegate(config.modResults.contents);
    return config;
  });
};
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.sceneManifest = sceneManifest;
