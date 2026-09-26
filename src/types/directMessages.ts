export type DMIdentity = { displayName: string; photoUrl: string | null };
export type DMConversation = {
  id: string;
  userIds: string[];
  memberProfiles: Record<string, DMIdentity>;
  sequence: number;
  receivedCounts: Record<string, number>;
  readCounts?: Record<string, number>;
  readSequences?: Record<string, number>;
  lastMessage: { text: string; senderUserId: string; sequence: number };
  createdAt: number;
  updatedAt: number;
  closed: boolean;
  deletedUserIds?: string[];
};
export type DirectMessage = {
  id: string;
  senderUserId: string;
  text: string;
  sequence: number;
  createdAt: number;
  deleted: boolean;
};
export type DMRecipient = DMIdentity & { userId: string };
export const unreadMessages = (thread: DMConversation, userId: string): number =>
  Math.max(0, (thread.receivedCounts[userId] || 0) - (thread.readCounts?.[userId] || 0));
export const mergeMessages = (...pages: DirectMessage[][]): DirectMessage[] =>
  [...new Map(pages.flat().map((message) => [message.id, message])).values()].sort((a, b) => b.sequence - a.sequence);
