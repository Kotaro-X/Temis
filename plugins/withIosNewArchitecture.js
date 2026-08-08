const fs = require("fs");
const path = require("path");
const { createRunOncePlugin, withDangerousMod } = require("@expo/config-plugins");

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
      return config;
    },
  ]);

module.exports = createRunOncePlugin(
  withIosNewArchitecture,
  "with-ios-new-architecture",
  "1.0.0",
);
