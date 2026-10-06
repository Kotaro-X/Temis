import React, { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCollaboration } from '../context/CollaborationContext';
import { useCloudSyncContext } from '../context/CloudSyncContext';
import ProfilePhotoEditor from '../components/ProfilePhotoEditor';

const Button = ({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
function SetupForm() {
  const { profile, completeProfile } = useCollaboration();
  const [name, setName] = useState(profile?.displayName ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await completeProfile({ displayName: name, username }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存できませんでした。もう一度お試しください。'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <View style={styles.form}>
    <Text style={styles.title}>プロフィールを設定</Text>
    <Text>アプリを利用するには、表示名とユーザーネームを設定してください。</Text>
    <Text style={styles.label}>表示名（必須）</Text>
    <TextInput accessibilityLabel="表示名" editable={!busy} style={styles.input} value={name} onChangeText={setName} maxLength={50} placeholder="表示名を入力" />
    <Text style={styles.label}>ユーザーネーム（@ID・必須）</Text>
    <TextInput accessibilityLabel="ユーザーネーム" editable={!busy} style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} maxLength={31} placeholder="ご希望のユーザーIDを入力" />
    <Text style={styles.caption}>3〜30文字の英小文字・数字・アンダースコア・ピリオド。ほかのユーザーと同じIDは使えません。設定後の変更は30日に1回です。</Text>
    <ProfilePhotoEditor />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Button label={busy ? '保存中…' : '保存してはじめる'} disabled={busy || !name.trim() || !username.trim()} onPress={() => void save()} />
  </View>;
}

export default function ProfileSetupBoundary({ children }: { children: React.ReactNode }) {
  const { profile, profileSetupStatus, error, refreshProfile, accountUserId } = useCollaboration();
  const { authStatus, signOut, user, error: signOutError } = useCloudSyncContext();
  const insets = useSafeAreaInsets();
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutAttempted, setLogoutAttempted] = useState(false);
  const restoring = authStatus === 'restoring' || authStatus === 'signingIn';
  const ownsProfile = Boolean(accountUserId && profile?.userId === accountUserId);
  const signedOut = profileSetupStatus === 'signed_out' && !accountUserId && !user && authStatus !== 'signedIn';
  if (!restoring && (signedOut || (ownsProfile && profileSetupStatus === 'complete'))) return <>{children}</>;
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.container}>
      {restoring || profileSetupStatus === 'checking' ? <View style={styles.form}><ActivityIndicator /><Text>アカウントを確認しています…</Text></View>
        : profileSetupStatus === 'error' ? <View style={styles.form}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Button label="再試行" onPress={() => void refreshProfile()} /></View>
          : ownsProfile ? <SetupForm key={accountUserId} /> : <ActivityIndicator />}
      {!restoring && (accountUserId || user) ? <Button label={logoutBusy ? 'ログアウト中…' : 'ログアウト'} disabled={logoutBusy} onPress={() => { setLogoutAttempted(true); setLogoutBusy(true); void signOut().finally(() => setLogoutBusy(false)); }} /> : null}
      {logoutAttempted && !logoutBusy && signOutError ? <Text accessibilityRole="alert" style={styles.error}>{signOutError}</Text> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  form: { gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' }, label: { fontSize: 16, fontWeight: '600', color: '#111827' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, padding: 12, fontSize: 16, color: '#111827' },
  caption: { color: '#6b7280', lineHeight: 20 }, error: { color: '#b91c1c' },
  button: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 10, backgroundColor: '#eff6ff' },
  buttonText: { color: '#2563eb', fontWeight: '600', fontSize: 16 },
});
