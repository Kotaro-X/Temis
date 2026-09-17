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
import { doc, writeBatch } from "firebase/firestore";

const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const REQUIRE_FIRESTORE_EMULATOR =
  process.env.CI === "true" ||
  process.env.FIRESTORE_RULES_TEST_REQUIRED === "1";
const RULES_PATH = decodeURIComponent(
  new URL("../firestore.rules", import.meta.url).pathname,
);

const createProviderToken = (
  provider: "google.com" | "apple.com" | "password",
  overrides?: Record<string, unknown>,
): TokenOptions => ({
  firebase: {
    sign_in_provider: provider,
  },
  ...overrides,
});

const createGoogleToken = (overrides?: Record<string, unknown>): TokenOptions =>
  createProviderToken("google.com", overrides);

const createAppleToken = (overrides?: Record<string, unknown>): TokenOptions =>
  createProviderToken("apple.com", overrides);

const createPasswordToken = (overrides?: Record<string, unknown>): TokenOptions =>
  createProviderToken("password", overrides);

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
      scope: "personal",
      projectId: null,
      updatedAt: 1_783_292_400_000,
    },
  },
  updatedAt: 1_783_292_400_000,
  isDeleted: false,
  deletedAt: null,
  deviceId: null,
});

const createLegacyMemoEnvelope = (id = "memo-legacy") => ({
  ...createMemoEnvelope(id),
  record: {
    kind: "note",
    data: {
      id,
      type: "free",
      date: null,
      title: "Old note",
      body: "Old note body",
      updatedAt: 1_783_292_400_000,
    },
  },
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
      aliceDb.collection("users").doc("alice").collection("memos").doc("memo-legacy").set(
        createLegacyMemoEnvelope(),
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

  test("Apple profiles claim usernames atomically and project notes stay member-only", async () => {
    const aliceDb = env.authenticatedContext("alice", createAppleToken()).firestore();
    const bobDb = env.authenticatedContext("bob", createGoogleToken()).firestore();
    const profile = {
      userId: "alice", username: "alice", displayName: "Alice", photoUrl: null,
      bio: null, interestTags: [], skillTags: [], affiliation: null,
      profileVisibility: "public", connectionRequestPolicy: "everyone",
      createdAt: 1, updatedAt: 1, usernameChangedAt: null,
    };
    const profileBatch = writeBatch(aliceDb);
    profileBatch.set(doc(aliceDb, "usernames", "alice"), {
      userId: "alice", username: "alice", reservedUntil: null, updatedAt: 1,
    });
    profileBatch.set(doc(aliceDb, "profiles", "alice"), profile);
    await assertSucceeds(profileBatch.commit());

    const project = {
      id: "project-1", name: "Private", description: null, ownerUserId: "alice",
      icon: null, tags: [], visibility: "invite_only", joinPolicy: "invitation_only",
      invitationPolicy: "owner_only", taskEnabled: false, createdAt: 1, updatedAt: 1,
      deletedAt: null,
    };
    const projectBatch = writeBatch(aliceDb);
    projectBatch.set(doc(aliceDb, "projects", "project-1"), project);
    projectBatch.set(doc(aliceDb, "projects", "project-1", "members", "alice"), {
      userId: "alice", role: "owner", invitationId: null, joinedAt: 1, updatedAt: 1,
    });
    projectBatch.set(doc(aliceDb, "projectMemberships", "project-1__alice"), {
      id: "project-1__alice", projectId: "project-1", userId: "alice", role: "owner", updatedAt: 1,
    });
    await assertSucceeds(projectBatch.commit());
    await assertSucceeds(aliceDb.collection("projectNotes").doc("note-1").set({
      id: "note-1", ownerUserId: "alice", projectId: "project-1", sourceNoteId: "local-1",
      title: "Shared", body: "only members", updatedAt: 1,
    }));
    await assertFails(bobDb.collection("projectNotes").doc("note-1").get());
    await assertSucceeds(aliceDb.collection("projectNotes").doc("note-1").get());
    await assertSucceeds(
      aliceDb.collection("projectMemberships").where("userId", "==", "alice").get(),
    );
  });

  test("unsupported account providers cannot create collaboration profiles", async () => {
    const passwordDb = env.authenticatedContext(
      "password-user",
      createPasswordToken({ email: "password@example.com" }),
    ).firestore();
    const profileBatch = writeBatch(passwordDb);
    profileBatch.set(doc(passwordDb, "usernames", "password_user"), {
      userId: "password-user",
      username: "password_user",
      reservedUntil: null,
      updatedAt: 1,
    });
    profileBatch.set(doc(passwordDb, "profiles", "password-user"), {
      userId: "password-user",
      username: "password_user",
      displayName: "Password User",
      photoUrl: null,
      bio: null,
      interestTags: [],
      skillTags: [],
      affiliation: null,
      profileVisibility: "public",
      connectionRequestPolicy: "everyone",
      createdAt: 1,
      updatedAt: 1,
      usernameChangedAt: null,
    });

    await assertFails(profileBatch.commit());
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

  test("Apple users can redeem invite_free codes only through the expected transaction shape", async () => {
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
      createAppleToken({
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

  test("connection requests query before create and remain participant-only", async () => {
    const aliceDb = env.authenticatedContext("alice", createGoogleToken()).firestore();
    const bobDb = env.authenticatedContext("bob", createAppleToken()).firestore();
    const carolDb = env.authenticatedContext("carol", createGoogleToken()).firestore();
    const missingRef = aliceDb.collection("connections").doc("alice__bob");
    const pending = {
      id: "alice__bob",
      userIds: ["alice", "bob"],
      requesterUserId: "alice",
      recipientUserId: "bob",
      status: "pending",
      createdAt: 1,
      updatedAt: 1,
    };

    await assertFails(aliceDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(missingRef);
      if (!snapshot.exists) transaction.set(missingRef, pending);
    }));

    await assertSucceeds(
      aliceDb.collection("connections")
        .where("userIds", "array-contains", "alice")
        .get(),
    );
    await assertSucceeds(missingRef.set(pending));
    await assertSucceeds(
      bobDb.collection("connections").where("userIds", "array-contains", "bob").get(),
    );
    await assertFails(carolDb.collection("connections").doc("alice__bob").get());
    await assertSucceeds(
      carolDb.collection("connections").where("userIds", "array-contains", "carol").get(),
    );
    await assertFails(missingRef.update({ status: "connected", updatedAt: 2 }));
    await assertSucceeds(
      bobDb.collection("connections").doc("alice__bob").update({ status: "connected", updatedAt: 2 }),
    );
  });

  test("Guild posts are public only while visible, owner-editable, and staff-moderated", async () => {
    const now = 1_783_292_400_000;
    const aliceDb = env.authenticatedContext("guild-alice", createAppleToken()).firestore();
    const bobDb = env.authenticatedContext("guild-bob", createGoogleToken()).firestore();
    const staffDb = env.authenticatedContext("guild-staff", createGoogleToken()).firestore();
    const post = {
      id: "guild-post-1", authorUserId: "guild-alice", authorDisplayName: "Alice", authorPhotoUrl: null,
      // A personal Guild post may contain Wiki links or ordinary text only;
      // hashtags are optional and are represented as an empty list.
      body: "公開する探究", tags: [], type: "personal", projectId: null,
      source: { scope: "personal", memoId: "private-memo-1" }, status: "published",
      moderation: { visibility: "visible", hiddenByUserId: null, hiddenAt: null, reason: null },
      createdAt: now, updatedAt: now, publishedAt: now,
    };
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("subscriptionAccess").doc("guild-staff").set({
        userId: "guild-staff", active: true, grantType: "staff_free", inviteCode: null,
        offeringId: null, packageId: null, expiresAt: null, grantedBy: "admin", note: null,
        redeemedAt: null, updatedAt: now,
      });
    });

    await assertSucceeds(aliceDb.collection("guildPosts").doc(post.id).set(post));
    await assertSucceeds(
      bobDb.collection("connections").where("userIds", "array-contains", "guild-bob").get(),
    );
    await assertSucceeds(bobDb.collection("guildPosts").doc(post.id).get());
    await assertSucceeds(bobDb.collection("guildPosts")
      .where("status", "==", "published")
      .where("moderation.visibility", "==", "visible")
      .orderBy("publishedAt", "desc")
      .orderBy("__name__", "desc")
      .get());
    await assertFails(bobDb.collection("guildPosts").doc(post.id).update({ body: "改ざん" }));
    await assertFails(bobDb.collection("guildPosts").doc(post.id).update({ status: "unpublished", publishedAt: null }));
    await assertSucceeds(aliceDb.collection("guildPosts").doc(post.id).update({
      status: "unpublished",
      publishedAt: null,
      updatedAt: now + 1,
    }));
    await assertSucceeds(aliceDb.collection("guildPosts").doc(post.id).get());
    await assertSucceeds(
      aliceDb.collection("guildPosts")
        .where("authorUserId", "==", "guild-alice")
        .orderBy("updatedAt", "desc")
        .orderBy("__name__", "desc")
        .get(),
    );
    await assertFails(bobDb.collection("guildPosts").doc(post.id).get());
    await assertSucceeds(aliceDb.collection("guildPosts").doc(post.id).update({
      status: "published",
      publishedAt: now + 2,
      updatedAt: now + 2,
    }));
    await assertSucceeds(bobDb.collection("guildPosts").doc(post.id).get());
    await assertSucceeds(staffDb.collection("guildPosts").doc(post.id).update({
      moderation: { visibility: "hidden", hiddenByUserId: "guild-staff", hiddenAt: now + 1, reason: "確認中" },
      updatedAt: now + 3,
    }));
    await assertFails(bobDb.collection("guildPosts").doc(post.id).get());
  });

  test("Guild AI index is inaccessible to every client", async () => {
    const aliceDb = env.authenticatedContext("guild-ai-alice", createAppleToken()).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("guildPostAIIndex").doc("post-1").set({
        postId: "post-1",
        status: "published",
        moderationVisibility: "visible",
        embedding: [0.1, 0.2],
      });
    });
    await assertFails(aliceDb.collection("guildPostAIIndex").doc("post-1").get());
    await assertFails(aliceDb.collection("guildPostAIIndex").doc("post-2").set({ postId: "post-2" }));
  });
}
