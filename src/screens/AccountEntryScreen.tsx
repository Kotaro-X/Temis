import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppSettings } from "../context/AppSettingsContext";
import { useCloudSyncContext } from "../context/CloudSyncContext";
import { isAppleSignInAvailable } from "../services/auth/appleSignIn";
import SocialSignInButtons from "../components/settings/SocialSignInButtons";
import AppLanguageBridge from "../components/app-bridges/AppLanguageBridge";

export default function AccountEntryBoundary({ children }: { children: React.ReactNode }) {
  const { storageReady, languagePickerOpen, selectInitialLanguage, appLanguage } = useAppSettings();
  const { accountEntryRequired, accountRestoreError, authStatus, error, signIn, signInWithApple,
    skipAccountEntry, retryAccountRestore, workspaceKey } = useCloudSyncContext();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [skipping, setSkipping] = useState(false);
  useEffect(() => {
    let active = true;
    void isAppleSignInAvailable().then(value => { if (active) setAppleAvailable(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const en = appLanguage === "en";
  if (!accountRestoreError && (!storageReady || accountEntryRequired === null || authStatus === "restoring")) {
    return <SafeAreaView style={styles.screen}><View style={styles.center}><ActivityIndicator /><Text>{en ? "Checking your account…" : "アカウントを確認しています…"}</Text>{accountRestoreError ? <Text style={styles.error}>{accountRestoreError}</Text> : null}</View></SafeAreaView>;
  }
  if (languagePickerOpen) return <SafeAreaView style={styles.screen}><AppLanguageBridge visible onSelectLanguage={selectInitialLanguage} /></SafeAreaView>;
  if (!accountEntryRequired && !accountRestoreError) return <React.Fragment key={workspaceKey}>{children}</React.Fragment>;
  const busy = authStatus === "signingIn" || skipping;
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{en ? "Welcome to Temis" : "Temisへようこそ"}</Text>
      <Text style={styles.body}>{en
        ? "Choose the same sign-in method and account you used before to restore your account information."
        : "以前と同じログイン方法・アカウントを選ぶと、アカウント情報を復元できます。"}</Text>
      {accountRestoreError ? <>
        <Text accessibilityRole="alert" style={styles.error}>{accountRestoreError}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void retryAccountRestore()} style={styles.button}><Text style={styles.link}>{en ? "Retry" : "再試行"}</Text></Pressable>
      </> : <>
        <SocialSignInButtons showApple={appleAvailable} disabled={busy} onGoogle={() => void signIn()} onApple={() => void signInWithApple()} />
        {busy ? <ActivityIndicator /> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </>}
      {!accountRestoreError || accountEntryRequired ? <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => {
          setSkipping(true);
          void skipAccountEntry().finally(() => setSkipping(false));
        }}><Text style={styles.link}>{en ? "Continue without signing in" : "ログインせずにはじめる"}</Text></Pressable> : null}
      <Text style={styles.caption}>{en
        ? "You can sign in later from Settings. Cloud data restores when your account has access to Cloud Sync."
        : "ログインは後から設定でも行えます。クラウド保存済みデータは、クラウド同期の利用権限がある場合に復元されます。"}</Text>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  content: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 20, width: "100%", maxWidth: 560, alignSelf: "center" },
  title: { fontSize: 26, fontWeight: "700", textAlign: "center", color: "#111827" },
  body: { fontSize: 16, lineHeight: 25, color: "#374151" },
  caption: { fontSize: 13, lineHeight: 21, color: "#6b7280" },
  button: { minHeight: 48, alignItems: "center", justifyContent: "center", padding: 12 },
  link: { color: "#2563eb", fontSize: 16, fontWeight: "600" },
  error: { color: "#b91c1c", lineHeight: 22 },
});
