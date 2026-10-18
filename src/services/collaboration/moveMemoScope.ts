import { nanoid } from "nanoid/non-secure";
import { getNoteById, setNoteScope, upsertNoteRecord } from "../../db/noteRepo";
import { getFirebaseAuth } from "../sync/firebaseApp";
import { listProjectSharedNotes, listProjectTasks, moveProjectSharedNote, upsertProjectSharedNote } from "./collaborationService";
import type { UserProfile } from "../../types/collaboration";

/** Stage the local source, atomically transfer cloud sharing, and restore on rejection. */
export async function moveMemoScope(sourceId: string, destination: string | null, profile: UserProfile) {
  const assertUser = () => { if (getFirebaseAuth().currentUser?.uid !== profile.userId) throw new Error("アカウントが切り替わりました。"); };
  assertUser();
  const previous = await getNoteById(sourceId); assertUser();
  if (!previous) throw new Error("元メモが見つかりません。");
  if (previous.projectId === destination && previous.scope === (destination ? "project" : "personal")) return previous;
  let sharedId: string | null = null;
  if (previous.scope === "project" && previous.projectId) {
    const [notes, tasks] = await Promise.all([listProjectSharedNotes(previous.projectId), listProjectTasks(previous.projectId)]); assertUser();
    if (tasks.some(task => task.relatedMemoId === sourceId)) throw new Error("タスクに紐づくメモの保存先は変更できません。");
    const shared = notes.find(note => note.sourceNoteId === sourceId);
    if (!shared || shared.ownerUserId !== profile.userId || shared.anonymizedReason) throw new Error("保存先を変更する権限がありません。");
    sharedId = shared.id;
  }
  const next = { ...previous, scope: destination ? "project" as const : "personal" as const, projectId: destination, updatedAt: Date.now() };
  assertUser(); await upsertNoteRecord(next);
  try {
    assertUser();
    if (sharedId) await moveProjectSharedNote(sharedId, destination, nanoid());
    else if (destination) await upsertProjectSharedNote({ id: nanoid(), sourceNoteId: sourceId, ownerUserId: profile.userId,
      creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`, projectId: destination,
      title: next.title, body: next.body, updatedAt: next.updatedAt });
  } catch (cause) { if (getFirebaseAuth().currentUser?.uid === profile.userId) await upsertNoteRecord(previous); throw cause; }
  assertUser();
  // Sharing has committed and the local source already has the destination scope.
  try {
    await setNoteScope(sourceId, destination ? { scope: "project", projectId: destination } : { scope: "personal", projectId: null });
    assertUser();
    return next;
  } catch {
    assertUser();
    // Cloud transfer already committed. Report this stage honestly instead of offering an unsafe second move.
    return { ...next, syncPending: true };
  }
}
