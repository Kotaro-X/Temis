import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const loadAIService = (answer: {
  answerText: string;
  citedEvidenceKeys: string[];
  insufficientEvidence?: boolean;
}) => {
  const source = readFileSync("src/ai/aiService.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  const evidence = [{
    memoId: "unrelated",
    chunkId: "chunk",
    snippetText: "質問とは無関係なメモ",
    createdAt: 1,
    key: "E1",
    evidenceKey: "E1",
  }];
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      const dependencies: Record<string, unknown> = {
        "../services/answerWithCitations": {
          answerWithCitations: async () => answer,
        },
        "../services/aiEvidence": {
          labelAnswerEvidence: () => evidence,
        },
        "./answerParser": {
          parseAIResponse: (value: unknown) => value,
        },
        "./contextBuilder": {
          buildAIContext: async () => evidence,
        },
        "./promptBuilder": {
          buildAIQuery: (value: string) => value.trim(),
        },
        "../services/freemium/temisFreemiumService": {
          cancelTemisAIUsage: async () => undefined,
          completeTemisAIUsage: async () => undefined,
        },
      };
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports;
};

test("insufficient grounded answers clear unrelated evidence from the UI result", async () => {
  const service = loadAIService({
    answerText: "",
    citedEvidenceKeys: [],
    insufficientEvidence: true,
  });
  const result = await service.searchAndGenerateAnswer("風の谷を作るには何が必要？");
  assert.equal(result.answer.answerText, "");
  assert.deepEqual(Array.from(result.answer.citedEvidenceKeys), []);
  assert.deepEqual(Array.from(result.allEvidence), []);
});
