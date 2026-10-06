import { saveProfileSetupTransaction } from "../src/services/collaboration/profileSetupTransaction.ts";
import type { UserProfile } from "../src/types/collaboration.ts";
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
import { doc, writeBatch, runTransaction, getDoc, updateDoc } from "firebase/firestore";

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

  const seedPlusAccess = async (...userIds: string[]) => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await Promise.all(userIds.map((userId) => db.collection("temisAccessStates").doc(userId).set({
        userId,
        tier: "plus",
        source: "revenuecat",
        verifiedAt: Date.now(),
        verifiedUntil: Date.now() + 60_000,
        updatedAt: Date.now(),
      })));
    });
  };

  const seedFreeProjectAccess = async (userId: string, projectId: string) => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("projectAccessStates").doc(userId).set({
        userId,
        status: "ready",
        membershipCount: 1,
        freeProjectId: projectId,
        pendingFreeProjectId: null,
        updatedAt: Date.now(),
      });
    });
  };

  test("users can read and write only their own four sync collections", async () => {
    await seedPlusAccess("alice");
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
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("projects").doc("project-1").set(project);
      await db.collection("projects").doc("project-1").collection("members").doc("alice").set({
        userId: "alice", role: "owner", invitationId: null, joinedAt: 1, updatedAt: 1,
      });
      await db.collection("projectMemberships").doc("project-1__alice").set({
        id: "project-1__alice", projectId: "project-1", userId: "alice", role: "owner", updatedAt: 1,
      });
    });
    await seedFreeProjectAccess("alice", "project-1");
    await assertSucceeds(aliceDb.collection("projectNotes").doc("note-1").set({
      id: "note-1", ownerUserId: "alice", projectId: "project-1", sourceNoteId: "local-1",
      creatorDisplayName: "Alice", creatorAnonymizedAt: null, anonymizedReason: null,
      title: "Shared", body: "only members", updatedAt: 1,
    }));
    await assertFails(bobDb.collection("projectNotes").doc("note-1").get());
    await assertSucceeds(aliceDb.collection("projectNotes").doc("note-1").get());
    await assertSucceeds(
      aliceDb.collection("projectMemberships").where("userId", "==", "alice").get(),
    );
  });

  test("server-owned quota state and membership changes cannot be forged by clients", async () => {
    const aliceDb = env.authenticatedContext("alice", createAppleToken()).firestore();
    await assertFails(aliceDb.collection("temisAccessStates").doc("alice").set({
      userId: "alice", tier: "plus", verifiedUntil: Date.now() + 60_000,
    }));
    await assertFails(aliceDb.collection("projectAccessStates").doc("alice").set({
      userId: "alice", status: "ready", membershipCount: 0, freeProjectId: null,
    }));
    await assertFails(aliceDb.collection("temisAIWeeklyUsage").doc("alice__week").set({
      userId: "alice", used: 0,
    }));
    await assertFails(aliceDb.collection("projectMemberships").doc("p__alice").set({
      id: "p__alice", projectId: "p", userId: "alice", role: "owner", updatedAt: 1,
    }));
  });

  test("anonymous notes belong to the project owner and anonymous tasks remain member-editable but owner-deletable", async () => {
    const ownerDb = env.authenticatedContext("owner", createGoogleToken()).firestore();
    const memberDb = env.authenticatedContext("member", createAppleToken()).firestore();
    const projectId = "anon-project";
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("projects").doc(projectId).set({
        id: projectId, name: "Anon", description: null, ownerUserId: "owner", icon: null,
        tags: [], visibility: "private", joinPolicy: "invitation_only", invitationPolicy: "owner_only",
        taskEnabled: true, createdAt: 1, updatedAt: 1, deletedAt: null,
      });
      for (const [userId, role] of [["owner", "owner"], ["member", "member"]] as const) {
        await db.collection("projects").doc(projectId).collection("members").doc(userId).set({
          userId, role, invitationId: null, joinedAt: 1, updatedAt: 1,
        });
        await db.collection("projectMemberships").doc(`${projectId}__${userId}`).set({
          id: `${projectId}__${userId}`, projectId, userId, role, updatedAt: 1,
        });
      }
      await db.collection("projectNotes").doc("anon-note").set({
        id: "anon-note", ownerUserId: null, sourceNoteId: null, projectId,
        creatorDisplayName: "匿名ユーザー", creatorAnonymizedAt: 2,
        anonymizedReason: "project_exit", title: "残る題名", body: "残る本文", updatedAt: 2,
      });
      await db.collection("projectTasks").doc("anon-task").set({
        id: "anon-task", ownerUserId: null, creatorUserId: null, assigneeUserId: null,
        creatorDisplayName: "匿名ユーザー", creatorAnonymizedAt: 2,
        anonymizedReason: "project_exit", projectId, kind: "task", title: "残るタスク",
        description: "残る説明", status: "todo", tags: [], estimateMinutes: 25,
        isArchived: false, priority: null, dueAt: null, privateDate: null,
        privateSlotKey: null, relatedMemoId: null, createdAt: 1, updatedAt: 2,
        completedAt: null, deletedAt: null,
      });
    });
    await seedFreeProjectAccess("owner", projectId);
    await seedFreeProjectAccess("member", projectId);

    const ownerNote = ownerDb.collection("projectNotes").doc("anon-note");
    const memberNote = memberDb.collection("projectNotes").doc("anon-note");
    await assertSucceeds(ownerNote.update({ body: "所有者の編集", updatedAt: 3 }));
    await assertFails(memberNote.update({ body: "メンバーの改ざん", updatedAt: 4 }));
    await assertFails(ownerNote.update({ ownerUserId: "owner", creatorDisplayName: "Alice", updatedAt: 4 }));

    const ownerTask = ownerDb.collection("projectTasks").doc("anon-task");
    const memberTask = memberDb.collection("projectTasks").doc("anon-task");
    await assertSucceeds(memberTask.update({ title: "メンバーが編集", updatedAt: 3 }));
    await assertFails(memberTask.update({ creatorUserId: "member", updatedAt: 4 }));
    await assertFails(memberTask.update({ deletedAt: 4, updatedAt: 4 }));
    await assertSucceeds(ownerTask.update({ deletedAt: 4, updatedAt: 4 }));
    await assertFails(memberNote.delete());
    await assertSucceeds(ownerNote.delete());
  });

  test("selection_required blocks shared project data until a free project is chosen", async () => {
    const aliceDb = env.authenticatedContext("alice", createGoogleToken()).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("projects").doc("overflow").set({ id: "overflow", visibility: "private" });
      await db.collection("projects").doc("overflow").collection("members").doc("alice").set({ userId: "alice", role: "member" });
      await db.collection("projectNotes").doc("overflow-note").set({ projectId: "overflow", ownerUserId: "alice" });
      await db.collection("projectAccessStates").doc("alice").set({
        userId: "alice", status: "selection_required", membershipCount: 2,
        freeProjectId: null, pendingFreeProjectId: null, updatedAt: 1,
      });
    });
    await assertFails(aliceDb.collection("projectNotes").doc("overflow-note").get());
    await assertFails(aliceDb.collection("projects").doc("overflow").get());
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
    await seedPlusAccess("alice");
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
    await seedPlusAccess("alice");
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

  const seedStaffCode = async (
    code: string,
    overrides: Record<string, unknown> = {},
  ) => {
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("inviteCodes").doc(code).set({
        code,
        active: true,
        grantType: "staff_free",
        offeringId: null,
        packageId: null,
        expiresAt: null,
        maxRedemptions: 2,
        redeemedCount: 0,
        createdBy: "admin-user",
        note: "staff invite",
        updatedAt: Date.now(),
        ...overrides,
      });
    });
  };

  const redeemStaffCode = (db: any, userId: string, code: string) =>
    db.runTransaction(async (transaction: any) => {
      const inviteRef = db.collection("inviteCodes").doc(code);
      const accessRef = db.collection("subscriptionAccess").doc(userId);
      const redemptionRef = inviteRef.collection("redemptions").doc(userId);
      const [inviteSnapshot, accessSnapshot, redemptionSnapshot] = await Promise.all([
        transaction.get(inviteRef),
        transaction.get(accessRef),
        transaction.get(redemptionRef),
      ]);
      const invite = inviteSnapshot.data();
      const now = Date.now();
      transaction.set(accessRef, {
        userId,
        active: true,
        grantType: invite.grantType,
        inviteCode: code,
        offeringId: invite.offeringId,
        packageId: invite.packageId,
        expiresAt: invite.expiresAt,
        grantedBy: invite.createdBy,
        note: invite.note,
        redeemedAt: accessSnapshot.exists && accessSnapshot.data().inviteCode === code
          ? accessSnapshot.data().redeemedAt : now,
        updatedAt: now,
      }, { merge: true });
      if (!redemptionSnapshot.exists) {
        transaction.set(redemptionRef, {
          userId,
          inviteCode: code,
          grantType: invite.grantType,
          email: null,
          name: null,
          redeemedAt: now,
        });
        transaction.update(inviteRef, {
          redeemedCount: invite.redeemedCount + 1,
          updatedAt: now,
        });
      }
    });

  test("Google and Apple users redeem staff codes, including an idempotent repeat", async () => {
    await seedStaffCode("STAFF-TWO");
    const googleDb = env.authenticatedContext("google-staff", createGoogleToken()).firestore();
    const appleDb = env.authenticatedContext("apple-staff", createAppleToken()).firestore();

    await assertSucceeds(redeemStaffCode(googleDb, "google-staff", "STAFF-TWO"));
    await assertSucceeds(redeemStaffCode(appleDb, "apple-staff", "STAFF-TWO"));
    await assertSucceeds(redeemStaffCode(googleDb, "google-staff", "STAFF-TWO"));

    const code = await assertSucceeds(googleDb.collection("inviteCodes").doc("STAFF-TWO").get());
    assert.equal(code.data()?.redeemedCount, 2);
    for (const [db, userId] of [[googleDb, "google-staff"], [appleDb, "apple-staff"]] as const) {
      const grant = await assertSucceeds(db.collection("subscriptionAccess").doc(userId).get());
      assert.equal(grant.data()?.grantType, "staff_free");
      assert.equal(grant.data()?.inviteCode, "STAFF-TWO");
    }
  });

  test("staff codes reject partial writes, exhausted or expired codes, and unsupported accounts", async () => {
    await seedStaffCode("STAFF-LIMIT", { maxRedemptions: 1 });
    await seedStaffCode("STAFF-EXPIRED", { expiresAt: Date.now() - 60_000 });
    await seedStaffCode("STAFF-INACTIVE", { active: false });
    await seedStaffCode("STAFF-PROVIDER");
    const googleDb = env.authenticatedContext("google-staff", createGoogleToken()).firestore();
    const appleDb = env.authenticatedContext("apple-staff", createAppleToken()).firestore();
    const passwordDb = env.authenticatedContext("password-staff", createPasswordToken()).firestore();

    await assertFails(googleDb.collection("subscriptionAccess").doc("google-staff").set({
      userId: "google-staff", active: true, grantType: "staff_free", inviteCode: "STAFF-LIMIT",
      offeringId: null, packageId: null, expiresAt: null, grantedBy: "admin-user",
      note: "staff invite", redeemedAt: Date.now(), updatedAt: Date.now(),
    }));
    await assertFails(googleDb.collection("subscriptionAccess").doc("google-staff").set({
      userId: "google-staff", active: true, grantType: "staff_free", inviteCode: "STAFF-UNKNOWN",
      offeringId: null, packageId: null, expiresAt: null, grantedBy: "admin-user",
      note: "staff invite", redeemedAt: Date.now(), updatedAt: Date.now(),
    }));
    await assertSucceeds(redeemStaffCode(googleDb, "google-staff", "STAFF-LIMIT"));
    await assertFails(redeemStaffCode(appleDb, "apple-staff", "STAFF-LIMIT"));
    await assertFails(redeemStaffCode(appleDb, "apple-staff", "STAFF-EXPIRED"));
    await assertFails(redeemStaffCode(appleDb, "apple-staff", "STAFF-INACTIVE"));
    await assertFails(redeemStaffCode(passwordDb, "password-staff", "STAFF-PROVIDER"));
  });

  test("a direct or revoked staff grant cannot be replaced by a staff code", async () => {
    await seedStaffCode("STAFF-KEEP");
    const aliceDb = env.authenticatedContext("alice", createAppleToken()).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("subscriptionAccess").doc("alice").set({
        userId: "alice", active: true, grantType: "staff_free", inviteCode: null,
        offeringId: null, packageId: null, expiresAt: null, grantedBy: "admin-user",
        note: "direct grant", redeemedAt: null, updatedAt: Date.now(),
      });
    });
    await assertFails(redeemStaffCode(aliceDb, "alice", "STAFF-KEEP"));
    const original = await assertSucceeds(aliceDb.collection("subscriptionAccess").doc("alice").get());
    assert.equal(original.data()?.inviteCode, null);

    const bobDb = env.authenticatedContext("bob", createGoogleToken()).firestore();
    await assertSucceeds(redeemStaffCode(bobDb, "bob", "STAFF-KEEP"));
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("subscriptionAccess").doc("bob").update({ active: false });
    });
    await assertFails(redeemStaffCode(bobDb, "bob", "STAFF-KEEP"));
  });

  test("expired staff grants cannot read Commons moderation reports", async () => {
    const staffDb = env.authenticatedContext("staff", createGoogleToken()).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("subscriptionAccess").doc("staff").set({
        userId: "staff", active: true, grantType: "staff_free", inviteCode: null,
        offeringId: null, packageId: null, expiresAt: Date.now() + 60_000,
        grantedBy: "admin-user", note: null, redeemedAt: null, updatedAt: Date.now(),
      });
      await db.collection("guildReports").doc("report-1").set({ reporterUserId: "reporter" });
    });
    await assertSucceeds(staffDb.collection("guildReports").doc("report-1").get());
    await env.withSecurityRulesDisabled(async (context) => {
      await context.firestore().collection("subscriptionAccess").doc("staff")
        .update({ expiresAt: Date.now() - 60_000 });
    });
    await assertFails(staffDb.collection("guildReports").doc("report-1").get());
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

  test("Commons inbox scopes invitations to the recipient and accepts membership atomically", async () => {
    const aliceDb = env.authenticatedContext("alice", createGoogleToken()).firestore();
    const bobDb = env.authenticatedContext("bob", createAppleToken()).firestore();
    const carolDb = env.authenticatedContext("carol", createGoogleToken()).firestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("projects").doc("commons-project").set({
        id: "commons-project", name: "Commons project", ownerUserId: "alice", visibility: "private", invitationPolicy: "owner_only",
      });
      await db.collection("projects").doc("commons-project").collection("members").doc("alice").set({ userId: "alice", role: "owner" });
    });
    await seedFreeProjectAccess("alice", "commons-project");
    const invitation = {
      id: "scout-1", projectId: "commons-project", projectName: "Commons project",
      inviterUserId: "alice", inviteeUserId: "bob", role: "member", status: "pending",
      createdAt: 1, updatedAt: 1, expiresAt: null,
    };
    await assertSucceeds(aliceDb.collection("projectInvitations").doc(invitation.id).set(invitation));
    const inbox = await assertSucceeds(bobDb.collection("projectInvitations").where("inviteeUserId", "==", "bob").get());
    assert.equal(inbox.docs.length, 1);
    assert.equal(inbox.docs[0].data().projectName, "Commons project");
    await assertFails(carolDb.collection("projectInvitations").where("inviteeUserId", "==", "bob").get());
    await assertFails(bobDb.collection("projects").doc("commons-project").get());
    await assertFails(bobDb.runTransaction(async (transaction) => {
      const ref = bobDb.collection("projectInvitations").doc(invitation.id);
      const snapshot = await transaction.get(ref);
      transaction.set(ref, { ...snapshot.data(), status: "accepted", updatedAt: 2 });
      transaction.set(bobDb.collection("projects").doc("commons-project").collection("members").doc("bob"), {
        userId: "bob", role: "member", invitationId: invitation.id, joinedAt: 2, updatedAt: 2,
      });
      transaction.set(bobDb.collection("projectMemberships").doc("commons-project__bob"), {
        id: "commons-project__bob", projectId: "commons-project", userId: "bob", role: "member", updatedAt: 2,
      });
    }));
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection("projectInvitations").doc(invitation.id).update({ status: "accepted", updatedAt: 2 });
      await db.collection("projects").doc("commons-project").collection("members").doc("bob").set({
        userId: "bob", role: "member", invitationId: invitation.id, joinedAt: 2, updatedAt: 2,
      });
      await db.collection("projectMemberships").doc("commons-project__bob").set({
        id: "commons-project__bob", projectId: "commons-project", userId: "bob", role: "member", updatedAt: 2,
      });
    });
    await seedFreeProjectAccess("bob", "commons-project");
    await assertSucceeds(bobDb.collection("projects").doc("commons-project").get());
    await assertSucceeds(bobDb.collection("projectMemberships").doc("commons-project__bob").get());
    await assertSucceeds(aliceDb.collection("projectInvitations").doc("scout-2").set({ ...invitation, id: "scout-2" }));
    await assertFails(bobDb.collection("projectInvitations").doc("scout-2").update({ status: "declined", updatedAt: 2 }));
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
    const visibleFeed = await assertSucceeds(bobDb.collection("guildPosts")
      .where("status", "==", "published")
      .where("moderation.visibility", "==", "visible")
      .orderBy("publishedAt", "desc")
      .orderBy("__name__", "desc")
      .get());
    assert.equal(visibleFeed.docs.length, 1);
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
    const feedAfterUnpublish = await assertSucceeds(bobDb.collection("guildPosts")
      .where("status", "==", "published")
      .where("moderation.visibility", "==", "visible")
      .orderBy("publishedAt", "desc")
      .orderBy("__name__", "desc")
      .get());
    assert.equal(feedAfterUnpublish.docs.length, 0);
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

  test("backend quota transactions serialize concurrent project creation and AI reservations", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(new URL("../functions/projectAccessCore.cjs", import.meta.url).href);
    const { initializeApp, deleteApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    const { createProjectAccessService } = require("../functions/projectAccessCore.cjs");
    const { createTemisAIUsageService } = require("../functions/temisAccessCore.cjs");
    class TestHttpsError extends Error {
      code: string;
      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    }
    const app = initializeApp({ projectId: "demo-wememo" }, "freemium-integration");
    const db = getFirestore(app);
    const freeAccess = async (uid: string) => ({ userId: uid, tier: "free", source: "none" });
    const projects = createProjectAccessService({ db, HttpsError: TestHttpsError, getAccess: freeAccess });
    const usage = createTemisAIUsageService({ db, HttpsError: TestHttpsError, getAccess: freeAccess });
    try {
      const creations = await Promise.allSettled([
        projects.createProject("free-user", { name: "A", tags: [] }),
        projects.createProject("free-user", { name: "B", tags: [] }),
      ]);
      assert.equal(creations.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(creations.filter((result) => result.status === "rejected").length, 1);
      const state = await db.doc("projectAccessStates/free-user").get();
      assert.equal(state.data()?.membershipCount, 1);

      const projectId = (creations.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<{ id: string }>).value.id;
      await db.doc("projects/another-project").set({ id: "another-project", ownerUserId: "other", deletedAt: null });
      for (const [id, target] of [["invite-a", projectId], ["invite-b", "another-project"]]) {
        await db.doc(`projectInvitations/${id}`).set({ projectId: target, inviteeUserId: "new-member", inviterUserId: "free-user", role: "member", status: "pending", expiresAt: Date.now() + 60000 });
      }
      const approvals = await Promise.allSettled([
        projects.respondToInvitation("new-member", "invite-a", true),
        projects.respondToInvitation("new-member", "invite-b", true),
      ]);
      assert.equal(approvals.filter((result) => result.status === "fulfilled").length, 1);
      const acceptedId = approvals[0].status === "fulfilled" ? "invite-a" : "invite-b";
      await projects.respondToInvitation("new-member", acceptedId, true);
      assert.equal((await db.doc("projectAccessStates/new-member").get()).data()?.membershipCount, 1);
      await db.doc("projectInvitations/decline-repeat").set({ projectId, inviteeUserId: "decliner", role: "viewer", status: "pending" });
      await projects.respondToInvitation("decliner", "decline-repeat", false);
      await projects.respondToInvitation("decliner", "decline-repeat", false);
      assert.equal((await db.doc("projectInvitations/decline-repeat").get()).data()?.status, "declined");
      const plusProjects = createProjectAccessService({ db, HttpsError: TestHttpsError, getAccess: async (uid: string) => ({ userId: uid, tier: "plus" }) });
      await plusProjects.createProject("plus-user", { name: "Plus A", tags: [] });
      await plusProjects.createProject("plus-user", { name: "Plus B", tags: [] });
      assert.equal((await db.doc("projectAccessStates/plus-user").get()).data()?.membershipCount, 2);
      await db.collection("projectNotes").doc("owned-note").set({
        id: "owned-note", projectId, ownerUserId: "free-user", sourceNoteId: "local-note",
        creatorDisplayName: "Original Name", title: "Keep title", body: "Keep body", updatedAt: 1,
      });
      await db.collection("projectTasks").doc("owned-task").set({
        id: "owned-task", projectId, ownerUserId: "free-user", creatorUserId: "free-user",
        assigneeUserId: "free-user", creatorDisplayName: "Original Name",
        title: "Keep task", description: "Keep description", status: "todo", updatedAt: 1,
      });
      await db.collection("projectTasks").doc("assigned-task").set({
        id: "assigned-task", projectId, ownerUserId: "another-user", creatorUserId: "another-user",
        assigneeUserId: "free-user", creatorDisplayName: "Other Member",
        title: "Assigned only", status: "todo", updatedAt: 1,
      });
      await projects.anonymizeProjectContent("free-user", projectId);
      await projects.anonymizeProjectContent("free-user", projectId);
      const [note, task, assignedTask] = await Promise.all([
        db.collection("projectNotes").doc("owned-note").get(),
        db.collection("projectTasks").doc("owned-task").get(),
        db.collection("projectTasks").doc("assigned-task").get(),
      ]);
      assert.deepEqual(
        { ownerUserId: note.data()?.ownerUserId, sourceNoteId: note.data()?.sourceNoteId, title: note.data()?.title, body: note.data()?.body, creatorDisplayName: note.data()?.creatorDisplayName },
        { ownerUserId: null, sourceNoteId: null, title: "Keep title", body: "Keep body", creatorDisplayName: "匿名ユーザー" },
      );
      assert.equal(task.data()?.ownerUserId, null);
      assert.equal(task.data()?.creatorUserId, null);
      assert.equal(task.data()?.assigneeUserId, null);
      assert.equal(task.data()?.title, "Keep task");
      assert.equal(task.data()?.creatorDisplayName, "匿名ユーザー");
      assert.equal(assignedTask.data()?.assigneeUserId, null);
      assert.equal(assignedTask.data()?.ownerUserId, "another-user");
      assert.equal(assignedTask.data()?.creatorDisplayName, "Other Member");
      assert.equal(assignedTask.data()?.anonymizedReason, undefined);

      const reservations = await Promise.allSettled(Array.from({ length: 11 }, (_, index) =>
        usage.begin("ai-user", index % 2 === 0 ? "memo" : "commons", `request_${String(index).padStart(2, "0")}`)));
      assert.equal(reservations.filter((result) => result.status === "fulfilled").length, 10);
      assert.equal(reservations.filter((result) => result.status === "rejected").length, 1);
      const repeated = await usage.begin("ai-user", "memo", "request_00");
      assert.equal(repeated.used, 10);
      assert.equal(repeated.reused, true);
      await usage.claim("ai-user", "memo", "request_00");
      await assert.rejects(() => usage.claim("ai-user", "memo", "request_00"));
      await usage.cancel("ai-user", "request_00");
      assert.equal((await usage.getUsage("ai-user")).used, 10);
      await usage.refund("ai-user", "request_00");
      assert.equal((await usage.getUsage("ai-user")).used, 9);
      await usage.refund("ai-user", "request_00");
      assert.equal((await usage.getUsage("ai-user")).used, 9);
      await usage.begin("expired-user", "memo", "expired_request");
      await db.doc("temisAIUsageReservations/expired-user__expired_request").update({ expiresAt: 1 });
      await assert.rejects(() => usage.claim("expired-user", "memo", "expired_request"));
      const unlimited = createTemisAIUsageService({ db, HttpsError: TestHttpsError, getAccess: async () => ({ tier: "plus" }) });
      const unlimitedResults = await Promise.all(Array.from({ length: 12 }, (_, index) => unlimited.begin("plus-ai", "memo", `unlimited_${index}`)));
      assert.ok(unlimitedResults.every((result: any) => result.unlimited === true));
    } finally {
      await deleteApp(app);
    }
  });

  test("DM connection rules reject self-approval, forged membership and unblock by the blocked user", async () => {
    const a = env.authenticatedContext('dm-a', createAppleToken()).firestore();
    const b = env.authenticatedContext('dm-b', createGoogleToken()).firestore();
    const ref = a.collection('connections').doc('dm-a__dm-b');
    const data = { id: 'dm-a__dm-b', userIds: ['dm-a', 'dm-b'], requesterUserId: 'dm-a', recipientUserId: 'dm-b', status: 'pending', createdAt: 1, updatedAt: 1 };
    await assertFails(ref.set({ ...data, recipientUserId: 'dm-a' }));
    await assertFails(ref.set({ ...data, userIds: ['dm-a', 'dm-b', 'dm-c'] }));
    await assertSucceeds(ref.set(data));
    await assertFails(ref.update({ status: 'connected', recipientUserId: 'dm-a' }));
    await assertSucceeds(b.collection('connections').doc(ref.id).update({ status: 'connected' }));
    await assertSucceeds(ref.update({ status: 'blocked', blockedByUserId: 'dm-a' }));
    await assertFails(b.collection('connections').doc(ref.id).delete());
    await assertFails(b.collection('connections').doc(ref.id).update({ status: 'blocked', blockedByUserId: 'dm-b' }));
    await assertSucceeds(ref.delete());
    // Older installed clients replace request metadata when blocking. Preserve
    // this operation without allowing changed participants or forged acceptance.
    await assertSucceeds(ref.set(data));
    const bobRef = b.collection('connections').doc(ref.id);
    await assertSucceeds(bobRef.set({ ...data, requesterUserId: 'dm-b', recipientUserId: 'dm-a', status: 'blocked', blockedByUserId: 'dm-b', createdAt: 2, updatedAt: 2 }));
    await assertFails(ref.delete());
    await assertSucceeds(bobRef.delete());
  });

  test("DM Rules allow free participants to read history but reject all client writes and third parties", async () => {
    const a = env.authenticatedContext('dm-a', createAppleToken()).firestore();
    const b = env.authenticatedContext('dm-b', createGoogleToken()).firestore();
    const c = env.authenticatedContext('dm-c', createGoogleToken()).firestore();
    const anonymous = env.unauthenticatedContext().firestore();
    const threadId = 'a'.repeat(64);
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.collection('dmConversations').doc(threadId).set({ userIds: ['dm-a', 'dm-b'], updatedAt: 1 });
      await db.collection('dmConversations').doc(threadId).collection('messages').doc('message').set({ text: 'private', sequence: 1 });
      await db.collection('dmAccounts').doc('dm-a').set({ lastSentAt: 1 });
    });
    for (const db of [a, b]) {
      await assertSucceeds(db.collection('dmConversations').where('userIds', 'array-contains', db === a ? 'dm-a' : 'dm-b').orderBy('updatedAt', 'desc').get());
      // No connection exists: retained history is still readable.
      await assertSucceeds(db.collection('dmConversations').doc(threadId).collection('messages').orderBy('sequence', 'desc').limit(50).get());
      await assertFails(db.collection('dmConversations').doc(threadId).update({ userIds: ['dm-c'] }));
      await assertFails(db.collection('dmConversations').doc(threadId).collection('messages').doc('new').set({ text: 'forged' }));
      await assertFails(db.collection('dmDevices').doc('token').get());
      await assertFails(db.collection('dmNotificationJobs').doc('job').set({}));
    }
    await assertFails(c.collection('dmConversations').doc(threadId).get());
    await assertFails(c.collection('dmConversations').doc(threadId).collection('messages').get());
    await assertFails(anonymous.collection('dmConversations').doc(threadId).get());
    await env.withSecurityRulesDisabled(async (context) => { await context.firestore().collection('dmAccounts').doc('dm-a').set({ deleting: true }); });
    await assertFails(a.collection('dmConversations').doc(threadId).get());
    await assertSucceeds(b.collection('dmConversations').doc(threadId).get());
  });

  test("DM server transactions, push jobs, read races and account deletion run against Firestore", async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(new URL('../functions/directMessagesCore.cjs', import.meta.url).href);
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { createDMService, hash } = require('../functions/directMessagesCore.cjs');
    const { processNotificationJob } = require('../functions/directMessagesNotifications.cjs');
    const app = initializeApp({ projectId: 'demo-wememo' }, 'dm-integration');
    const db = getFirestore(app);
    const service = createDMService(db);
    const a = 'dm-a', b = 'dm-b';
    try {
      for (const uid of [a, b]) await db.doc(`profiles/${uid}`).set({ displayName: uid, profileVisibility: 'public' });
      const conn = db.doc(`connections/${a}__${b}`);
      const input = { recipientUserId: b, clientMessageId: 'one', text: 'Alice private text' };
      await assert.rejects(service.send(a, input), { code: 'permission-denied' });
      await conn.set({ userIds: [a, b], requesterUserId: a, recipientUserId: b, status: 'connected' });
      const results = await Promise.all([service.send(a, input), service.send(a, input), service.send(b, { recipientUserId: a, clientMessageId: 'reply', text: 'Bob retained text' })]);
      assert.equal(results[0].messageId, results[1].messageId);
      assert.equal(results[0].conversationId, results[2].conversationId);
      const thread = db.doc(`dmConversations/${results[0].conversationId}`);
      assert.equal((await thread.collection('messages').get()).size, 2);
      assert.equal((await thread.get()).data().sequence, 2);
      await assert.rejects(service.send(a, { ...input, text: 'changed' }), { code: 'already-exists' });
      await assert.rejects(service.markRead('dm-outsider', { conversationId: thread.id, sequence: 2 }), { code: 'permission-denied' });
      await service.markRead(b, { conversationId: thread.id, sequence: results[0].sequence });
      await db.doc(`dmAccounts/${a}`).set({ lastSentAt: 0 });
      const third = await service.send(a, { ...input, clientMessageId: 'two', text: 'unread message' });
      await service.markRead(b, { conversationId: thread.id, sequence: results[0].sequence });
      const unreadThread = (await thread.get()).data();
      assert.equal(unreadThread.receivedCounts[b] - unreadThread.readCounts[b], 1);
      const token = 'ExpoPushToken[test_device]';
      await service.setDevice(b, { installationId: 'install-one', platform: 'ios', enabled: true, token });
      const job = db.doc(`dmNotificationJobs/${third.messageId}`);
      let sends = 0;
      const expo = async (endpoint: string, payload: any) => {
        if (endpoint === 'send') {
          sends += 1;
          assert.equal(payload[0].title, a);
          assert.equal(payload[0].body, 'unread message');
          assert.equal(payload[0].data.recipientUserId, b);
          return [{ status: 'ok', id: 'receipt-one' }];
        }
        return { 'receipt-one': { status: 'error', details: { error: 'DeviceNotRegistered' } } };
      };
      await Promise.all([processNotificationJob(db, job, expo), processNotificationJob(db, job, expo)]);
      assert.equal(sends, 1);
      await job.update({ nextAttemptAt: 0 });
      await processNotificationJob(db, job, expo);
      assert.equal((await db.doc(`dmDevices/${hash('install-one')}`).get()).exists, false);
      await conn.update({ status: 'blocked', blockedByUserId: b });
      await assert.rejects(service.send(a, { ...input, clientMessageId: 'blocked' }), { code: 'permission-denied' });
      await service.markRead(b, { conversationId: thread.id, sequence: third.sequence });
      await service.setDevice(a, { installationId: 'install-two', platform: 'ios', enabled: true, token });
      await service.setDevice(b, { installationId: 'install-two', platform: 'ios', enabled: true, token });
      await service.setDevice(a, { installationId: 'install-two', platform: 'ios', enabled: false });
      assert.equal((await db.doc(`dmDevices/${hash('install-two')}`).get()).data().userId, b);
      await service.setDevice(a, { installationId: 'install-three', platform: 'ios', enabled: true, token });
      assert.equal((await db.doc(`dmDevices/${hash('install-two')}`).get()).exists, false);
      assert.equal((await db.collection('dmDevices').where('token', '==', token).get()).size, 1);
      await service.setDevice(b, { installationId: 'install-three', platform: 'ios', enabled: false, resetInstallation: true });
      assert.equal((await db.doc(`dmDevices/${hash('install-three')}`).get()).exists, false);
      await service.deleteAccountMessages(a);
      await service.deleteAccountMessages(a);
      const messages = (await thread.collection('messages').get()).docs.map((doc: any) => doc.data());
      assert.equal(messages.filter((message: any) => message.senderUserId === a).every((message: any) => message.deleted && message.text === ''), true);
      assert.equal(messages.find((message: any) => message.senderUserId === b).text, 'Bob retained text');
      const cleaned = (await thread.get()).data();
      assert.equal(cleaned.memberProfiles[a].displayName, '削除されたユーザー');
      assert.equal(cleaned.lastMessage.text, '削除されたメッセージ');
      assert.equal(cleaned.closed, true);
      assert.equal((await db.collection('dmNotificationJobs').where('senderUserId', '==', a).get()).size, 0);
      await conn.update({ status: 'connected' });
      await assert.rejects(service.send(b, { recipientUserId: a, clientMessageId: 'after-delete', text: 'no' }), { code: 'failed-precondition' });
    } finally { await deleteApp(app); }
  });

  test("profile setup commits atomically, concurrent duplicate IDs report a conflict, and photo metadata is owner-only", async () => {
    const makeProfile = (uid: string): UserProfile => ({
      userId: uid, username: `user_${uid}`, displayName: uid, photoUrl: null, bio: null,
      interestTags: [], skillTags: [], affiliation: null, profileVisibility: 'public', connectionRequestPolicy: 'everyone',
      createdAt: 1, updatedAt: 1, usernameChangedAt: null, profileCompletedAt: null, photoStoragePath: null,
    });
    const clients = ['alice', 'bob'].map((uid, index) => env.authenticatedContext(uid, index ? createGoogleToken() : createAppleToken()).firestore());
    for (const [index, uid] of ['alice', 'bob'].entries()) {
      const batch = writeBatch(clients[index]);
      batch.set(doc(clients[index], 'profiles', uid), makeProfile(uid));
      batch.set(doc(clients[index], 'usernames', `user_${uid}`), { userId: uid, username: `user_${uid}`, reservedUntil: null, updatedAt: 1 });
      await assertSucceeds(batch.commit());
    }
    const complete = (index: number, uid: string, username: string) => runTransaction(clients[index], (tx) => saveProfileSetupTransaction({
      readProfile: async () => { const s = await tx.get(doc(clients[index], 'profiles', uid)); return s.exists() ? s.data() as UserProfile : null; },
      readClaim: async (id) => { const s = await tx.get(doc(clients[index], 'usernames', id)); return s.exists() ? s.data() as any : null; },
      writeProfile: (p) => { tx.set(doc(clients[index], 'profiles', uid), p); },
      writeClaim: (c) => { tx.set(doc(clients[index], 'usernames', c.username), c); },
    }, uid, { displayName: ` ${uid} `, username }, 100));
    const results = await Promise.allSettled([complete(0, 'alice', 'shared_id'), complete(1, 'bob', 'shared_id')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const loser = results[0].status === 'rejected' ? 0 : 1;
    const rejected = results[loser] as PromiseRejectedResult;
    assert.match(rejected.reason.message, /すでに使用されています。別のユーザーID/);
    const uid = loser ? 'bob' : 'alice';
    const unchanged = (await getDoc(doc(clients[loser], 'profiles', uid))).data()!;
    assert.equal(unchanged.username, `user_${uid}`);
    assert.equal(unchanged.profileCompletedAt, null);
    await assertSucceeds(complete(loser, uid, 'another_id'));
    const p = doc(clients[loser], 'profiles', uid);
    await assertSucceeds(updateDoc(p, { photoUrl: 'https://example.com/avatar.jpg', photoStoragePath: `profilePhotos/${uid}/photo.jpg`, updatedAt: 101 }));
    await assertFails(updateDoc(doc(clients[1 - loser], 'profiles', uid), { photoUrl: null, photoStoragePath: null, updatedAt: 102 }));
    await assertFails(updateDoc(p, { photoStoragePath: 'profilePhotos/outsider/photo.jpg', updatedAt: 102 }));
    await assertFails(updateDoc(p, { profileCompletedAt: 'invalid', updatedAt: 102 }));
  });

  test("profile identity retries use current data and never undo deleted DM identities", async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(new URL('../functions/profileIdentityCore.cjs', import.meta.url).href);
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { syncProfileIdentity } = require('../functions/profileIdentityCore.cjs');
    const app = initializeApp({ projectId: 'demo-wememo' }, 'profile-integration');
    const db = getFirestore(app);
    try {
      const profile = db.doc('profiles/alice');
      const post = db.doc('guildPosts/profile-post');
      const thread = db.doc('dmConversations/profile-thread');
      await profile.set({ displayName: 'Old', photoUrl: 'old.jpg', profileVisibility: 'public' });
      await post.set({ authorUserId: 'alice', body: 'retained', authorDisplayName: 'Old' });
      const postsBatch = db.batch();
      for (let i = 0; i < 105; i++) postsBatch.set(db.doc(`guildPosts/page-${String(i).padStart(3, '0')}`), { authorUserId: 'alice', body: 'retained' });
      await postsBatch.commit();
      await thread.set({ userIds: ['alice', 'bob'], memberProfiles: { alice: { displayName: 'Old', photoUrl: null } }, sequence: 7 });
      await profile.update({ displayName: 'Latest', photoUrl: 'latest.jpg' });
      await syncProfileIdentity(db, 'alice');
      await syncProfileIdentity(db, 'alice');
      assert.equal((await post.get()).data().authorPhotoUrl, 'latest.jpg');
      assert.equal((await post.get()).data().body, 'retained');
      const allPosts = await db.collection('guildPosts').where('authorUserId', '==', 'alice').get();
      assert.equal(allPosts.size, 106);
      assert.ok(allPosts.docs.every((item: any) => item.data().authorPhotoUrl === 'latest.jpg'));
      assert.deepEqual((await db.doc('guildAuthors/alice').get()).data(), { displayName: 'Latest', photoUrl: 'latest.jpg', deleted: false });
      assert.equal((await thread.get()).data().memberProfiles.alice.displayName, 'Latest');
      assert.equal((await thread.get()).data().sequence, 7);
      await thread.update({ deletedUserIds: ['alice'], closed: true, 'memberProfiles.alice': { displayName: '削除されたユーザー', photoUrl: null } });
      await profile.update({ displayName: 'Changed again' });
      await syncProfileIdentity(db, 'alice');
      assert.equal((await thread.get()).data().memberProfiles.alice.displayName, '削除されたユーザー');
      await profile.delete();
      await syncProfileIdentity(db, 'alice');
      assert.equal((await thread.get()).data().memberProfiles.alice.photoUrl, null);
      assert.deepEqual((await db.doc('guildAuthors/alice').get()).data(), { displayName: '匿名ユーザー', photoUrl: null, deleted: true });
      await profile.set({ displayName: 'Must not restore', photoUrl: 'old.jpg' });
      await syncProfileIdentity(db, 'alice');
      assert.equal((await db.doc('guildAuthors/alice').get()).data().deleted, true);
    } finally { await deleteApp(app); }
  });

  test('Commons author projections are readable without private profile access and remain server-owned', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await context.firestore().doc('guildAuthors/alice').set({ displayName: 'Alice', photoUrl: 'avatar.jpg', deleted: false });
      await context.firestore().doc('profiles/alice').set({ profileVisibility: 'private', bio: 'secret' });
      await context.firestore().doc('guildPublicationStates/state').set({ userId: 'alice' });
    });
    const bob = env.authenticatedContext('bob', createAppleToken()).firestore();
    const alice = env.authenticatedContext('alice', createGoogleToken()).firestore();
    await assertSucceeds(bob.doc('guildAuthors/alice').get());
    await assertFails(bob.doc('profiles/alice').get());
    await assertFails(alice.doc('guildAuthors/alice').set({ displayName: 'Forged' }));
    await assertFails(bob.collection('guildAuthors').get());
    await assertFails(env.unauthenticatedContext().firestore().doc('guildAuthors/alice').get());
    await assertFails(alice.doc('guildPublicationStates/state').get());
    await assertFails(alice.doc('guildPublicationStates/state').set({ userId: 'alice' }));
  });

  test('publication backend unifies legacy duplicates, preserves moderation and rejects stale or foreign updates', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(new URL('../functions/guildPublication.cjs', import.meta.url).href);
    const { initializeApp, deleteApp } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');
    const { updatePublication } = require('../functions/guildPublication.cjs');
    const app = initializeApp({ projectId: 'demo-wememo' }, 'publication-integration');
    const db = getFirestore(app);
    const input = { userId: 'alice', sourceId: 'note:source', operation: 'publish', title: 'Memo title', body: 'Source body #TAG', version: { updatedAt: 10, deviceId: 'a' }, scope: 'personal', type: 'personal', projectId: null };
    try {
      await db.doc('profiles/alice').set({ displayName: 'Alice', photoUrl: null, profileVisibility: 'public' });
      const concurrent = await Promise.all([updatePublication(db, 'alice', input), updatePublication(db, 'alice', input)]);
      assert.equal(concurrent[0].posts[0].id, concurrent[1].posts[0].id);
      const initial = concurrent[0].posts[0];
      await db.doc('guildPosts/legacy').set({ ...initial, id: 'legacy', source: { scope: 'personal', memoId: 'source' }, status: 'unpublished', publishedAt: null, moderation: { ...initial.moderation, visibility: 'hidden' } });
      await db.doc('guildPosts/foreign').set({ ...initial, id: 'foreign', authorUserId: 'bob' });
      const updated = await updatePublication(db, 'alice', { ...input, operation: 'sync', body: 'Edited source #NEW', version: { updatedAt: 20, deviceId: 'a' } });
      assert.equal(updated.posts.length, 2);
      assert.ok(updated.posts.every((post: any) => post.body === 'Edited source #NEW'));
      const legacy = (await db.doc('guildPosts/legacy').get()).data();
      assert.equal(legacy.status, 'unpublished'); assert.equal(legacy.moderation.visibility, 'hidden');
      assert.equal((await db.doc(`guildPosts/${initial.id}`).get()).data().publishedAt, initial.publishedAt);
      assert.equal((await db.doc('guildPosts/foreign').get()).data().body, initial.body);
      await assert.rejects(updatePublication(db, 'alice', { ...input, version: { updatedAt: 15, deviceId: 'a' } }), (e: any) => e.code === 'aborted');
      await assert.rejects(updatePublication(db, 'bob', input), (e: any) => e.code === 'permission-denied');
      await updatePublication(db, 'alice', { ...input, operation: 'delete', body: '', version: { updatedAt: 30, deviceId: 'a' } });
      assert.equal((await db.doc(`guildPosts/${initial.id}`).get()).data().status, 'unpublished');
      await assert.rejects(updatePublication(db, 'alice', { ...input, body: '' }), (e: any) => e.code === 'invalid-argument');
      await db.doc('projects/project').set({ id: 'project' });
      await db.doc('projects/project/members/alice').set({ role: 'viewer' });
      await db.doc('projectAccessStates/alice').set({ status: 'ready', freeProjectId: 'project' });
      const projectInput = { ...input, sourceId: 'note:project-source', scope: 'project', projectId: 'project', version: { updatedAt: 40, deviceId: 'a' } };
      await assert.rejects(updatePublication(db, 'alice', projectInput), (e: any) => e.code === 'permission-denied');
      await db.doc('projects/project/members/alice').update({ role: 'member' });
      await updatePublication(db, 'alice', projectInput);
      await db.doc('projects/project/members/alice').delete();
      await assert.rejects(updatePublication(db, 'alice', { ...projectInput, operation: 'sync', version: { updatedAt: 50, deviceId: 'a' } }), (e: any) => e.code === 'permission-denied');
      const removed = await updatePublication(db, 'alice', { ...projectInput, operation: 'unpublish', body: '', version: { updatedAt: 50, deviceId: 'a' } });
      assert.equal(removed.posts[0].status, 'unpublished');
      await db.doc('profiles/alice').update({ profileVisibility: 'private' });
      const hidden = await updatePublication(db, 'alice', { ...input, operation: 'sync', body: 'Private profile content', version: { updatedAt: 60, deviceId: 'a' } });
      assert.ok(hidden.posts.every((post: any) => post.status === 'unpublished'));
      await assert.rejects(updatePublication(db, 'alice', { ...input, version: { updatedAt: 70, deviceId: 'a' } }), (e: any) => e.code === 'failed-precondition');
    } finally { await deleteApp(app); }
  });

}
