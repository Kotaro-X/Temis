import { getNoteById, upsertDailyNote, upsertFreeNote } from "../../db/noteRepo";
import type { UserProfile } from "../../types/collaboration";
import { validateGuildPostInput, type GuildPost, type GuildPostInput } from "../../types/guild";
import { loadMemoById, updateMemo } from "../../repositories/memoRepository";
import { upsertProjectSharedNote } from "../collaboration/collaborationService";
import { getResearchNoteById, upsertResearchNote } from "../researchNoteService";
import { getOwnedGuildPost, setGuildPostStatus, updateGuildPost } from "./guildService";

export const resolveGuildSourceMemoId = async (memoId: string): Promise<string> => {
  if (memoId.startsWith("note:") || memoId.startsWith("tankyu:")) return memoId;
  if (await loadMemoById(memoId)) return memoId;
  if (await getNoteById(memoId)) return `note:${memoId}`;
  return memoId;
};

export const updateGuildSourceMemo = async ({
  source,
  title,
  body,
  profile,
}: {
  source: GuildPost["source"];
  title: string | null;
  body: string;
  profile: UserProfile;
}): Promise<string> => {
  const sourceId = source.memoId;
  if (sourceId.startsWith("note:")) {
    const noteId = sourceId.slice("note:".length);
    const existing = await getNoteById(noteId);
    if (!existing) throw new Error("元メモがこの端末にありません。同期後にもう一度お試しください。");
    const updated = existing.type === "daily" && existing.date
      ? await upsertDailyNote(existing.date, body)
      : await upsertFreeNote({ id: existing.id, title, body });
    if (updated.scope === "project" && updated.projectId) {
      await upsertProjectSharedNote({
        id: updated.id,
        sourceNoteId: updated.id,
        ownerUserId: profile.userId,
        creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`,
        projectId: updated.projectId,
        title: updated.title,
        body: updated.body,
        updatedAt: updated.updatedAt,
      });
    }
    return sourceId;
  }
  if (sourceId.startsWith("tankyu:")) {
    const researchId = sourceId.slice("tankyu:".length);
    const existing = await getResearchNoteById(researchId);
    if (!existing) throw new Error("元メモがこの端末にありません。同期後にもう一度お試しください。");
    await upsertResearchNote({
      id: existing.id,
      title: title ?? existing.title,
      body,
      tags: existing.tags,
    });
    return sourceId;
  }
  const taskMemo = await loadMemoById(sourceId);
  if (taskMemo) {
    await updateMemo(taskMemo.taskId, body);
    return sourceId;
  }

  // Early Guild posts created free notes before source ids were normalized.
  const legacyNote = await getNoteById(sourceId);
  if (!legacyNote) throw new Error("元メモがこの端末にありません。同期後にもう一度お試しください。");
  const updated = legacyNote.type === "daily" && legacyNote.date
    ? await upsertDailyNote(legacyNote.date, body)
    : await upsertFreeNote({ id: legacyNote.id, title, body });
  if (updated.scope === "project" && updated.projectId) {
    await upsertProjectSharedNote({
      id: updated.id,
      sourceNoteId: updated.id,
      ownerUserId: profile.userId,
      creatorDisplayName: profile.displayName?.trim() || `@${profile.username}`,
      projectId: updated.projectId,
      title: updated.title,
      body: updated.body,
      updatedAt: updated.updatedAt,
    });
  }
  return `note:${legacyNote.id}`;
};

export const updateOwnedGuildPostAndSource = async ({
  postId,
  input,
  profile,
}: {
  postId: string;
  input: Pick<GuildPostInput, "title" | "body" | "type" | "projectId">;
  profile: UserProfile;
}): Promise<GuildPost> => {
  const post = await getOwnedGuildPost(postId);
  if (!post) throw new Error("この投稿を編集する権限がありません。");
  const validationError = validateGuildPostInput({ ...input, source: post.source });
  if (validationError) throw new Error(validationError);
  await updateGuildSourceMemo({ source: post.source, title: input.title, body: input.body, profile });
  await updateGuildPost(postId, input);
  const updated = await getOwnedGuildPost(postId);
  if (!updated) throw new Error("投稿の更新結果を取得できませんでした。");
  return updated;
};

export const republishOwnedGuildPost = async ({
  postId,
  profile,
}: {
  postId: string;
  profile: UserProfile;
}): Promise<GuildPost> => {
  const post = await getOwnedGuildPost(postId);
  if (!post) throw new Error("この投稿を再公開する権限がありません。");
  await updateGuildSourceMemo({
    source: post.source,
    title: post.title ?? null,
    body: post.body,
    profile,
  });
  await setGuildPostStatus(postId, "published");
  const updated = await getOwnedGuildPost(postId);
  if (!updated) throw new Error("投稿の再公開結果を取得できませんでした。");
  return updated;
};
