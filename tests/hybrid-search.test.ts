import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const loadHybridSearch = () => {
  const source = readFileSync("src/services/hybridSearch.ts", "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  vm.runInNewContext(code, {
    exports,
    console,
    require: (name: string) => {
      const dependencies: Record<string, unknown> = {
        "../db/chunkIndexRepo": {
          searchTopChunksByEmbedding: async () => [{
            chunkId: "unrelated-chunk",
            memoId: "unrelated",
            text: "GitHubの運用メモ",
            createdAt: 2,
            tags: [],
            similarity: 0.9,
          }],
          getChunksByMemoIds: async () => [{
            chunkId: "valley-chunk",
            memoId: "valley",
            text: "((風の谷))を作るための計画",
            createdAt: 1,
            tags: ["風の谷"],
          }],
        },
        "../db/tokenIndexRepo": {
          searchByTokens: async () => [],
          searchByQueryTextTokens: async () => [{
            token: "風の谷",
            memoId: "valley",
            createdAt: 1,
            updatedAt: 1,
            positions: [2],
            snippet: "((風の谷))を作るための計画",
          }],
        },
        "./EmbeddingProvider": {
          getEmbeddingProvider: () => ({
            embed: async () => [1, 0],
            getModel: () => "test-model",
            getDim: () => 2,
          }),
        },
        "../utils/wikiLink": {
          extractTokens: () => [],
          normalizeParens: (value: string) => value,
        },
      };
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return exports;
};

test("a Wiki token inside a natural question outranks an unrelated semantic hit", async () => {
  const service = loadHybridSearch();
  const results = await service.hybridSearch("風の谷を作るには何が必要？", {
    topK: 60,
    topN: 60,
  });
  assert.equal(results[0]?.memoId, "valley");
  assert.equal(results[0]?.queryTokenMatched, true);
  assert.equal(results[0]?.queryTokenSpecificity, 3);
  assert.equal(results[1]?.memoId, "unrelated");
});
