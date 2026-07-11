import process from "node:process";

import { getAuth } from "firebase-admin/auth";
import {
  initializeAdminApp,
  parseBoolean,
  takeValue,
} from "./firebase-admin-runtime.ts";

type Args = {
  uid: string | null;
  email: string | null;
  admin: boolean;
  serviceAccountPath: string | null;
  projectId: string | null;
};

const USAGE = `
Usage:
  npm run firebase:set-admin-claim -- --uid <FIREBASE_UID>
  npm run firebase:set-admin-claim -- --email <EMAIL>

Options:
  --uid <uid>                 Target Firebase Auth user id
  --email <email>             Target Firebase Auth email
  --admin <true|false>        Set or clear the admin custom claim (default: true)
  --service-account <path>    Optional service account JSON path
  --project-id <projectId>    Optional Firebase project id override

Credential sources:
  1. --service-account <path>
  2. GOOGLE_APPLICATION_CREDENTIALS / ADC via applicationDefault()
`.trim();

const parseArgs = (argv: string[]): Args => {
  const next: Args = {
    uid: null,
    email: null,
    admin: true,
    serviceAccountPath: null,
    projectId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--uid":
        next.uid = takeValue(argv, index, token);
        index += 1;
        break;
      case "--email":
        next.email = takeValue(argv, index, token);
        index += 1;
        break;
      case "--admin":
        next.admin = parseBoolean(takeValue(argv, index, token), true);
        index += 1;
        break;
      case "--service-account":
        next.serviceAccountPath = takeValue(argv, index, token);
        index += 1;
        break;
      case "--project-id":
        next.projectId = takeValue(argv, index, token);
        index += 1;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if ((next.uid ? 1 : 0) + (next.email ? 1 : 0) !== 1) {
    throw new Error("Specify exactly one of --uid or --email.");
  }

  return next;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const app = initializeAdminApp(args);
  const auth = getAuth(app);

  const user = args.uid
    ? await auth.getUser(args.uid)
    : await auth.getUserByEmail(args.email as string);

  const currentClaims = user.customClaims ?? {};
  const nextClaims = { ...currentClaims };
  if (args.admin) {
    nextClaims.admin = true;
  } else {
    delete nextClaims.admin;
  }

  await auth.setCustomUserClaims(user.uid, nextClaims);

  console.log(
    JSON.stringify(
      {
        uid: user.uid,
        email: user.email ?? null,
        admin: args.admin,
        customClaims: nextClaims,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  console.error(USAGE);
  process.exit(1);
});
