import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useCloudSyncContext } from '../context/CloudSyncContext';
import { useCollaboration } from '../context/CollaborationContext';
import { useAppUI } from '../context/AppUIContext';

export default function CommunityAccessBoundary({ visible, title, contentPaddingTop, children }: {
  visible: boolean; title: string; contentPaddingTop: number; children: React.ReactNode;
}) {
  const { user, authStatus } = useCloudSyncContext();
  const { accountUserId } = useCollaboration();
  const { openSettingsAccount, openMenu } = useAppUI();
  if (authStatus === 'signedIn' && user?.id && user.id === accountUserId) {
    // A logout/account switch unmounts every child, discarding posts, modals and pending views.
    return <React.Fragment key={accountUserId}>{children}</React.Fragment>;
  }
  if (!visible) return null;
  return <View style={{ flex: 1, paddingTop: contentPaddingTop, paddingHorizontal: 20, gap: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 16 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="メニューを開く" onPress={openMenu}><Text style={{ fontSize: 24 }}>☰</Text></Pressable>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>{title}</Text>
    </View>
    {authStatus === 'restoring' || authStatus === 'signingIn' ? <ActivityIndicator /> : <>
      <Text>{title}を利用するにはアカウントにログインしてください。</Text>
      <Pressable accessibilityRole="button" onPress={openSettingsAccount} style={{ alignSelf: 'flex-start', padding: 14, backgroundColor: '#eff6ff', borderRadius: 10 }}>
        <Text style={{ color: '#2563eb', fontWeight: '600' }}>ログインへ進む</Text>
      </Pressable>
    </>}
  </View>;
}
