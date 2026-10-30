const fs = require("fs");
const path = require("path");
const { createRunOncePlugin, withDangerousMod } = require("@expo/config-plugins");

// Podspecs are evaluated by autolinking before use_react_native! sets this
// variable. Set both enabled and disabled explicitly before that happens.
const patchArchitecturePodfile = (contents) => {
  const assignment = "ENV['RCT_NEW_ARCH_ENABLED'] = podfile_properties['newArchEnabled'] == 'false' ? '0' : '1'";
  const pattern = /^ENV\['RCT_NEW_ARCH_ENABLED'\].*$/m;
  if (!pattern.test(contents)) throw new Error("Missing Expo architecture setting in Podfile");
  return contents.replace(pattern, assignment);
};

const withIosNewArchitecture = (config, { enabled = true } = {}) =>
  withDangerousMod(config, [
    "ios",
    async (config) => {
      const propertiesPath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile.properties.json",
      );
      let properties = {};
      try {
        properties = JSON.parse(
          await fs.promises.readFile(propertiesPath, "utf8"),
        );
      } catch (error) {
        if (error && error.code !== "ENOENT") {
          throw error;
        }
      }

      const nextProperties = {
        ...properties,
        newArchEnabled: enabled ? "true" : "false",
      };
      if (JSON.stringify(nextProperties) !== JSON.stringify(properties)) {
        await fs.promises.writeFile(
          propertiesPath,
          `${JSON.stringify(nextProperties, null, 2)}\n`,
        );
      }
      const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
      const podfile = await fs.promises.readFile(podfilePath, "utf8");
      await fs.promises.writeFile(podfilePath, patchArchitecturePodfile(podfile));
      return config;
    },
  ]);

module.exports = createRunOncePlugin(
  withIosNewArchitecture,
  "with-ios-new-architecture",
  "1.0.0",
);
module.exports.patchArchitecturePodfile = patchArchitecturePodfile;
