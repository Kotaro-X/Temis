export type DMNotificationTarget = { conversationId: string; recipientUserId: string };
export const dmNotificationTarget = (data: Record<string, unknown>, userId: string | null): DMNotificationTarget | null => {
  if (data.type !== 'dm' || !userId || data.recipientUserId !== userId
    || typeof data.conversationId !== 'string' || !/^[a-f0-9]{64}$/.test(data.conversationId)) return null;
  return { conversationId: data.conversationId, recipientUserId: userId };
};
