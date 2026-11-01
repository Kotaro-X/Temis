import { saveFreeNoteDraft, type NoteRecord } from "../../db/noteRepo";
import { getWorkspaceEpoch } from "../../services/account/workspaceEpoch";
import { accountWorkspace } from "../../services/account/accountWorkspace";
import { getFirebaseAuth } from "../../services/sync/firebaseApp";
import { upsertProjectSharedNote } from "../../services/collaboration/collaborationService";
import type { UserProfile } from "../../types/collaboration";
import { createWidgetMemoSave, type WidgetMemoDraft } from "./widgetMemoCore";

export function createWidgetMemoSession(profile: UserProfile | null, canWriteProject: (id: string) => boolean) {
  const epoch = getWorkspaceEpoch();
  const scope = accountWorkspace.scope();
  const assertActive = () => {
    if (epoch !== getWorkspaceEpoch() || scope !== accountWorkspace.scope()) throw new Error("アカウントまたは環境が切り替わりました。");
  };
  const record = (draft: WidgetMemoDraft): NoteRecord => ({
    id: draft.id, type: "free", date: null, title: draft.title.trim() || null, body: draft.body,
    scope: draft.projectId ? "project" : "personal", projectId: draft.projectId, updatedAt: Date.now(),
  });
  const session = createWidgetMemoSave({
    assertActive,
    savePrivate: async draft => { assertActive(); await saveFreeNoteDraft(record(draft)); },
    saveProject: async (draft, committed) => {
      assertActive();
      if (!profile || getFirebaseAuth().currentUser?.uid !== profile.userId || !draft.projectId || !canWriteProject(draft.projectId)) {
        throw Object.assign(new Error("このProjectに保存できません。Privateまたは別のProjectを選んでください。"), { code: "permission-denied" });
      }
      await upsertProjectSharedNote({
        id: draft.id, sourceNoteId: draft.id, ownerUserId: profile.userId, projectId: draft.projectId,
        creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`,
        title: draft.title.trim() || null, body: draft.body, updatedAt: Date.now(),
      }, undefined, committed);
    },
    mirrorProject: async draft => { assertActive(); await saveFreeNoteDraft(record(draft)); },
  });
  return { ...session, assertActive };
}
