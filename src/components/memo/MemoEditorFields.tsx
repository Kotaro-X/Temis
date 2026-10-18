import React, { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import TokenChips from "../TokenChips";
import MemoTextEditor from "../inputs/MemoTextEditor";

type Props = {
  title: string;
  body: string;
  editable: boolean;
  showTitle?: boolean;
  language: "ja" | "en";
  tokens: string[];
  onChangeTitle: (value: string) => void;
  onChangeBody: (value: string) => void;
  onEditBody?: () => void;
  onPressToken?: (token: string) => void;
};

const MemoEditorFields = ({
  title,
  body,
  editable,
  showTitle = true,
  language,
  tokens,
  onChangeTitle,
  onChangeBody,
  onPressToken,
  onEditBody,
}: Props) => {
  const previewTouch = useRef({ x: 0, y: 0, moved: false });
  return (
  <>
    {showTitle ? (
      <View style={styles.titleInputRow}>
        <Text style={styles.label}>{language === "en" ? "Title" : "タイトル"}</Text>
        <TextInput
          style={[styles.titleInput, !editable && styles.readOnlyInput]}
          value={title}
          onChangeText={onChangeTitle}
          placeholder={language === "en" ? "Title (optional)" : "タイトル（任意）"}
          editable={editable}
        />
      </View>
    ) : null}
    {onEditBody ? <View style={styles.bodyHeading}>
      <Text style={styles.label}>{language === 'en' ? 'Body' : '本文'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={language === 'en' ? 'Edit body' : '本文を編集'} disabled={!editable} onPress={onEditBody} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}>
        <Text style={{ color: '#2563eb', fontSize: 12 }}>{language === 'en' ? 'Edit' : '編集'}</Text>
      </Pressable>
    </View> : null}
    {onEditBody || !editable ? (
      <View style={[styles.editor, styles.bodyPreview]}>
        <ScrollView
          style={styles.previewScroll}
          contentContainerStyle={styles.previewContent}
          keyboardShouldPersistTaps="always"
          onTouchStart={(event) => {
            previewTouch.current = {
              x: event.nativeEvent.pageX,
              y: event.nativeEvent.pageY,
              moved: false,
            };
          }}
          onTouchMove={(event) => {
            const touch = previewTouch.current;
            if (Math.hypot(event.nativeEvent.pageX - touch.x, event.nativeEvent.pageY - touch.y) > 8) {
              touch.moved = true;
            }
          }}
          onScrollBeginDrag={() => { previewTouch.current.moved = true; }}
        >
          <Pressable
            style={styles.previewPressable}
            disabled={!editable}
            onPress={() => { if (!previewTouch.current.moved) onEditBody?.(); }}
            accessibilityRole="button"
            accessibilityLabel={language === "en" ? "Edit body full screen" : "本文を全画面で編集"}
          >
            <Text style={styles.previewText} selectable={!editable}>
              {body || (language === "en" ? "Tap to edit body" : "タップして本文を編集")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    ) : (
      <MemoTextEditor
        value={body}
        onChangeText={onChangeBody}
        placeholder={language === "en" ? "Body" : "本文"}
        editable={editable}
        style={styles.editor}
        inputStyle={[styles.bodyInput, !editable && styles.readOnlyInput]}
        linkStyle={styles.memoLink}
        enableHighlight={false}
      />
    )}
    <View style={styles.tokenSection}>
      <Text style={styles.label}>{language === "en" ? "Wiki links" : "Wikiリンク"}</Text>
      <TokenChips
        tokens={tokens}
        onPressToken={onPressToken}
        emptyLabel={language === "en" ? "No linked terms" : undefined}
      />
    </View>
  </>
  );
};

const styles = StyleSheet.create({
  titleInputRow: { marginBottom: 12 },
  label: { fontSize: 12, color: "#6b7280", marginBottom: 6 },
  titleInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    color: "#111827",
  },
  editor: { flex: 1 },
  bodyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bodyPreview: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, overflow: "hidden", minHeight: 180 },
  previewScroll: { flex: 1 },
  previewContent: { flexGrow: 1 },
  previewPressable: { flexGrow: 1, padding: 10 },
  previewText: { color: "#111827", fontSize: 14, lineHeight: 20 },
  bodyInput: { minHeight: 160, color: "#111827" },
  readOnlyInput: { backgroundColor: "#f9fafb", color: "#4b5563" },
  memoLink: { backgroundColor: "#fef3c7", color: "#1f2937", fontWeight: "600" },
  tokenSection: { marginTop: 12, flexShrink: 0, minWidth: 0 },
});

export default MemoEditorFields;
