import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

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
}: Props) => (
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
  bodyInput: { minHeight: 160, color: "#111827" },
  readOnlyInput: { backgroundColor: "#f9fafb", color: "#4b5563" },
  memoLink: { backgroundColor: "#fef3c7", color: "#1f2937", fontWeight: "600" },
  tokenSection: { marginTop: 12 },
});

export default MemoEditorFields;
