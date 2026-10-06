import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import UserAvatar from './UserAvatar';
import { useCollaboration } from '../context/CollaborationContext';

export default function ProfilePhotoEditor() {
  const { profile, editPhoto, accountUserId } = useCollaboration();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const edit = async (remove: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await editPhoto(remove); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '写真を保存できませんでした。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  };
  return <View style={{ gap: 10 }} key={accountUserId}>
    <Text style={{ fontSize: 16, fontWeight: '600' }}>プロフィール写真（任意）</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <UserAvatar photoUrl={profile?.photoUrl} size={64} />
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void edit(false)} style={{ padding: 12 }}><Text style={{ color: '#2563eb' }}>写真を選択・変更</Text></Pressable>
      {profile?.photoUrl ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void edit(true)} style={{ padding: 12 }}><Text style={{ color: '#b91c1c' }}>削除</Text></Pressable> : null}
      {busy ? <ActivityIndicator /> : null}
    </View>
    <Text style={{ color: '#6b7280' }}>設定した写真はDMやCommonsの投稿に表示されます。</Text>
    {error ? <Text accessibilityRole="alert" style={{ color: '#b91c1c' }}>{error}</Text> : null}
  </View>;
}
