import test from "node:test";
import assert from "node:assert/strict";

import { guardAnswerText } from "../src/services/answerGuardrails.ts";

test("answer guard rejects punctuation-only model output", () => {
  assert.deepEqual(guardAnswerText("。 。 。 。"), {
    ok: false,
    reason: "empty",
    answerText: "",
  });
  assert.deepEqual(guardAnswerText("...！？"), {
    ok: false,
    reason: "empty",
    answerText: "",
  });
});

test("answer guard retains substantive Japanese answer text", () => {
  assert.deepEqual(guardAnswerText("風の谷と都市の関係が述べられています"), {
    ok: true,
    reason: "ok",
    answerText: "風の谷と都市の関係が述べられています。",
  });
});
