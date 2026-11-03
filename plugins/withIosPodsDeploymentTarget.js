const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

const marker = "    # Temis: align Pod deployment targets with the app";

const patchPodfile = (contents) => {
  if (contents.includes(marker)) return contents;
  const hook = /    react_native_post_install\([\s\S]*?\n    \)/;
  if (!hook.test(contents)) throw new Error("Podfile react_native_post_install hook not found");
  return contents.replace(hook, (match) => `${match}
${marker}
    minimum_ios = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '15.1')
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && Gem::Version.new(current) < minimum_ios
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
        end
      end
    end`);
};

module.exports = (config) =>
  withDangerousMod(config, ["ios", async (config) => {
    const file = path.join(config.modRequest.platformProjectRoot, "Podfile");
    const contents = await fs.promises.readFile(file, "utf8");
    await fs.promises.writeFile(file, patchPodfile(contents));
    return config;
  }]);

module.exports.patchPodfile = patchPodfile;
