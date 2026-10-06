import { getNoteById } from '../../db/noteRepo';
import { loadMemoById } from '../../repositories/memoRepository';
import { getResearchNoteById } from '../researchNoteService';
import type { PublicationContent } from './guildPublicationPolicy';
export const resolveGuildSourceMemoId = async (id: string): Promise<string> => {
  if (id.startsWith('note:') || id.startsWith('tankyu:')) return id;
  if (await loadMemoById(id)) return id;
  return await getNoteById(id) ? `note:${id}` : id;
};
export const readGuildSourceContent = async (raw: string): Promise<PublicationContent | null> => {
  const id = await resolveGuildSourceMemoId(raw);
  const record = id.startsWith('note:') ? await getNoteById(id.slice(5)) : id.startsWith('tankyu:') ? await getResearchNoteById(id.slice(7)) : await loadMemoById(id);
  if (!record) return null;
  return { sourceId: id, title: 'title' in record ? record.title : null, body: record.body, updatedAt: record.updatedAt, deviceId: '', deleted: false };
};
