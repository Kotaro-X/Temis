import fs from "node:fs";
import path from "node:path";

import {
  parseEnvFile,
  resolveFirebasePreflight,
  type FirebasePreflightLayer,
} from "../src/services/sync/firebasePreflight.ts";

type CliOptions = {
  envFiles: string[];
  includeProcessEnv: boolean;
  json: boolean;
};

type EnvFileReport = {
  path: string;
  exists: boolean;
  env: Record<string, string>;
};

const DEFAULT_ENV_FILES = [".env", ".env.local"];

const printHelp = () => {
  console.log(`Usage: bash scripts/cloud-sync-preflight.sh [options]

Options:
  --env-file <path>       Add an env file to load. Can be passed multiple times.
  --ignore-process-env    Only inspect env files, not current shell env.
  --json                  Print machine-readable JSON output.
  --help                  Show this help message.
`);
};

const parseArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    envFiles: [],
    includeProcessEnv: true,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-file") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--env-file requires a path.");
      }
      options.envFiles.push(next);
      index += 1;
      continue;
    }
    if (arg === "--ignore-process-env") {
      options.includeProcessEnv = false;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.envFiles.length === 0) {
    options.envFiles = [...DEFAULT_ENV_FILES];
  }

  return options;
};

const loadEnvFile = (rootDir: string, relativePath: string): EnvFileReport => {
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      path: relativePath,
      exists: false,
      env: {},
    };
  }
  return {
    path: relativePath,
    exists: true,
    env: parseEnvFile(fs.readFileSync(absolutePath, "utf8")),
  };
};

const buildReportPayload = (
  fileReports: EnvFileReport[],
  layers: FirebasePreflightLayer[],
  includeProcessEnv: boolean,
) => {
  const result = resolveFirebasePreflight(layers);
  return {
    status: result.configComplete ? "ok" : "error",
    includeProcessEnv,
    envFiles: fileReports.map((report) => ({
      path: report.path,
      exists: report.exists,
    })),
    keys: result.keys.map((entry) => ({
      name: entry.key,
      present: entry.present,
      source: entry.source,
    })),
    missingKeys: result.missingKeys,
    errorMessage: result.errorMessage,
  };
};

const printHumanReport = (
  payload: ReturnType<typeof buildReportPayload>,
) => {
  console.log("Cloud Sync preflight");
  console.log("");
  console.log("Env files:");
  for (const envFile of payload.envFiles) {
    console.log(`- ${envFile.path}: ${envFile.exists ? "found" : "missing"}`);
  }
  console.log(`- process.env: ${payload.includeProcessEnv ? "included" : "ignored"}`);
  console.log("");
  console.log("Required Firebase env vars:");
  for (const key of payload.keys) {
    if (key.present) {
      console.log(`- ${key.name}: set via ${key.source ?? "unknown source"}`);
      continue;
    }
    if (key.source) {
      console.log(`- ${key.name}: empty in ${key.source}`);
      continue;
    }
    console.log(`- ${key.name}: missing`);
  }
  console.log("");
  if (payload.status === "ok") {
    console.log("Result: Cloud Sync preflight passed.");
  } else {
    console.log(`Result: ${payload.errorMessage}`);
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(
    process.env.WEMEMO_ROOT_DIR && process.env.WEMEMO_ROOT_DIR.length > 0
      ? process.env.WEMEMO_ROOT_DIR
      : process.cwd(),
  );
  const fileReports = options.envFiles.map((envFile) => loadEnvFile(rootDir, envFile));
  const layers: FirebasePreflightLayer[] = fileReports
    .filter((report) => report.exists)
    .map((report) => ({
      label: report.path,
      env: report.env,
    }));

  if (options.includeProcessEnv) {
    layers.push({
      label: "process.env",
      env: process.env,
    });
  }

  const payload = buildReportPayload(
    fileReports,
    layers,
    options.includeProcessEnv,
  );

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport(payload);
  }

  if (payload.status !== "ok") {
    process.exitCode = 1;
  }
};

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
