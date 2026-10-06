import { getNoteById, upsertDailyNote, upsertFreeNote } from "../../db/noteRepo";
import type { UserProfile } from "../../types/collaboration";
import { type GuildPost } from "../../types/guild";
import { loadMemoById, updateMemo } from "../../repositories/memoRepository";
import { upsertProjectSharedNote } from "../collaboration/collaborationService";
import { getResearchNoteById, upsertResearchNote } from "../researchNoteService";
import { getOwnedGuildPost } from "./guildService";

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

export const republishOwnedGuildPost = async ({ postId, profile }: { postId: string; profile: UserProfile }): Promise<GuildPost> => {
  const post = await getOwnedGuildPost(postId);
  if (!post || post.authorUserId !== profile.userId) throw new Error('この投稿を再公開する権限がありません。');
  const { readGuildSourceContent } = await import('./guildSourceReader');
  const { enqueuePublicationContent, flushPublications, getPublicationState, registerPublicationPosts } = await import('./guildPublicationQueue');
  const content = await readGuildSourceContent(post.source.memoId);
  if (!content) throw new Error('元メモがこの端末にありません。同期後に再試行してください。');
  await registerPublicationPosts(profile.userId, content.sourceId, [post]);
  await enqueuePublicationContent(content, 'publish', undefined, profile.userId);
  await flushPublications();
  const state = await getPublicationState(profile.userId, content.sourceId);
  if (state?.pending) throw new Error(state.error ?? 'Commonsへの反映を待っています。');
  return state?.posts.find(item => item.id === postId) ?? post;
};
