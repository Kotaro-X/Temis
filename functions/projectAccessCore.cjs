const ANONYMOUS_DISPLAY_NAME = "匿名ユーザー";

const projectStateRef = (db, uid) => db.doc(`projectAccessStates/${uid}`);
const membershipQuery = (db, uid) =>
  db.collection("projectMemberships").where("userId", "==", uid);

const normalizeText = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const membershipStateFor = ({ uid, memberships, access, previous, now }) => {
  const count = memberships.length;
  const projectIds = new Set(memberships.map((item) => item.projectId));
  if (access.tier === "plus") {
    return {
      userId: uid,
      status: "ready",
      membershipCount: count,
      freeProjectId: null,
      pendingFreeProjectId: null,
      updatedAt: now,
    };
  }
  if (count <= 1) {
    return {
      userId: uid,
      status: "ready",
      membershipCount: count,
      freeProjectId: count === 1 ? memberships[0].projectId : null,
      pendingFreeProjectId: null,
      updatedAt: now,
    };
  }
  const pending = projectIds.has(previous?.pendingFreeProjectId)
    ? previous.pendingFreeProjectId
    : null;
  return {
    userId: uid,
    status: "selection_required",
    membershipCount: count,
    freeProjectId: null,
    pendingFreeProjectId: pending,
    updatedAt: now,
  };
};

const createProjectAccessService = ({ db, HttpsError, getAccess }) => {
  const readMemberships = async (transaction, uid) => {
    const snapshot = await transaction.get(membershipQuery(db, uid));
    return snapshot.docs.map((document) => document.data());
  };

  const assertMayAddMembership = (access, memberships, projectId) => {
    if (memberships.some((membership) => membership.projectId === projectId)) return;
    if (access.tier !== "plus" && memberships.length >= 1) {
      throw new HttpsError(
        "resource-exhausted",
        "無料プランで利用できるプロジェクトは1件までです。",
      );
    }
  };

  const writeReconciledState = async (transaction, uid, access, memberships) => {
    const ref = projectStateRef(db, uid);
    const previousSnapshot = await transaction.get(ref);
    const next = membershipStateFor({
      uid,
      memberships,
      access,
      previous: previousSnapshot.exists ? previousSnapshot.data() : null,
      now: Date.now(),
    });
    transaction.set(ref, next);
    return next;
  };

  const projectSummary = async (uid, membership) => {
    const [projectSnapshot, notesSnapshot, ownerTasks, creatorTasks] = await Promise.all([
      db.doc(`projects/${membership.projectId}`).get(),
      db.collection("projectNotes")
        .where("projectId", "==", membership.projectId)
        .where("ownerUserId", "==", uid)
        .get(),
      db.collection("projectTasks")
        .where("projectId", "==", membership.projectId)
        .where("ownerUserId", "==", uid)
        .get(),
      db.collection("projectTasks")
        .where("projectId", "==", membership.projectId)
        .where("creatorUserId", "==", uid)
        .get(),
    ]);
    if (!projectSnapshot.exists || projectSnapshot.data()?.deletedAt) return null;
    const taskIds = new Set([
      ...ownerTasks.docs.map((document) => document.id),
      ...creatorTasks.docs.map((document) => document.id),
    ]);
    let transferCandidates = [];
    if (membership.role === "owner") {
      const members = await db.collection(`projects/${membership.projectId}/members`).get();
      transferCandidates = await Promise.all(members.docs
        .filter((document) => document.id !== uid)
        .map(async (document) => {
          const profile = await db.doc(`profiles/${document.id}`).get();
          return {
            userId: document.id,
            label: profile.data()?.displayName || profile.data()?.username || "メンバー",
          };
        }));
    }
    return {
      project: projectSnapshot.data(),
      role: membership.role,
      ownedNoteCount: notesSnapshot.size,
      ownedTaskCount: taskIds.size,
      transferCandidates,
    };
  };

  const refresh = async (uid, accessOverride = null) => {
    const access = accessOverride ?? await getAccess(uid);
    const result = await db.runTransaction(async (transaction) => {
      const memberships = await readMemberships(transaction, uid);
      const state = await writeReconciledState(transaction, uid, access, memberships);
      return { memberships, state };
    });
    const projects = (await Promise.all(
      result.memberships.map((membership) => projectSummary(uid, membership)),
    )).filter(Boolean).sort((left, right) => right.project.updatedAt - left.project.updatedAt);
    return { access, state: result.state, projects };
  };

  const createProject = async (uid, data) => {
    const access = await getAccess(uid);
    const name = normalizeText(data?.name, 120);
    if (!name) throw new HttpsError("invalid-argument", "プロジェクト名を入力してください。");
    const description = normalizeText(data?.description, 4000) || null;
    const icon = normalizeText(data?.icon, 64) || null;
    const tags = Array.isArray(data?.tags)
      ? data.tags.filter((tag) => typeof tag === "string").slice(0, 30)
      : [];
    const projectRef = db.collection("projects").doc();
    const timestamp = Date.now();
    const project = {
      id: projectRef.id,
      name,
      description,
      ownerUserId: uid,
      icon,
      tags,
      visibility: "invite_only",
      joinPolicy: "invitation_only",
      invitationPolicy: "owner_only",
      taskEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };
    await db.runTransaction(async (transaction) => {
      const memberships = await readMemberships(transaction, uid);
      assertMayAddMembership(access, memberships, project.id);
      const member = {
        userId: uid,
        role: "owner",
        invitationId: null,
        joinedAt: timestamp,
        updatedAt: timestamp,
      };
      const membership = {
        id: `${project.id}__${uid}`,
        projectId: project.id,
        userId: uid,
        role: "owner",
        updatedAt: timestamp,
      };
      await writeReconciledState(transaction, uid, access, [...memberships, membership]);
      transaction.set(projectRef, project);
      transaction.set(db.doc(`projects/${project.id}/members/${uid}`), member);
      transaction.set(db.doc(`projectMemberships/${membership.id}`), membership);
    });
    return project;
  };

  const respondToInvitation = async (uid, invitationId, accept) => {
    if (typeof invitationId !== "string") {
      throw new HttpsError("invalid-argument", "Invitation id is required.");
    }
    const access = await getAccess(uid);
    await db.runTransaction(async (transaction) => {
      const invitationRef = db.doc(`projectInvitations/${invitationId}`);
      const [invitationSnapshot, memberships] = await Promise.all([
        transaction.get(invitationRef),
        readMemberships(transaction, uid),
      ]);
      if (!invitationSnapshot.exists) throw new HttpsError("not-found", "招待が見つかりません。", { reason: "invitation_missing" });
      const invitation = invitationSnapshot.data();
      if (invitation.inviteeUserId !== uid) {
        throw new HttpsError("permission-denied", "この招待には応答できません。");
      }
      if (invitation.status === (accept ? "accepted" : "declined")) return;
      if (invitation.status !== "pending") throw new HttpsError("failed-precondition", "この招待は既に処理されています。", { reason: "invitation_resolved" });
      const timestamp = Date.now();
      if (accept && invitation.expiresAt != null && invitation.expiresAt <= timestamp) {
        throw new HttpsError("failed-precondition", "この招待は有効期限が切れています。", { reason: "invitation_expired" });
      }
      if (accept) {
        const project = await transaction.get(db.doc(`projects/${invitation.projectId}`));
        if (!project.exists || project.data().deletedAt) throw new HttpsError("not-found", "プロジェクトが見つかりません。", { reason: "project_missing" });
        if (!["member", "viewer"].includes(invitation.role)) throw new HttpsError("failed-precondition", "招待の参加権限を確認できません。");
      }
      if (accept) assertMayAddMembership(access, memberships, invitation.projectId);
      if (!accept) {
        transaction.update(invitationRef, { status: "declined", updatedAt: timestamp });
        return;
      }
      if (memberships.some((membership) => membership.projectId === invitation.projectId)) {
        transaction.update(invitationRef, { status: "accepted", updatedAt: timestamp });
        return;
      }
      const membership = {
        id: `${invitation.projectId}__${uid}`,
        projectId: invitation.projectId,
        userId: uid,
        role: invitation.role,
        updatedAt: timestamp,
      };
      await writeReconciledState(transaction, uid, access, [
        ...memberships.filter((item) => item.projectId !== invitation.projectId),
        membership,
      ]);
      transaction.update(invitationRef, { status: "accepted", updatedAt: timestamp });
      transaction.set(db.doc(`projects/${invitation.projectId}/members/${uid}`), {
        userId: uid,
        role: invitation.role,
        invitationId,
        joinedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(db.doc(`projectMemberships/${membership.id}`), membership);
    });
  };

  const createJoinRequest = async (uid, data) => {
    const projectId = normalizeText(data?.projectId, 128);
    const requestedRole = data?.role === "viewer" ? "viewer" : "member";
    const message = normalizeText(data?.message, 4000) || null;
    if (!projectId) throw new HttpsError("invalid-argument", "Project id is required.");
    const requestRef = db.doc(`projectJoinRequests/${projectId}__${uid}`);
    const timestamp = Date.now();
    const requestData = {
      id: requestRef.id,
      projectId,
      applicantUserId: uid,
      requestedRole,
      message,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.runTransaction(async (transaction) => {
      const [projectSnapshot, memberSnapshot, existingSnapshot] = await Promise.all([
        transaction.get(db.doc(`projects/${projectId}`)),
        transaction.get(db.doc(`projects/${projectId}/members/${uid}`)),
        transaction.get(requestRef),
      ]);
      const project = projectSnapshot.data();
      if (!projectSnapshot.exists || project.deletedAt || project.visibility !== "public" || project.joinPolicy !== "approval_required") {
        throw new HttpsError("failed-precondition", "このプロジェクトには参加申請できません。");
      }
      if (memberSnapshot.exists) throw new HttpsError("already-exists", "すでに参加しています。");
      if (existingSnapshot.exists && existingSnapshot.data()?.status === "pending") {
        throw new HttpsError("already-exists", "参加申請は送信済みです。");
      }
      transaction.set(requestRef, requestData);
    });
    return requestData;
  };

  const respondToJoinRequest = async (uid, requestId, accept) => {
    if (typeof requestId !== "string") throw new HttpsError("invalid-argument", "Request id is required.");
    const requestSnapshot = await db.doc(`projectJoinRequests/${requestId}`).get();
    if (!requestSnapshot.exists) throw new HttpsError("not-found", "参加申請が見つかりません。");
    const requestData = requestSnapshot.data();
    const applicantAccess = accept ? await getAccess(requestData.applicantUserId) : null;
    await db.runTransaction(async (transaction) => {
      const requestRef = db.doc(`projectJoinRequests/${requestId}`);
      const [latest, ownerMember, applicantMemberships] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(db.doc(`projects/${requestData.projectId}/members/${uid}`)),
        accept ? readMemberships(transaction, requestData.applicantUserId) : Promise.resolve([]),
      ]);
      const current = latest.data();
      if (!latest.exists || current.status !== "pending" || current.projectId !== requestData.projectId) {
        throw new HttpsError("failed-precondition", "この参加申請には応答できません。");
      }
      if (ownerMember.data()?.role !== "owner") {
        throw new HttpsError("permission-denied", "参加申請を承認する権限がありません。");
      }
      if (accept) assertMayAddMembership(applicantAccess, applicantMemberships, current.projectId);
      const timestamp = Date.now();
      if (!accept) {
        transaction.update(requestRef, { status: "declined", updatedAt: timestamp });
        return;
      }
      const membership = {
        id: `${current.projectId}__${current.applicantUserId}`,
        projectId: current.projectId,
        userId: current.applicantUserId,
        role: current.requestedRole,
        updatedAt: timestamp,
      };
      await writeReconciledState(transaction, current.applicantUserId, applicantAccess, [
        ...applicantMemberships.filter((item) => item.projectId !== current.projectId),
        membership,
      ]);
      transaction.update(requestRef, { status: "accepted", updatedAt: timestamp });
      transaction.set(db.doc(`projects/${current.projectId}/members/${current.applicantUserId}`), {
        userId: current.applicantUserId,
        role: current.requestedRole,
        invitationId: null,
        joinedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(db.doc(`projectMemberships/${membership.id}`), membership);
    });
  };

  const beginSelection = async (uid, keepProjectId) => {
    const access = await getAccess(uid);
    if (access.tier === "plus") throw new HttpsError("failed-precondition", "Plus users do not need project selection.");
    return db.runTransaction(async (transaction) => {
      const memberships = await readMemberships(transaction, uid);
      if (memberships.length < 2 || !memberships.some((item) => item.projectId === keepProjectId)) {
        throw new HttpsError("failed-precondition", "残すプロジェクトを選択できません。");
      }
      const state = {
        userId: uid,
        status: "selection_required",
        membershipCount: memberships.length,
        freeProjectId: null,
        pendingFreeProjectId: keepProjectId,
        updatedAt: Date.now(),
      };
      transaction.set(projectStateRef(db, uid), state);
      return state;
    });
  };

  const transferOwnership = async (uid, projectId, targetUserId) => {
    await db.runTransaction(async (transaction) => {
      const refs = {
        project: db.doc(`projects/${projectId}`),
        sourceMember: db.doc(`projects/${projectId}/members/${uid}`),
        targetMember: db.doc(`projects/${projectId}/members/${targetUserId}`),
        sourceIndex: db.doc(`projectMemberships/${projectId}__${uid}`),
        targetIndex: db.doc(`projectMemberships/${projectId}__${targetUserId}`),
      };
      const [project, source, target] = await Promise.all([
        transaction.get(refs.project),
        transaction.get(refs.sourceMember),
        transaction.get(refs.targetMember),
      ]);
      if (!project.exists || project.data()?.ownerUserId !== uid || source.data()?.role !== "owner" || !target.exists) {
        throw new HttpsError("failed-precondition", "所有権を移譲できません。");
      }
      const timestamp = Date.now();
      transaction.update(refs.project, { ownerUserId: targetUserId, updatedAt: timestamp });
      transaction.update(refs.sourceMember, { role: "member", updatedAt: timestamp });
      transaction.update(refs.targetMember, { role: "owner", updatedAt: timestamp });
      transaction.update(refs.sourceIndex, { role: "member", updatedAt: timestamp });
      transaction.update(refs.targetIndex, { role: "owner", updatedAt: timestamp });
    });
  };

  const anonymizeProjectContent = async (uid, projectId) => {
    const [notes, ownerTasks, creatorTasks, assignedTasks] = await Promise.all([
      db.collection("projectNotes").where("projectId", "==", projectId).where("ownerUserId", "==", uid).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("ownerUserId", "==", uid).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("creatorUserId", "==", uid).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("assigneeUserId", "==", uid).get(),
    ]);
    const timestamp = Date.now();
    const writer = db.bulkWriter();
    for (const note of notes.docs) {
      writer.update(note.ref, {
        ownerUserId: null,
        sourceNoteId: null,
        creatorDisplayName: ANONYMOUS_DISPLAY_NAME,
        creatorAnonymizedAt: timestamp,
        anonymizedReason: "project_exit",
        updatedAt: timestamp,
      });
    }
    const tasks = new Map();
    for (const document of [...ownerTasks.docs, ...creatorTasks.docs, ...assignedTasks.docs]) {
      tasks.set(document.id, document);
    }
    for (const task of tasks.values()) {
      const current = task.data();
      const createdByUser = current.ownerUserId === uid || current.creatorUserId === uid;
      const update = {
        ...(current.ownerUserId === uid ? { ownerUserId: null } : {}),
        ...(current.creatorUserId === uid ? { creatorUserId: null } : {}),
        ...(current.assigneeUserId === uid ? { assigneeUserId: null } : {}),
        ...(createdByUser ? {
          creatorDisplayName: ANONYMOUS_DISPLAY_NAME,
          creatorAnonymizedAt: timestamp,
          anonymizedReason: "project_exit",
        } : {}),
        updatedAt: timestamp,
      };
      writer.update(task.ref, update);
    }
    await writer.close();

    const [remainingNotes, remainingOwner, remainingCreator, remainingAssignee] = await Promise.all([
      db.collection("projectNotes").where("projectId", "==", projectId).where("ownerUserId", "==", uid).limit(1).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("ownerUserId", "==", uid).limit(1).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("creatorUserId", "==", uid).limit(1).get(),
      db.collection("projectTasks").where("projectId", "==", projectId).where("assigneeUserId", "==", uid).limit(1).get(),
    ]);
    if ([remainingNotes, remainingOwner, remainingCreator, remainingAssignee].some((snapshot) => !snapshot.empty)) {
      throw new HttpsError("aborted", "共有データの匿名化を完了できませんでした。再試行してください。");
    }
  };

  const deleteProject = async (uid, projectId) => {
    const project = await db.doc(`projects/${projectId}`).get();
    if (!project.exists) return;
    if (project.data()?.ownerUserId !== uid) throw new HttpsError("permission-denied", "プロジェクトを削除する権限がありません。");
    const collections = ["projectNotes", "projectTasks", "projectMemberships", "projectInvitations", "projectJoinRequests"];
    const [snapshots, guildPosts] = await Promise.all([
      Promise.all(collections.map((name) => db.collection(name).where("projectId", "==", projectId).get())),
      db.collection("guildPosts").where("projectId", "==", projectId).get(),
    ]);
    const writer = db.bulkWriter();
    for (const snapshot of snapshots) {
      for (const document of snapshot.docs) writer.delete(document.ref);
    }
    for (const document of guildPosts.docs) {
      writer.update(document.ref, { projectId: null, updatedAt: Date.now() });
    }
    await writer.close();
    await db.recursiveDelete(db.doc(`projects/${projectId}`));
  };

  const leaveAfterAnonymizing = async (uid, projectId) => {
    await anonymizeProjectContent(uid, projectId);
    await db.runTransaction(async (transaction) => {
      const memberRef = db.doc(`projects/${projectId}/members/${uid}`);
      const membershipRef = db.doc(`projectMemberships/${projectId}__${uid}`);
      const [member, project] = await Promise.all([
        transaction.get(memberRef),
        transaction.get(db.doc(`projects/${projectId}`)),
      ]);
      if (!member.exists) return;
      if (member.data()?.role === "owner" || project.data()?.ownerUserId === uid) {
        throw new HttpsError("failed-precondition", "所有権を移譲してから退出してください。");
      }
      transaction.delete(memberRef);
      transaction.delete(membershipRef);
    });
  };

  const resolveOverflow = async (uid, data) => {
    const keepProjectId = normalizeText(data?.keepProjectId, 128);
    const resolutions = Array.isArray(data?.resolutions) ? data.resolutions : [];
    const access = await getAccess(uid);
    if (access.tier === "plus") return refresh(uid);
    const current = await refresh(uid);
    if (current.state.status !== "selection_required" || !current.projects.some((item) => item.project.id === keepProjectId)) {
      throw new HttpsError("failed-precondition", "無料枠の整理対象を確認できません。");
    }
    await beginSelection(uid, keepProjectId);
    const byProject = new Map(resolutions.map((item) => [item?.projectId, item]));
    for (const item of current.projects) {
      const projectId = item.project.id;
      if (projectId === keepProjectId) continue;
      const resolution = byProject.get(projectId);
      if (!resolution) throw new HttpsError("invalid-argument", "退出対象ごとの処理を指定してください。");
      if (item.role === "owner") {
        if (resolution.action === "delete") {
          await deleteProject(uid, projectId);
          continue;
        }
        if (resolution.action !== "transfer" || typeof resolution.transferToUserId !== "string") {
          throw new HttpsError("failed-precondition", "所有プロジェクトは移譲または削除が必要です。");
        }
        await transferOwnership(uid, projectId, resolution.transferToUserId);
      }
      await leaveAfterAnonymizing(uid, projectId);
    }
    const result = await refresh(uid);
    if (result.state.status !== "ready" || result.state.freeProjectId !== keepProjectId) {
      throw new HttpsError("aborted", "プロジェクト整理が完了していません。再試行してください。");
    }
    return result;
  };

  return {
    anonymizeProjectContent,
    beginSelection,
    createJoinRequest,
    createProject,
    refresh,
    resolveOverflow,
    respondToInvitation,
    respondToJoinRequest,
  };
};

module.exports = {
  ANONYMOUS_DISPLAY_NAME,
  createProjectAccessService,
  membershipStateFor,
};
