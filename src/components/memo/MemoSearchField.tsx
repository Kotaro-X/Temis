import React, { useEffect, useMemo, useRef, useState } from "react";
import { InputAccessoryView, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import BracketToolbar from "../BracketToolbar";
import { normalizeParens } from "../../utils/wikiLink";
import { clampEditorSelection, getEditorSelectionOverride, shouldAcceptNativeSelection, type EditorSelection, type PendingSelectionRequest } from "../inputs/memoTextEditorSelection";

export default function MemoSearchField({ value, onChangeText, tokens, placeholder }: {
  value: string; onChangeText: (text: string) => void; tokens: string[]; placeholder: string;
}) {
  const [accessoryId] = useState(() => `memo-search-${Math.random().toString(36).slice(2)}`);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [pending, setPending] = useState<PendingSelectionRequest | null>(null);
  const [focused, setFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const nextValue = useRef(value);
  useEffect(() => { const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true)); const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false)); return () => { show.remove(); hide.remove(); }; }, []);
  const suggestions = useMemo(() => {
    const normalized = normalizeParens(value); const start = normalized.lastIndexOf("((");
    if (start < 0 || normalized.slice(start + 2).includes("))")) return [];
    const needle = normalized.slice(start + 2).trim().toLocaleLowerCase();
    const counts = new Map<string, { label: string; count: number }>();
    for (const token of tokens) { const key = token.toLocaleLowerCase(); const entry = counts.get(key); counts.set(key, { label: entry?.label ?? token, count: (entry?.count ?? 0) + 1 }); }
    return [...counts.entries()].filter(([key]) => key.includes(needle)).sort(([a, av], [b, bv]) => Number(b.startsWith(needle)) - Number(a.startsWith(needle)) || bv.count - av.count || a.localeCompare(b)).slice(0, 10).map(([, entry]) => entry.label);
  }, [tokens, value]);
  const toolbar = <BracketToolbar value={value} selection={selection} onChangeText={text => { nextValue.current = text; onChangeText(text); }} onSelectionChange={next => { setSelection(next); setPending({ expectedValue: nextValue.current, selection: next }); }} />;
  return <View style={styles.row}>
    <TextInput style={styles.input} value={value} placeholder={placeholder} onChangeText={text => { setPending(null); onChangeText(text); }}
      selection={getEditorSelectionOverride(value, pending)} onSelectionChange={event => { const next = clampEditorSelection(event.nativeEvent.selection, value.length); if (shouldAcceptNativeSelection(next, pending)) { setSelection(next); setPending(null); } }}
      inputAccessoryViewID={Platform.OS === "ios" ? accessoryId : undefined} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPending(null); }} />
    {suggestions.length ? <View style={styles.suggestions}><ScrollView keyboardShouldPersistTaps="always">{suggestions.map(token => <Pressable key={token} style={styles.suggestion} onPress={() => { setPending(null); onChangeText(`((${token}))`); }}><Text>{`((${token}))`}</Text></Pressable>)}</ScrollView></View> : null}
    {Platform.OS === "ios" ? <InputAccessoryView nativeID={accessoryId} backgroundColor="#fff">{toolbar}</InputAccessoryView> : focused && keyboardVisible ? toolbar : null}
  </View>;
}
const styles = StyleSheet.create({ row: { paddingHorizontal: 16, marginBottom: 8, zIndex: 10 }, input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, color: "#111827" }, suggestions: { backgroundColor: "#fff", borderColor: "#e5e7eb", borderWidth: 1, borderRadius: 8, maxHeight: 180 }, suggestion: { padding: 10 } });
