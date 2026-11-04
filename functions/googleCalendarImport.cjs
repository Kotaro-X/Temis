const { isDeepStrictEqual } = require('node:util');
const { HttpsError } = require('firebase-functions/v2/https');
const { createProjectTaskMutation } = require('./projectTaskMutationCore.cjs');
const { patchFor, CalendarHold } = require('./googleCalendarMerge.cjs');

// All incoming changes are compare-and-set against the exact source snapshot.
// The worker lease, access grant and optional receipt are part of that transaction.
const applyCalendarChange = async ({ db, uid, kind, sourceRef, source, occurrenceKey, value, timeZone, lease, projectId, receipt }) => {
  const change = patchFor(source, kind, occurrenceKey, value, timeZone);
  if (kind === 'project') {
    const mutate = createProjectTaskMutation(db, {
      monotonicUpdatedAt: true, allowedRoles: ['owner', 'member'], requiredAssigneeUserId: uid, expectedProjectId: projectId,
      validateCurrent: async (tx, current) => {
        await lease.validate(tx);
        if (!isDeepStrictEqual(current, source)) throw new HttpsError('aborted', 'タスクが変更されました。');
      },
      afterWrite: receipt ? tx => tx.set(receipt.ref, receipt.data, { merge: true }) : undefined,
    });
    return mutate(uid, { taskId: sourceRef.id, action: change.deleteTask ? 'delete' : 'update', expectedUpdatedAt: source.updatedAt, patch: change.patch ?? {} });
  }
  return db.runTransaction(async tx => {
    await lease.validate(tx);
    const [snapshot, access] = await Promise.all([tx.get(sourceRef), tx.get(db.doc(`temisAccessStates/${uid}`))]);
    const current = snapshot.data();
    if (!snapshot.exists || !isDeepStrictEqual(current, source)) throw new HttpsError('aborted', 'タスクが変更されました。');
    if (access.data()?.userId !== uid || access.data()?.tier !== 'plus' || access.data()?.verifiedUntil <= Date.now()) throw new HttpsError('permission-denied', 'クラウド同期の利用権を確認してください。');
    if (current.schemaVersion !== 3 || current.record?.kind !== 'state') throw new CalendarHold('unsupported_task');
    if (current.deletedAt != null || current.isDeleted || current.record.task.isArchived) throw new HttpsError('aborted', 'タスクの状態が変更されました。');
    const now = Math.max(Date.now(), current.updatedAt + 1);
    const patch = change.patch ?? {};
    const task = { ...current.record.task, repeat: current.record.task.repeat ?? 'none', repeatAnchorDate: current.record.task.repeatAnchorDate ?? null, occurrenceOverrides: current.record.task.occurrenceOverrides ?? {}, ...patch,
      ...(patch.occurrenceOverrides ? { occurrenceOverrides: { ...current.record.task.occurrenceOverrides, ...patch.occurrenceOverrides } } : {}),
    };
    const next = { ...current, updatedAt: now, deviceId: 'google-calendar',
      deletedAt: change.deleteTask ? now : null, isDeleted: Boolean(change.deleteTask),
      record: { ...current.record, ...(change.date ? { date: change.date, slotKey: change.slot } : {}), task },
    };
    tx.set(sourceRef, next);
    if (receipt) tx.set(receipt.ref, receipt.data, { merge: true });
    return next;
  });
};
module.exports = { applyCalendarChange };
