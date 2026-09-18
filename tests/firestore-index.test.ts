import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexPath = decodeURIComponent(
  new URL("../firestore.indexes.json", import.meta.url).pathname,
);
const firebasePath = decodeURIComponent(
  new URL("../firebase.json", import.meta.url).pathname,
);

test("Firestore delta pagination relies on automatic updatedAt indexes", () => {
  const config = JSON.parse(readFileSync(indexPath, "utf8")) as {
    indexes: {
      collectionGroup: string;
      fields: { fieldPath: string; order: string }[];
    }[];
  };
  const firebase = JSON.parse(readFileSync(firebasePath, "utf8")) as {
    firestore: { indexes?: string };
  };

  assert.equal(firebase.firestore.indexes, "firestore.indexes.json");
  for (const entityCollection of ["tags", "todos", "tasks", "memos"]) {
    const index = config.indexes.find(
      (entry) => entry.collectionGroup === entityCollection,
    );
    assert.equal(
      index,
      undefined,
      `${entityCollection} must use Firestore's automatic single-field index`,
    );
  }
});

test("Firestore indexes support an owner's Guild history including unpublished posts", () => {
  const config = JSON.parse(readFileSync(indexPath, "utf8")) as {
    indexes: {
      collectionGroup: string;
      fields: { fieldPath: string; order: string }[];
    }[];
  };
  const ownerHistory = config.indexes.find(
    (entry) => entry.collectionGroup === "guildPosts"
      && entry.fields[0]?.fieldPath === "authorUserId",
  );

  assert.ok(ownerHistory, "missing Guild owner-history index");
  assert.deepEqual(ownerHistory.fields, [
    { fieldPath: "authorUserId", order: "ASCENDING" },
    { fieldPath: "updatedAt", order: "DESCENDING" },
  ]);
});

test("Firestore indexes support filtered Guild vector search", () => {
  const config = JSON.parse(readFileSync(indexPath, "utf8")) as {
    indexes: {
      collectionGroup: string;
      fields: {
        fieldPath: string;
        order?: string;
        vectorConfig?: { dimension: number; flat: Record<string, never> };
      }[];
    }[];
  };
  const vectorIndex = config.indexes.find(
    (entry) => entry.collectionGroup === "guildPostAIIndex",
  );
  assert.ok(vectorIndex, "missing Guild AI vector index");
  assert.deepEqual(vectorIndex.fields, [
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "moderationVisibility", order: "ASCENDING" },
    { fieldPath: "embedding", vectorConfig: { dimension: 1536, flat: {} } },
  ]);
});
