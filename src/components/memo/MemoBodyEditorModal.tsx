import React, { useEffect, useState } from "react";
import { BackHandler, Keyboard, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import MemoTextEditor from "../inputs/MemoTextEditor";
import { memoDetailStyles as styles } from "./MemoDetailLayout";
import type { AppLanguage } from "../../i18n";
export default function MemoBodyEditorModal({ visible, value, onChangeText, onDone, language, busy = false }: {
  visible: boolean; value: string; onChangeText: (text: string) => void; onDone: () => void; language: AppLanguage; busy?: boolean;
}) {
  const { height, width } = useWindowDimensions();
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (!visible || Platform.OS !== 'ios') { setKeyboardInset(0); return; }
    const frame = Keyboard.addListener('keyboardWillChangeFrame', event => {
      setKeyboardInset(event.endCoordinates.width >= width * 0.8 ? Math.max(0, height - event.endCoordinates.screenY) : 0);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => { frame.remove(); hide.remove(); };
  }, [visible, height, width]);
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onDone(); return true; });
    return () => subscription.remove();
  }, [visible, onDone]);
  if (!visible) return null;
  return <View style={{ ...StyleSheet.absoluteFillObject, bottom: keyboardInset, zIndex: 20, backgroundColor: '#fff' }} accessibilityViewIsModal><SafeAreaProvider initialMetrics={initialWindowMetrics}><SafeAreaView style={styles.safeArea}>
    <View style={{ flex: 1 }}>
      <View style={styles.header}><Text style={styles.headerTitle}>{language === "en" ? "Edit body" : "本文を編集"}</Text><Pressable disabled={busy} style={{ minHeight: 44, padding: 12 }} onPress={onDone}><Text style={styles.backText}>{language === "en" ? "Done" : "完了"}</Text></Pressable></View>
      <MemoTextEditor value={value} onChangeText={onChangeText} placeholder={language === 'en' ? 'Enter body' : '本文を入力'} editable={!busy} autoFocus fillAvailableSpace style={{ marginHorizontal: 16, marginBottom: 8 }} />
    </View>
  </SafeAreaView></SafeAreaProvider></View>;
}
