import type { SyncEntityEnvelope } from '../../types';
export type PublicationContent = { sourceId: string; title: string | null; body: string; updatedAt: number; deviceId: string; deleted: boolean };
export const publicationContent = (envelope: SyncEntityEnvelope<'memo'>): PublicationContent => {
  const { kind, data } = envelope.record;
  return { sourceId: kind === 'note' ? `note:${data.id}` : kind === 'research' ? `tankyu:${data.id}` : data.id,
    title: 'title' in data ? data.title : null, body: data.body,
    updatedAt: envelope.deletedAt ?? envelope.updatedAt, deviceId: envelope.deviceId ?? '', deleted: envelope.isDeleted };
};
export const canonicalSourceAliases = (id: string) => id.startsWith('note:') ? [id, id.slice(5)] : [id];
