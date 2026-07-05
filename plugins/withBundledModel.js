const fs = require("fs");
const path = require("path");
const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require("@expo/config-plugins");

const MODEL_FILENAME = "local-llm.gguf";
const MODEL_RELATIVE_PATH = path.join("assets", "models", MODEL_FILENAME);

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const copyModelFile = ({ projectRoot, destPath }) => {
  const sourcePath = path.resolve(projectRoot, MODEL_RELATIVE_PATH);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `モデルファイルが見つかりませんでした: ${sourcePath}`,
    );
  }
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(sourcePath, destPath);
};

const withBundledModel = (config) => {
  config = withDangerousMod(config, [
    "android",
    (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidAssetsDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "assets",
      );
      const destPath = path.join(androidAssetsDir, MODEL_FILENAME);
      copyModelFile({ projectRoot, destPath });
      return config;
    },
  ]);

  config = withXcodeProject(config, (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const sourceRoot = IOSConfig.Paths.getSourceRoot(projectRoot);
    const destPath = path.join(sourceRoot, MODEL_FILENAME);

    copyModelFile({ projectRoot, destPath });

    const filePath = path.join(projectName, MODEL_FILENAME);
    if (!config.modResults.hasFile(filePath)) {
      config.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: filePath,
        groupName: projectName,
        project: config.modResults,
        isBuildFile: true,
        verbose: true,
      });
    }
    return config;
  });

  return config;
};

module.exports = withBundledModel;
