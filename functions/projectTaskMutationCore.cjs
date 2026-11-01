const { HttpsError } = require('firebase-functions/v2/https');

const fail = (code, message) => { throw new HttpsError(code, message); };
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/') && value !== '.' && value !== '..';
const assigneesOf = task => Array.isArray(task.assigneeUserIds) ? task.assigneeUserIds : task.assigneeUserId !== undefined ? (task.assigneeUserId ? [task.assigneeUserId] : []) : (task.creatorUserId || task.ownerUserId ? [task.creatorUserId || task.ownerUserId] : []);
const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const fields = new Set(['title', 'description', 'status', 'tags', 'estimateMinutes', 'isArchived', 'priority', 'dueAt', 'privateDate', 'privateSlotKey', 'assigneeUserIds', 'plannedStartAt', 'plannedEndAt', 'repeat', 'repeatAnchorDate', 'occurrenceOverrides']);
const validate = task => {
  if (typeof task.title !== 'string' || !task.title.trim() || task.title.length > 2000 ||
      (task.description != null && (typeof task.description !== 'string' || task.description.length > 200000)) ||
      !['todo', 'in_progress', 'paused', 'completed'].includes(task.status) ||
      !Array.isArray(task.tags) || task.tags.length > 100 || task.tags.some(tag => typeof tag !== 'string' || tag.length > 1000) ||
      typeof task.estimateMinutes !== 'number' || !Number.isFinite(task.estimateMinutes) || task.estimateMinutes < 0 || task.estimateMinutes > 100000 ||
      typeof task.isArchived !== 'boolean' ||
      (task.privateDate != null && (typeof task.privateDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.privateDate))) ||
      (task.privateSlotKey != null && !['morning', 'forenoon', 'afternoon', 'night'].includes(task.privateSlotKey)) ||
      (task.priority != null && !['low', 'medium', 'high'].includes(task.priority)) ||
      (task.dueAt != null && (typeof task.dueAt !== 'number' || !Number.isFinite(task.dueAt))) ||
      !((task.plannedStartAt == null && task.plannedEndAt == null) || (Number.isSafeInteger(task.plannedStartAt) && Number.isSafeInteger(task.plannedEndAt) && task.plannedStartAt >= 0 && task.plannedEndAt >= task.plannedStartAt + 300000)) ||
      !['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(task.repeat ?? 'none') ||
      (task.repeatAnchorDate != null && (typeof task.repeatAnchorDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.repeatAnchorDate))) ||
      (task.occurrenceOverrides != null && (typeof task.occurrenceOverrides !== 'object' || Array.isArray(task.occurrenceOverrides) || Object.keys(task.occurrenceOverrides).length > 1000)) ||
      !Array.isArray(task.assigneeUserIds) || task.assigneeUserIds.length > 500 || task.assigneeUserIds.some(id => !validId(id)) || new Set(task.assigneeUserIds).size !== task.assigneeUserIds.length) {
    fail('invalid-argument', 'タスクの入力内容を確認してください。');
  }
};

const createProjectTaskMutation = (db, options = {}) => async (uid, data) => {
  if (!validId(uid) || !data || !['create', 'update', 'delete'].includes(data.action) || !validId(data.taskId)) fail('invalid-argument', 'タスクを確認してください。');
  const patch = data.patch ?? {};
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !fields.has(key))) fail('invalid-argument', '更新内容を確認してください。');
  if (patch.occurrenceOverrides !== undefined && (!patch.occurrenceOverrides || typeof patch.occurrenceOverrides !== 'object' || Array.isArray(patch.occurrenceOverrides) || Object.values(patch.occurrenceOverrides).some(value => !value || typeof value !== 'object' || Array.isArray(value)))) fail('invalid-argument', '更新内容を確認してください。');
  const taskRef = db.doc(`projectTasks/${data.taskId}`);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(taskRef);
    const creating = data.action === 'create';
    if (creating && snapshot.exists) fail('already-exists', 'タスクは既に作成されています。');
    if (!creating && !snapshot.exists) fail('not-found', '共有タスクが見つかりません。');
    const old = snapshot.exists ? snapshot.data() : null;
    const projectId = creating ? data.projectId : old.projectId;
    if (!validId(projectId) || (!creating && ((old.kind ?? 'task') !== 'task' || old.deletedAt))) fail('failed-precondition', 'タスクを編集できません。');
    const [project, member, plus, free, profile] = await Promise.all([
      tx.get(db.doc(`projects/${projectId}`)), tx.get(db.doc(`projects/${projectId}/members/${uid}`)),
      tx.get(db.doc(`temisAccessStates/${uid}`)), tx.get(db.doc(`projectAccessStates/${uid}`)),
      creating ? tx.get(db.doc(`profiles/${uid}`)) : Promise.resolve(null),
    ]);
    const plusData = plus.data() || {}, freeData = free.data() || {};
    const allowed = (plus.exists && plusData.userId === uid && plusData.tier === 'plus' && plusData.verifiedUntil > Date.now()) ||
      (free.exists && freeData.userId === uid && freeData.status === 'ready' && freeData.freeProjectId === projectId);
    if (!member.exists || member.data()?.leavingAt != null || (options.allowedRoles && !options.allowedRoles.includes(member.data()?.role)) || !project.exists || project.data().deletedAt || !allowed || (creating && project.data().taskEnabled !== true)) fail('permission-denied', 'このプロジェクトにアクセスできません。');
    const now = Date.now();
    if (data.action === 'delete' && old && (old.anonymizedReason === 'project_exit' || (old.ownerUserId == null && old.creatorUserId == null)) && member.data()?.role !== 'owner') fail('permission-denied', 'この共有タスクを消去する権限がありません。');
    if (data.expectedUpdatedAt !== undefined && old?.updatedAt !== data.expectedUpdatedAt) fail('aborted', 'タスクが変更されました。もう一度お試しください。');
    const priorIds = old ? assigneesOf(old) : [];
    if (patch.assigneeUserIds !== undefined && !creating && (!Array.isArray(data.expectedAssigneeIds) || !sameIds(priorIds, data.expectedAssigneeIds))) fail('aborted', '担当者が変更されました。画面を開き直して確認してください。');
    const ids = patch.assigneeUserIds !== undefined ? patch.assigneeUserIds : creating ? [uid] : priorIds;
    if (!Array.isArray(ids)) fail('invalid-argument', '担当者を確認してください。');
    if (ids.length > 500) fail('invalid-argument', '担当者は500人まで選択できます。');
    const displayName = profile?.data()?.displayName?.trim() || (profile?.data()?.username ? `@${profile.data().username}` : null);
    const base = old || { id: data.taskId, projectId, kind: 'task', ownerUserId: uid, creatorUserId: uid, creatorDisplayName: displayName, creatorAnonymizedAt: null, anonymizedReason: null, createdAt: now, deletedAt: null, elapsedMinutes: 0, startAt: null, completedAt: null, title: '', description: null, status: 'todo', tags: [], estimateMinutes: 25, isArchived: false };
    if (patch.occurrenceOverrides) patch.occurrenceOverrides = { ...base.occurrenceOverrides, ...Object.fromEntries(Object.entries(patch.occurrenceOverrides).map(([day, value]) => [day, { ...base.occurrenceOverrides?.[day], ...value }])) };
    const next = { ...base, tags: Array.isArray(base.tags) ? base.tags : [], estimateMinutes: base.estimateMinutes ?? 25, isArchived: base.isArchived === true, ...patch, assigneeUserIds: ids, assigneeUserId: ids[0] ?? null, updatedAt: now };
    validate(next);
    if (patch.assigneeUserIds !== undefined || creating) {
      const members = await Promise.all(ids.map(id => tx.get(db.doc(`projects/${projectId}/members/${id}`))));
      if (members.some(item => !item.exists || item.data()?.leavingAt != null)) fail('failed-precondition', '担当者はProjectメンバーから選択してください。');
    }
    if (data.action === 'delete') next.deletedAt = now;
    const desiredStatus = data.action === 'delete' && next.status === 'in_progress' ? 'paused' : patch.isArchived === true && next.status === 'in_progress' ? 'paused' : next.status;
    if (desiredStatus === 'in_progress' && next.isArchived) fail('failed-precondition', 'アーカイブから復元してから開始してください。');
    if (creating) {
      next.startAt = desiredStatus === 'in_progress' ? now : null;
      next.completedAt = desiredStatus === 'completed' ? now : null;
    } else if (old.status !== desiredStatus) {
      next.elapsedMinutes = Math.max(0, old.elapsedMinutes ?? 0) + (old.status === 'in_progress' && old.startAt != null ? Math.max(0, now - old.startAt) / 60000 : 0);
      next.startAt = desiredStatus === 'in_progress' ? now : null;
      next.completedAt = desiredStatus === 'completed' ? now : null;
    }
    next.status = desiredStatus;
    if (data.action === 'delete' || patch.title !== undefined || patch.description !== undefined || (creating && next.description?.trim()) || (!next.relatedMemoId && next.description?.trim())) {
      const noteId = next.relatedMemoId ?? `project-task-${data.taskId}`;
      const noteRef = db.doc(`projectNotes/${noteId}`);
      const note = await tx.get(noteRef);
      const previous = note.exists ? note.data() : null;
      if (previous && (previous.projectId !== projectId || (previous.sourceTaskId ? previous.sourceTaskId !== data.taskId : next.relatedMemoId !== noteId))) fail('failed-precondition', '関連メモの紐付けを確認してください。');
      if (previous || (data.action !== 'delete' && next.description?.trim())) {
        next.relatedMemoId = noteId;
        tx.set(noteRef, { ...(previous || { id: noteId, projectId, ownerUserId: base.ownerUserId, sourceNoteId: noteId, creatorDisplayName: base.creatorDisplayName ?? null }), sourceTaskId: data.taskId, title: next.title, body: next.description ?? '', ...(data.action === 'delete' ? { deletedAt: now } : {}), updatedAt: now });
      }
    }
    tx.set(taskRef, next);
    return next;
  });
};
module.exports = { createProjectTaskMutation, assigneesOf };
