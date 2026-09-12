import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import accountDeletion from "./accountDeletion.cjs";

export const deleteAccount = accountDeletion.deleteAccount;

const openAiApiKey = defineSecret("OPENAI_API_KEY");
// The project has no Compute Engine default service account. Use a dedicated,
// least-privilege runtime identity instead of enabling a broad default account.
const EMBEDDING_RUNTIME_SERVICE_ACCOUNT =
  "temis-embeddings@temis-c05aa.iam.gserviceaccount.com";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_INPUTS = 20;
const MAX_INPUT_CHARS = 4_000;
const MAX_TOTAL_CHARS = 40_000;

const invalidArgument = (message) =>
  new HttpsError("invalid-argument", message);

const readInputs = (data) => {
  if (!data || typeof data !== "object" || !Array.isArray(data.input)) {
    throw invalidArgument("input must be an array of strings.");
  }
  if (data.input.length === 0 || data.input.length > MAX_INPUTS) {
    throw invalidArgument(`input must contain 1 to ${MAX_INPUTS} strings.`);
  }

  let totalChars = 0;
  const inputs = data.input.map((value) => {
    if (typeof value !== "string") {
      throw invalidArgument("input must contain only strings.");
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_INPUT_CHARS) {
      throw invalidArgument(
        `Each input must contain 1 to ${MAX_INPUT_CHARS} characters.`,
      );
    }
    totalChars += normalized.length;
    return normalized;
  });

  if (totalChars > MAX_TOTAL_CHARS) {
    throw invalidArgument(
      `The combined input must not exceed ${MAX_TOTAL_CHARS} characters.`,
    );
  }
  return inputs;
};

const readEmbeddingResponse = (body, expectedCount) => {
  if (!body || typeof body !== "object" || !Array.isArray(body.data)) {
    throw new HttpsError("internal", "Embedding response was invalid.");
  }
  const ordered = [...body.data].sort((left, right) => {
    const leftIndex = Number.isInteger(left?.index) ? left.index : -1;
    const rightIndex = Number.isInteger(right?.index) ? right.index : -1;
    return leftIndex - rightIndex;
  });
  const embeddings = ordered.map((item) => item?.embedding);
  if (
    embeddings.length !== expectedCount ||
    ordered.some((item, index) => item?.index !== index) ||
    embeddings.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length === 0 ||
        vector.some((value) => typeof value !== "number" || !Number.isFinite(value)),
    )
  ) {
    throw new HttpsError("internal", "Embedding response was invalid.");
  }
  return embeddings;
};

export const createEmbeddings = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 60,
    maxInstances: 3,
    serviceAccount: EMBEDDING_RUNTIME_SERVICE_ACCOUNT,
    secrets: [openAiApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in is required to use AI memo search.",
      );
    }
    const input = readInputs(request.data);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new HttpsError(
          "resource-exhausted",
          "AI memo search is temporarily busy. Please try again shortly.",
        );
      }
      if (response.status >= 500) {
        throw new HttpsError(
          "unavailable",
          "AI memo search is temporarily unavailable.",
        );
      }
      throw new HttpsError(
        "failed-precondition",
        "AI memo search is not configured correctly.",
      );
    }

    const embeddings = readEmbeddingResponse(await response.json(), input.length);
    return { model: EMBEDDING_MODEL, embeddings };
  },
);
