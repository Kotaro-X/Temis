import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPENAI_EMBEDDING_MODEL,
  OpenAIEmbeddingAuthenticationError,
  OpenAIEmbeddingProvider,
} from "../src/services/OpenAIEmbeddingProvider.ts";

test("OpenAI embedding provider sends batches through the callable boundary", async () => {
  const requests: { input: string[]; region: string }[] = [];
  const provider = new OpenAIEmbeddingProvider({
    region: "asia-northeast1",
    requestEmbeddings: async (input, region) => {
      requests.push({ input, region });
      return {
        model: OPENAI_EMBEDDING_MODEL,
        embeddings: input.map((_, index) => [index + 0.1, index + 0.2]),
      };
    },
  });

  const embeddings = await provider.embedBatch([" first ", "second"]);

  assert.deepEqual(requests, [
    {
      input: ["first", "second"],
      region: "asia-northeast1",
    },
  ]);
  assert.deepEqual(embeddings, [[0.1, 0.2], [1.1, 1.2]]);
  assert.equal(provider.getDim(), 2);
  assert.equal(provider.getModel(), "text-embedding-3-small");
});

test("OpenAI embedding provider rejects wrong models and inconsistent dimensions", async () => {
  const wrongModel = new OpenAIEmbeddingProvider({
    region: "asia-northeast1",
    requestEmbeddings: async () => ({
      model: "unexpected-model",
      embeddings: [[0.1, 0.2]],
    }),
  });
  await assert.rejects(wrongModel.embed("query"), /unexpected model/);

  const inconsistent = new OpenAIEmbeddingProvider({
    region: "asia-northeast1",
    requestEmbeddings: async () => ({
      model: OPENAI_EMBEDDING_MODEL,
      embeddings: [[0.1, 0.2], [0.3, 0.4, 0.5]],
    }),
  });
  await assert.rejects(
    inconsistent.embedBatch(["first", "second"]),
    /dimension mismatch/,
  );
});

test("OpenAI embedding provider reports missing Firebase authentication without leaking the function error", async () => {
  const provider = new OpenAIEmbeddingProvider({
    region: "asia-northeast1",
    requestEmbeddings: async () => {
      throw { code: "functions/unauthenticated" };
    },
  });

  await assert.rejects(
    provider.embed("query"),
    (error: unknown) => error instanceof OpenAIEmbeddingAuthenticationError,
  );
});

test("Cloud Function keeps the OpenAI key server-side and requires Firebase auth", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(resolve(testDir, "../functions/index.js"), "utf8");

  assert.equal(source.includes('defineSecret("OPENAI_API_KEY")'), true);
  assert.equal(source.includes("if (!request.auth)"), true);
  assert.equal(source.includes("https://api.openai.com/v1/embeddings"), true);
  assert.equal(source.includes("console.log"), false);
  assert.equal(source.includes("console.error"), false);
  assert.equal(source.includes("maxInstances: 3"), true);
  assert.equal(source.includes("MAX_INPUTS = 20"), true);
  assert.equal(
    source.includes(
      "temis-embeddings@temis-c05aa.iam.gserviceaccount.com",
    ),
    true,
  );
});
