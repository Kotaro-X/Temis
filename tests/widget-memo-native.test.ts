import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { configureWidgetProject } = require("../plugins/withTemisMemoWidget.js");
const xcode = require("xcode");

function fixture() {
  const project = xcode.project("/tmp/widget-test.pbxproj");
  project.hash = { project: { objects: {
    PBXProject: { PROJECT: { isa: "PBXProject", mainGroup: "ROOT", targets: [{ value: "APP", comment: "Temis" }] } },
    PBXNativeTarget: { APP: { isa: "PBXNativeTarget", name: "Temis", buildConfigurationList: "APP_CONFIGS", buildPhases: [{ value: "APP_RESOURCES", comment: "Resources" }, { value: "BUNDLE", comment: "Bundle React Native code and images" }, { value: "CRASHLYTICS", comment: "Crashlytics" }], dependencies: [] } },
    PBXResourcesBuildPhase: { APP_RESOURCES: { isa: "PBXResourcesBuildPhase", files: [] } },
    PBXShellScriptBuildPhase: { BUNDLE: { isa: "PBXShellScriptBuildPhase", name: "Bundle React Native code and images" }, CRASHLYTICS: { isa: "PBXShellScriptBuildPhase", name: "Crashlytics" } },
    PBXGroup: { ROOT: { isa: "PBXGroup", children: [], sourceTree: '"<group>"' }, PRODUCTS: { isa: "PBXGroup", name: "Products", children: [], sourceTree: '"<group>"' } },
    PBXFileReference: {}, PBXBuildFile: {},
    XCConfigurationList: { APP_CONFIGS: { isa: "XCConfigurationList", buildConfigurations: [{ value: "DEBUG" }, { value: "RELEASE" }] } },
    XCBuildConfiguration: { DEBUG: { name: "Debug", buildSettings: { DEVELOPMENT_TEAM: "TESTTEAM" } }, RELEASE: { name: "Release", buildSettings: { DEVELOPMENT_TEAM: "TESTTEAM" } } },
  } } };
  return project;
}

test("widget generation embeds an extension and survives regeneration without duplicates", () => {
  const project = fixture();
  const config = { version: "2.0.1", ios: { bundleIdentifier: "com.anonymous.WeMemo", buildNumber: "120" } };
  configureWidgetProject(project, config);
  const serialized = project.writeSync();
  configureWidgetProject(project, config);
  assert.equal(project.writeSync(), serialized);
  const objects = project.hash.project.objects;
  const targets = Object.entries(objects.PBXNativeTarget).filter(([key]) => !key.endsWith("_comment"));
  assert.equal(targets.length, 2);
  const widget: any = targets.find(([key]) => key !== "APP")![1];
  const configs = objects.XCConfigurationList[widget.buildConfigurationList].buildConfigurations;
  for (const ref of configs) {
    const build = objects.XCBuildConfiguration[ref.value].buildSettings;
    assert.equal(build.PRODUCT_BUNDLE_IDENTIFIER, '"com.anonymous.WeMemo.MemoWidget"');
    assert.equal(build.DEVELOPMENT_TEAM, "TESTTEAM");
    assert.equal(build.CURRENT_PROJECT_VERSION, '"120"');
    assert.equal(build.APPLICATION_EXTENSION_API_ONLY, "YES");
  }
  const embed: any = Object.entries(objects.PBXCopyFilesBuildPhase).find(([key]) => !key.endsWith("_comment"))![1];
  assert.equal(embed.dstSubfolderSpec, 13);
  assert.equal(embed.files.length, 1);
  assert.equal(objects.PBXNativeTarget.APP.dependencies.length, 1);
  const expectedPhases = objects.PBXNativeTarget.APP.buildPhases.map((ref: any) => ref.value);
  assert.deepEqual([expectedPhases[0], expectedPhases[2], expectedPhases[3]], ["APP_RESOURCES", "BUNDLE", "CRASHLYTICS"]);
  const embedRef = objects.PBXNativeTarget.APP.buildPhases.splice(1, 1)[0];
  objects.PBXNativeTarget.APP.buildPhases.push(embedRef);
  configureWidgetProject(project, config);
  assert.deepEqual(objects.PBXNativeTarget.APP.buildPhases.map((ref: any) => ref.value), expectedPhases, "regeneration repairs embed order ahead of dSYM-consuming scripts");
  configureWidgetProject(project, { ...config, version: "2.0.2", ios: { ...config.ios, buildNumber: "121" } });
  assert.equal(objects.XCBuildConfiguration[configs[0].value].buildSettings.CURRENT_PROJECT_VERSION, '"121"');
});

test("Swift entry point uses the same route and supports home and lock screen families", () => {
  const swift = readFileSync("native/TemisMemoWidget/TemisMemoWidget.swift", "utf8");
  assert.match(swift, /exp\+temis:\/\/memo\/new/);
  assert.match(swift, /\[\.systemSmall, \.accessoryCircular, \.accessoryRectangular\]/);
});
