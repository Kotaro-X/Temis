import { deleteNoteById, getFreeNoteById, setNoteScope, upsertNoteRecord } from "../../db/noteRepo";
import type { ProjectTask, UserProfile } from "../../types/collaboration";
import { updateProjectTask, removeProjectSharedNote, upsertProjectSharedNote } from "./collaborationService";

type SyncProjectTaskMemoInput = {
  task: ProjectTask;
  profile: UserProfile;
};

/**
 * Mirrors a project task's description into the normal memo store and the
 * project's shared memo list.  `relatedMemoId` is the stable link between the
 * task and that memo, so subsequent edits update one memo rather than creating
 * duplicates.
 */
export const syncProjectTaskMemo = async ({
  task,
  profile,
}: SyncProjectTaskMemoInput): Promise<string | null> => {
  if ((task.kind ?? "task") === "task") {
    const saved = await updateProjectTask(task.id, { description: task.description ?? null });
    return saved.relatedMemoId ?? null;
  }
  const body = task.description?.trim() ?? "";

  if (!body) {
    if (!task.relatedMemoId) return null;
    await removeProjectSharedNote(task.relatedMemoId);
    await deleteNoteById(task.relatedMemoId);
    return null;
  }

  const existing = task.relatedMemoId
    ? await getFreeNoteById(task.relatedMemoId)
    : null;
  // Persist Project scope together with the body, before any background embedding can see it.
  const note = await upsertNoteRecord({
    id: existing?.id ?? task.relatedMemoId ?? `project-todo-${task.id}`,
    type: "free", date: null, title: task.title, body,
    scope: "project", projectId: task.projectId, updatedAt: Date.now(),
  });

  const scopedNote = await setNoteScope(note.id, {
    scope: "project",
    projectId: task.projectId,
  });
  await upsertProjectSharedNote({
    id: scopedNote.id,
    sourceNoteId: scopedNote.id,
    ownerUserId: profile.userId,
    creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`,
    projectId: task.projectId,
    title: scopedNote.title,
    body: scopedNote.body,
    updatedAt: scopedNote.updatedAt,
  });
  return scopedNote.id;
};
