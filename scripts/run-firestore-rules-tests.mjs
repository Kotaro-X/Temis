import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const isWindows = process.platform === "win32";
const firebaseBinary = join(
  projectRoot,
  "node_modules",
  ".bin",
  isWindows ? "firebase.cmd" : "firebase",
);
const childMode = process.argv.includes("--run-tests");

const runRulesAssertions = () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      "[firestore-rules][configuration-error] FIRESTORE_EMULATOR_HOST is missing. The assertions will not be skipped.",
    );
    process.exit(41);
  }

  console.info(
    `[firestore-rules][assertions-started] Emulator detected at ${process.env.FIRESTORE_EMULATOR_HOST}; running 8 rules tests.`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--experimental-specifier-resolution=node",
      "--test",
      "tests/firestore-rules.test.ts",
    ],
    { cwd: projectRoot, env: process.env, stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    console.error(
      "[firestore-rules][assertion-failure] Firestore started, but one or more rules assertions failed.",
    );
    process.exit(42);
  }
  console.info("[firestore-rules][success] All 8 rules tests passed.");
};

if (childMode) {
  runRulesAssertions();
  process.exit(0);
}

const parseJavaMajor = (output) => {
  const match = output.match(/version\s+"(?:(1)\.)?(\d+)/i);
  if (!match) {
    return null;
  }
  return Number(match[2]);
};

const java = spawnSync("java", ["-version"], {
  cwd: projectRoot,
  encoding: "utf8",
});
if (java.error || java.status !== 0) {
  console.error(
    "[firestore-rules][java-error] Java could not be started. Install Java 17 or newer.",
  );
  process.exit(31);
}
const javaOutput = `${java.stdout ?? ""}\n${java.stderr ?? ""}`;
const javaMajor = parseJavaMajor(javaOutput);
if (javaMajor === null || javaMajor < 17) {
  console.error(
    `[firestore-rules][java-error] Java 17 or newer is required; detected ${javaMajor ?? "unknown"}.`,
  );
  process.exit(31);
}
console.info(`[firestore-rules][preflight] Java ${javaMajor} detected.`);

if (!existsSync(firebaseBinary)) {
  console.error(
    "[firestore-rules][firebase-cli-error] Local firebase-tools binary is missing. Run npm ci or npm install.",
  );
  process.exit(32);
}
const firebaseToolsPackage = JSON.parse(
  readFileSync(join(projectRoot, "node_modules", "firebase-tools", "package.json"), "utf8"),
);
console.info(
  `[firestore-rules][preflight] Using local firebase-tools ${firebaseToolsPackage.version}.`,
);

const assertPortAvailable = (port, label) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      reject(
        new Error(
          `[firestore-rules][port-conflict] ${label} port ${port} is unavailable (${error.code ?? error.name}).`,
        ),
      );
    });
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(resolve);
    });
  });

try {
  await assertPortAvailable(8080, "Firestore Emulator");
  await assertPortAvailable(4400, "Emulator Hub");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(33);
}

console.info(
  "[firestore-rules][emulator-start] Starting Firestore Emulator for project demo-wememo.",
);
const firebaseResult = spawnSync(
  firebaseBinary,
  [
    "emulators:exec",
    "--project",
    "demo-wememo",
    "--only",
    "firestore",
    "--log-verbosity",
    "INFO",
    "node scripts/run-firestore-rules-tests.mjs --run-tests",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      FIREBASE_CLI_DISABLE_UPDATE_CHECK: "1",
      FIRESTORE_RULES_TEST_REQUIRED: "1",
    },
    stdio: "inherit",
  },
);

if (firebaseResult.error) {
  console.error(
    `[firestore-rules][emulator-startup-error] Firebase CLI could not start: ${firebaseResult.error.name}.`,
  );
  process.exit(34);
}
if (firebaseResult.status !== 0) {
  console.error(
    "[firestore-rules][emulator-startup-error] Firebase Emulator execution failed. If an assertion-failure marker appears above, the Emulator started and the rules failed; otherwise inspect Java, ports, downloads, and Firebase CLI logs.",
  );
  process.exit(firebaseResult.status ?? 34);
}

console.info(
  "[firestore-rules][complete] Emulator stopped cleanly after successful rules tests.",
);
