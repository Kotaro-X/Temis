import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useDirectMessages } from '../../context/DirectMessagesContext';
import { setConnectionBlocked, listProjectCreatorProfiles } from '../../services/collaboration/collaborationService';
export default function BlockedUsersSettings() {
  const { connections, userId } = useDirectMessages(); const [names, setNames] = useState<Record<string, string>>({}); const [busy, setBusy] = useState<string | null>(null);
  const blocked = connections.filter(item => item.status === 'blocked' && (item.blockedByUserIds?.includes(userId || '') || item.blockedByUserId === userId));
  useEffect(() => {
    let alive = true; const ids = connections.filter(item => item.status === 'blocked').flatMap(item => item.userIds.filter(id => id !== userId));
    void listProjectCreatorProfiles(ids).then(profiles => { if (alive) setNames(Object.fromEntries(profiles.map(profile => [profile.userId, profile.displayName]))); }).catch(() => undefined);
    return () => { alive = false; };
  }, [connections, userId]);
  return <View style={{ gap: 8, marginVertical: 12 }}><Text style={{ fontWeight: '700' }}>ブロックしたユーザー</Text>{!blocked.length ? <Text>ブロックしたユーザーはいません。</Text> : blocked.map(item => {
    const other = item.userIds.find(id => id !== userId)!;
    return <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={{ flex: 1 }}>{names[other] || 'Temisユーザー'}</Text><Pressable disabled={Boolean(busy)} style={{ padding: 12 }} onPress={() => Alert.alert('ブロックを解除しますか？', '繋がりは自動復元されません。相手によるブロックは解除されません。', [{ text: 'キャンセル', style: 'cancel' }, { text: '解除', onPress: () => { setBusy(other); void setConnectionBlocked(other, false, userId || undefined).catch(cause => Alert.alert('解除できません', cause.message)).finally(() => setBusy(null)); } }])}><Text style={{ color: '#2563eb' }}>{busy === other ? '処理中…' : '解除'}</Text></Pressable></View>;
  })}</View>;
}
