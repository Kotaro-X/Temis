import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = new URL("../", import.meta.url);
const testsDirectory = new URL("../tests/", import.meta.url);
const excludedTests = new Set([
  "firestore-rules.test.ts",
  "migrations.test.ts",
]);
const testFiles = readdirSync(testsDirectory)
  .filter((name) => name.endsWith(".test.ts") && !excludedTests.has(name))
  .sort()
  .map((name) => join("tests", name));

if (testFiles.length === 0) {
  console.error("[unit-tests] No unit test files were found.");
  process.exit(1);
}

console.info(
  `[unit-tests] Running ${testFiles.length} files; Firestore Rules and migration tests run in dedicated CI steps.`,
);
const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--experimental-specifier-resolution=node",
    "--test",
    ...testFiles,
  ],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`[unit-tests] Failed to start Node test runner: ${result.error.name}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
