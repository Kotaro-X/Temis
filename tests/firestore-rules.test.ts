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
    await assertSucceeds(bobDb.runTransaction(async (transaction) => {
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
    await assertSucceeds(bobDb.collection("projects").doc("commons-project").get());
    await assertSucceeds(bobDb.collection("projectMemberships").doc("commons-project__bob").get());
    await assertSucceeds(aliceDb.collection("projectInvitations").doc("scout-2").set({ ...invitation, id: "scout-2" }));
    await assertSucceeds(bobDb.collection("projectInvitations").doc("scout-2").update({ status: "declined", updatedAt: 2 }));
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

}
