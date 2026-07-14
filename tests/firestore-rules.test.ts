import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type TokenOptions,
} from "@firebase/rules-unit-testing";

const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE_FIRESTORE_EMULATOR =
  process.env.CI === "true" ||
  process.env.FIRESTORE_RULES_TEST_REQUIRED === "1";
const RULES_PATH = decodeURIComponent(
  new URL("../firestore.rules", import.meta.url).pathname,
);

const createGoogleToken = (overrides?: Record<string, unknown>): TokenOptions => ({
  firebase: {
    sign_in_provider: "google.com",
  },
  ...overrides,
});

const createTodoEnvelope = (id = "todo-1") => ({
  schemaVersion: 3,
  entityType: "todo",
  entityId: id,
  record: {
    id,
    text: "Buy milk",
    memo: "",
    tags: ["Home"],
    isDone: false,
    createdAt: 1_783_292_400_000,
    doneAt: null,
    reminderDate: null,
    reminderTime: null,
    repeat: "none",
    notificationId: null,
    notificationIds: [],
    seriesId: null,
    seriesAnchorDate: null,
    occurrenceDate: null,
    isDeleted: false,
  },
  updatedAt: 1_783_292_400_000,
  isDeleted: false,
  deletedAt: null,
  deviceId: null,
});

const createTaskEnvelope = (id = "task-1") => ({
  schemaVersion: 3,
  entityType: "task",
  entityId: id,
  record: {
    kind: "state",
    date: "2026-07-11",
    slotKey: "morning",
    task: {
      id: "task-state-1",
      taskName: "Plan the day",
      tags: ["Work"],
      estimateMinutes: 30,
      elapsedMinutes: 0,
      status: "TODO",
      isArchived: false,
      startAt: null,
    },
  },
  updatedAt: 1_783_292_400_000,
  isDeleted: false,
  deletedAt: null,
  deviceId: "device-1",
});

const createMemoEnvelope = (id = "memo-1") => ({
  schemaVersion: 3,
  entityType: "memo",
  entityId: id,
  record: {
    kind: "note",
    data: {
      id,
      type: "free",
      date: null,
      title: "A note",
      body: "The note body",
      updatedAt: 1_783_292_400_000,
    },
  },
  updatedAt: 1_783_292_400_000,
  isDeleted: false,
  deletedAt: null,
  deviceId: null,
});

const createTag = (id = "tag-1") => ({
  id,
  name: "Home",
  order: 0,
  createdAt: 1_783_292_400_000,
  updatedAt: 1_783_292_400_000,
  archivedAt: null,
  isDeleted: false,
  deletedAt: null,
  deviceId: null,
});

if (!FIRESTORE_EMULATOR_HOST) {
  if (REQUIRE_FIRESTORE_EMULATOR) {
    test("firestore rules tests require emulator", () => {
      assert.fail(
        "FIRESTORE_EMULATOR_HOST is required in CI and dedicated rules tests. Run npm run test:firestore-rules.",
      );
    });
  } else {
    test("firestore rules tests require emulator", { skip: true }, () => {
      assert.ok(true);
    });
  }
} else {
  test("temporary required-check verification failure", () => {
    assert.fail("Intentional failure used to verify required status checks.");
  });

  let env: RulesTestEnvironment;

  test.before(async () => {
    env = await initializeTestEnvironment({
      projectId: "demo-wememo",
      firestore: {
        rules: readFileSync(RULES_PATH, "utf8"),
      },
    });
  });

  test.after(async () => {
    await env.cleanup();
  });

  test.afterEach(async () => {
    await env.clearFirestore();
  });

  test("users can read and write only their own four sync collections", async () => {
    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();
    const bobDb = env.authenticatedContext(
      "bob",
      createGoogleToken({ email: "bob@example.com" }),
    ).firestore();

    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("tags").doc("tag-1").set(
        createTag(),
      ),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("todos").doc("todo-1").set(
        createTodoEnvelope(),
      ),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("tasks").doc("task-1").set(
        createTaskEnvelope(),
      ),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("memos").doc("memo-1").set(
        createMemoEnvelope(),
      ),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("tags").doc("tag-1").get(),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("todos").doc("todo-1").get(),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("tasks").doc("task-1").get(),
    );
    await assertSucceeds(
      aliceDb.collection("users").doc("alice").collection("memos").doc("memo-1").get(),
    );

    await assertFails(
      bobDb.collection("users").doc("alice").collection("todos").doc("todo-2").set(
        createTodoEnvelope("todo-2"),
      ),
    );
  });

  test("unknown user subcollections are denied to owners and admins", async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore()
        .collection("users")
        .doc("alice")
        .collection("internalSettings")
        .doc("sync")
        .set({ secret: "not client data" });
    });

    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();
    const adminDb = env.authenticatedContext(
      "admin-user",
      createGoogleToken({ admin: true, email: "admin@example.com" }),
    ).firestore();

    const unknownRef = aliceDb.collection("users")
      .doc("alice")
      .collection("internalSettings")
      .doc("sync");
    const nestedUnknownRef = aliceDb.collection("users")
      .doc("alice")
      .collection("todos")
      .doc("todo-1")
      .collection("private")
      .doc("metadata");

    await assertFails(unknownRef.get());
    await assertFails(unknownRef.set({ secret: "changed" }));
    await assertFails(nestedUnknownRef.set({ secret: "nope" }));
    await assertFails(
      adminDb.collection("users").doc("alice").collection("internalSettings").doc("sync").get(),
    );
  });

  test("sync documents reject unknown fields, invalid types, and oversized values", async () => {
    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();

    await assertFails(
      aliceDb.collection("users").doc("alice").collection("todos").doc("todo-1").set({
        ...createTodoEnvelope(),
        unexpectedInternalFlag: true,
      }),
    );
    await assertFails(
      aliceDb.collection("users").doc("alice").collection("todos").doc("todo-1").set({
        ...createTodoEnvelope(),
        updatedAt: "not-a-timestamp",
      }),
    );
    await assertFails(
      aliceDb.collection("users").doc("alice").collection("tags").doc("tag-1").set({
        ...createTag(),
        name: "x".repeat(201),
      }),
    );
    await assertFails(
      aliceDb.collection("users").doc("alice").collection("todos").doc("todo-1").set({
        ...createTodoEnvelope(),
        record: {
          ...createTodoEnvelope().record,
          tags: "not-a-list",
        },
      }),
    );
  });

  test("sync documents reject stale updates and accept logical tombstones", async () => {
    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();
    const todoRef = aliceDb.collection("users")
      .doc("alice")
      .collection("todos")
      .doc("todo-1");
    const current = { ...createTodoEnvelope(), updatedAt: 200 };

    await assertSucceeds(todoRef.set(current));
    await assertFails(todoRef.set({ ...current, updatedAt: 100 }));
    await assertSucceeds(
      todoRef.set({
        ...current,
        record: { ...current.record, isDeleted: true },
        updatedAt: 300,
        isDeleted: true,
        deletedAt: 300,
      }),
    );
  });

  test("normal users cannot self-assign staff grants", async () => {
    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();

    await assertFails(
      aliceDb.collection("subscriptionAccess").doc("alice").set({
        userId: "alice",
        active: true,
        grantType: "staff_free",
        inviteCode: null,
        offeringId: null,
        packageId: null,
        expiresAt: null,
        grantedBy: "alice",
        note: "self grant",
        redeemedAt: null,
        updatedAt: Date.now(),
      }),
    );
  });

  test("admin claim can write staff grants", async () => {
    const adminDb = env.authenticatedContext(
      "admin-user",
      createGoogleToken({ admin: true, email: "admin@example.com" }),
    ).firestore();

    await assertSucceeds(
      adminDb.collection("subscriptionAccess").doc("alice").set({
        userId: "alice",
        active: true,
        grantType: "staff_free",
        inviteCode: null,
        offeringId: null,
        packageId: null,
        expiresAt: null,
        grantedBy: "admin-user",
        note: "staff grant",
        redeemedAt: null,
        updatedAt: Date.now(),
      }),
    );
  });

  test("google users can redeem invite_free codes only through the expected transaction shape", async () => {
    const now = 1_783_292_400_000;

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("inviteCodes").doc("FREE-ALPHA").set({
        code: "FREE-ALPHA",
        active: true,
        grantType: "invite_free",
        offeringId: null,
        packageId: null,
        expiresAt: null,
        maxRedemptions: 5,
        redeemedCount: 0,
        createdBy: "admin-user",
        note: "alpha invite",
        updatedAt: now,
      });
    });

    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({
        email: "alice@example.com",
        name: "Alice",
      }),
    ).firestore();

    await assertSucceeds(
      aliceDb.runTransaction(async (transaction) => {
        const inviteRef = aliceDb.collection("inviteCodes").doc("FREE-ALPHA");
        const accessRef = aliceDb.collection("subscriptionAccess").doc("alice");
        const redemptionRef = inviteRef.collection("redemptions").doc("alice");

        transaction.set(
          accessRef,
          {
            userId: "alice",
            active: true,
            grantType: "invite_free",
            inviteCode: "FREE-ALPHA",
            offeringId: null,
            packageId: null,
            expiresAt: null,
            grantedBy: "admin-user",
            note: "alpha invite",
            redeemedAt: now,
            updatedAt: now,
          },
          { merge: true },
        );
        transaction.set(redemptionRef, {
          userId: "alice",
          inviteCode: "FREE-ALPHA",
          grantType: "invite_free",
          email: "alice@example.com",
          name: "Alice",
          redeemedAt: now,
        });
        transaction.update(inviteRef, {
          redeemedCount: 1,
          updatedAt: now,
        });
      }),
    );
  });

  test("invite codes cannot be incremented directly without matching grant and redemption writes", async () => {
    const now = 1_783_292_400_000;

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("inviteCodes").doc("FREE-ALPHA").set({
        code: "FREE-ALPHA",
        active: true,
        grantType: "invite_free",
        offeringId: null,
        packageId: null,
        expiresAt: null,
        maxRedemptions: 5,
        redeemedCount: 0,
        createdBy: "admin-user",
        note: "alpha invite",
        updatedAt: now,
      });
    });

    const aliceDb = env.authenticatedContext(
      "alice",
      createGoogleToken({ email: "alice@example.com" }),
    ).firestore();

    await assertFails(
      aliceDb.collection("inviteCodes").doc("FREE-ALPHA").update({
        redeemedCount: 1,
        updatedAt: now,
      }),
    );
  });
}
