import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexPath = decodeURIComponent(
  new URL("../firestore.indexes.json", import.meta.url).pathname,
);
const firebasePath = decodeURIComponent(
  new URL("../firebase.json", import.meta.url).pathname,
);

test("Firestore indexes support entity delta pagination by updatedAt and document id", () => {
  const config = JSON.parse(readFileSync(indexPath, "utf8")) as {
    indexes: Array<{
      collectionGroup: string;
      fields: Array<{ fieldPath: string; order: string }>;
    }>;
  };
  const firebase = JSON.parse(readFileSync(firebasePath, "utf8")) as {
    firestore: { indexes?: string };
  };

  assert.equal(firebase.firestore.indexes, "firestore.indexes.json");
  for (const entityCollection of ["tags", "todos", "tasks", "memos"]) {
    const index = config.indexes.find(
      (entry) => entry.collectionGroup === entityCollection,
    );
    assert.ok(index, `missing ${entityCollection} delta index`);
    assert.deepEqual(index.fields, [
      { fieldPath: "updatedAt", order: "ASCENDING" },
      { fieldPath: "__name__", order: "ASCENDING" },
    ]);
  }
});
