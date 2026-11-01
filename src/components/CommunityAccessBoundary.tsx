import WorkspaceScopeTrigger from './app-shell/WorkspaceScopeTrigger';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
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
  return <View style={{ flex: 1, paddingTop: contentPaddingTop, backgroundColor: title === 'Commons' ? '#f8fafc' : '#fff' }}>
    <View style={{ position: 'relative', flexShrink: 0, flexDirection: 'row', alignItems: 'center', marginBottom: 12, paddingHorizontal: 16 }}>
      <View style={{ width: 120, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Pressable accessibilityRole="button" accessibilityLabel="メニューを開く" onPress={openMenu} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="menu" size={20} color="#111827" /></Pressable><WorkspaceScopeTrigger /></View>
      <Text pointerEvents="none" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ flex: 1, color: '#111827', fontSize: 18, fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      <View style={{ width: 120 }} />
    </View>
    <View style={{ flex: 1, paddingHorizontal: 20, gap: 20 }}>
    {authStatus === 'restoring' || authStatus === 'signingIn' ? <ActivityIndicator /> : <>
      <Text>{title}を利用するにはアカウントにログインしてください。</Text>
      <Pressable accessibilityRole="button" onPress={openSettingsAccount} style={{ alignSelf: 'flex-start', padding: 14, backgroundColor: '#eff6ff', borderRadius: 10 }}>
        <Text style={{ color: '#2563eb', fontWeight: '600' }}>ログインへ進む</Text>
      </Pressable>
    </>}
    </View>
  </View>;
}
