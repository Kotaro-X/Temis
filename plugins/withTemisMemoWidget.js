/* global __dirname */
const fs = require("fs");
const path = require("path");
const { createRunOncePlugin, withXcodeProject } = require("@expo/config-plugins");

const TARGET = "TemisMemoWidget";
const unquote = value => String(value ?? "").replace(/^"|"$/g, "");

/** Exported separately so generation and regeneration can be verified without prebuild. */
function configureWidgetProject(project, config) {
  const objects = project.hash.project.objects;
  const main = project.getFirstTarget();
  let entry = Object.entries(objects.PBXNativeTarget).find(([key, target]) => !key.endsWith("_comment") && unquote(target.name) === TARGET);
  if (!entry) {
    // node-xcode assumes these sections exist when adding the first extension.
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};
    const added = project.addTarget(TARGET, "app_extension", TARGET, `${config.ios.bundleIdentifier}.MemoWidget`);
    entry = [added.uuid, added.pbxNativeTarget];
    const group = project.addPbxGroup([], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", added.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", added.uuid);
    project.addSourceFile("TemisMemoWidget.swift", { target: added.uuid }, group.uuid);
    const strings = project.addFile("Localizable.xcstrings", group.uuid);
    strings.uuid = project.generateUuid();
    strings.target = added.uuid;
    objects.PBXFileReference[strings.fileRef].lastKnownFileType = "text.json.xcstrings";
    project.addToPbxBuildFileSection(strings);
    project.addToPbxResourcesBuildPhase(strings);
    project.addFile("Info.plist", group.uuid);
    // StripHeadersOnCopy keeps the embedded extension suitable for distribution.
    for (const file of Object.values(objects.PBXBuildFile)) {
      if (file && file.fileRef === added.pbxNativeTarget.productReference) file.settings = { ATTRIBUTES: ["RemoveHeadersOnCopy"] };
    }
  }
  const [, target] = entry;
  // Extension copying must precede RN/Firebase post-processing scripts. The
  // app Info.plist depends on the embedded extension, while Crashlytics reads
  // the app dSYM; putting the copy after Crashlytics creates a build cycle.
  const phases = main.firstTarget.buildPhases;
  const embeds = phases.filter(ref => {
    const phase = objects.PBXCopyFilesBuildPhase?.[ref.value];
    return phase?.files.some(file => objects.PBXBuildFile[file.value]?.fileRef === target.productReference);
  });
  if (embeds.length) {
    const remaining = phases.filter(ref => !embeds.includes(ref));
    const resourcesIndex = remaining.findIndex(ref => objects.PBXResourcesBuildPhase?.[ref.value]);
    remaining.splice(resourcesIndex + 1, 0, ...embeds);
    main.firstTarget.buildPhases = remaining;
  }
  const configs = objects.XCBuildConfiguration;
  const mainList = objects.XCConfigurationList[main.firstTarget.buildConfigurationList];
  const widgetList = objects.XCConfigurationList[target.buildConfigurationList];
  for (const ref of widgetList.buildConfigurations) {
    const build = configs[ref.value];
    const parentRef = mainList.buildConfigurations.find(item => unquote(configs[item.value].name) === unquote(build.name));
    const parent = configs[parentRef.value].buildSettings;
    Object.assign(build.buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: `"${config.ios.bundleIdentifier}.MemoWidget"`,
      PRODUCT_NAME: `"${TARGET}"`,
      INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
      MARKETING_VERSION: `"${config.version}"`,
      CURRENT_PROJECT_VERSION: `"${config.ios.buildNumber ?? "1"}"`,
      IPHONEOS_DEPLOYMENT_TARGET: "15.1",
      SWIFT_VERSION: "5.0",
      SDKROOT: "iphoneos",
      TARGETED_DEVICE_FAMILY: '"1,2"',
      APPLICATION_EXTENSION_API_ONLY: "YES",
      SKIP_INSTALL: "YES",
      CODE_SIGN_STYLE: "Automatic",
      GENERATE_INFOPLIST_FILE: "NO",
      CLANG_ENABLE_MODULES: "YES",
      SWIFT_EMIT_LOC_STRINGS: "YES",
      ...(parent.DEVELOPMENT_TEAM ? { DEVELOPMENT_TEAM: parent.DEVELOPMENT_TEAM } : {}),
    });
  }
  return project;
}

function withTemisMemoWidget(config) {
  // Tell EAS about the extra provisioning target before native generation.
  const bundleIdentifier = `${config.ios.bundleIdentifier}.MemoWidget`;
  const extensions = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  config.extra = { ...config.extra, eas: { ...config.extra?.eas, build: { ...config.extra?.eas?.build,
    experimental: { ...config.extra?.eas?.build?.experimental, ios: { ...config.extra?.eas?.build?.experimental?.ios,
      appExtensions: [...extensions.filter(item => item.targetName !== TARGET), { targetName: TARGET, bundleIdentifier }],
    } },
  } } };
  return withXcodeProject(config, config => {
    const destination = path.join(config.modRequest.platformProjectRoot, TARGET);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["TemisMemoWidget.swift", "Info.plist", "Localizable.xcstrings"]) {
      fs.copyFileSync(path.join(__dirname, "..", "native", TARGET, file), path.join(destination, file));
    }
    config.modResults = configureWidgetProject(config.modResults, config);
    return config;
  });
}

module.exports = createRunOncePlugin(withTemisMemoWidget, "with-temis-memo-widget", "1.0.0");
module.exports.configureWidgetProject = configureWidgetProject;
