import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const grounded = require("../functions/groundedAnswerCore.cjs") as {
  generateGroundedAnswer: (input: {
    apiKey: string;
    data: unknown;
    fetchImpl: typeof fetch;
  }) => Promise<{ model: string; answerText: string; citedEvidenceKeys: string[] }>;
  readGroundedAnswerInput: (data: unknown) => unknown;
};

test("grounded answer uses structured Responses output without storing the response", async () => {
  let requestBody: Record<string, unknown> = {};
  const result = await grounded.generateGroundedAnswer({
    apiKey: "test-key",
    data: {
      question: "田舎をよくするには？",
      evidence: [{ key: "E1", text: "田舎は都市と相互補完する必要がある。" }],
    },
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        output: [{
          content: [{
            type: "output_text",
            text: JSON.stringify({
              answerText: "田舎と都市が互いの強みを補う関係が重要です。",
              citedEvidenceKeys: ["E1"],
            }),
          }],
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
  });

  assert.equal(result.model, "gpt-5.6-luna");
  assert.deepEqual(result.citedEvidenceKeys, ["E1"]);
  assert.equal(requestBody?.store, false);
  assert.equal(requestBody?.model, "gpt-5.6-luna");
  assert.equal((requestBody?.text as { format?: { type?: string } })?.format?.type, "json_schema");
});

test("grounded answer rejects oversized, duplicate, and unknown evidence", async () => {
  assert.throws(
    () => grounded.readGroundedAnswerInput({
      question: "質問",
      evidence: [{ key: "E1", text: "a" }, { key: "E1", text: "b" }],
    }),
    /unique safe identifiers/,
  );

  await assert.rejects(
    grounded.generateGroundedAnswer({
      apiKey: "test-key",
      data: { question: "質問", evidence: [{ key: "E1", text: "根拠" }] },
      fetchImpl: (async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify({
          answerText: "回答です。",
          citedEvidenceKeys: ["E9"],
        }) }] }],
      }), { status: 200 })) as typeof fetch,
    }),
    /unusable grounded answer/,
  );
});

test("grounded answer exposes only the upstream status on OpenAI failures", async () => {
  await assert.rejects(
    grounded.generateGroundedAnswer({
      apiKey: "test-key",
      data: { question: "質問", evidence: [{ key: "E1", text: "根拠" }] },
      fetchImpl: (async () => new Response("secret upstream response", { status: 429 })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes("secret upstream response") &&
      (error as Error & { status?: number }).status === 429,
  );
});

test("grounded answer rejects punctuation-only model output", async () => {
  await assert.rejects(
    grounded.generateGroundedAnswer({
      apiKey: "test-key",
      data: { question: "質問", evidence: [{ key: "E1", text: "根拠" }] },
      fetchImpl: (async () => new Response(JSON.stringify({
        output: [{ content: [{ type: "output_text", text: JSON.stringify({
          answerText: "。。。！？",
          citedEvidenceKeys: ["E1"],
        }) }] }],
      }), { status: 200 })) as typeof fetch,
    }),
    /unusable grounded answer/,
  );
});

test("grounded answer rejects empty and malformed structured output", async () => {
  for (const text of ["", "not-json"]) {
    await assert.rejects(
      grounded.generateGroundedAnswer({
        apiKey: "test-key",
        data: { question: "質問", evidence: [{ key: "E1", text: "根拠" }] },
        fetchImpl: (async () => new Response(JSON.stringify({
          output: text ? [{ content: [{ type: "output_text", text }] }] : [],
        }), { status: 200 })) as typeof fetch,
      }),
      /no answer text|invalid JSON/,
    );
  }
});

test("grounded answer retains 5xx status without returning upstream content", async () => {
  await assert.rejects(
    grounded.generateGroundedAnswer({
      apiKey: "test-key",
      data: { question: "質問", evidence: [{ key: "E1", text: "根拠" }] },
      fetchImpl: (async () => new Response("upstream failure details", { status: 503 })) as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes("upstream failure details") &&
      (error as Error & { status?: number }).status === 503,
  );
});
