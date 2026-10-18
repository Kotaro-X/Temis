import React, { useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import MemoTextEditor from "../inputs/MemoTextEditor";
import TokenChips from "../TokenChips";
import { extractTokens } from "../../utils/wikiLink";
import { AppLanguage, t } from "../../i18n";

type Props = {
  body: string;
  setBody: (body: string) => void;
  loading?: boolean;
  saving?: boolean;
  error?: "load" | "save" | null;
  retry?: () => Promise<void>;
  onSearchToken?: (token: string) => void;
  language: AppLanguage;
};

const TaskMemoFields = ({ body, setBody, loading = false, saving = false, error = null, retry, onSearchToken, language }: Props) => {
  const tr = (key: string) => t(language, key);
  const tokens = useMemo(() => extractTokens(body), [body]);

  return (
    // This content is inside the screen's ScrollView. An inner avoidance view
    // would feed its padding back into its measured content height on keyboard show.
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{tr("memo.title")}</Text>
      </View>
      <MemoTextEditor
        editable={!loading && error !== "load"}
        value={body}
        onChangeText={setBody}
        placeholder={language === "en" ? "Enter memo" : "メモを入力"}
        inputStyle={styles.memoInput}
        linkStyle={styles.memoLink}
        enableHighlight={false}
      />
      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.helperText}>
            {error === "load"
              ? (language === "en" ? "Could not load memo." : "メモを読み込めませんでした。")
              : (language === "en" ? "Could not save memo. Your draft is retained." : "メモを保存できませんでした。入力内容は保持されています。")}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => { void retry?.(); }}>
            <Text style={styles.retryText}>{language === "en" ? "Retry" : "再試行"}</Text>
          </Pressable>
        </View>
      ) : saving ? (
        <Text style={styles.helperText}>{language === "en" ? "Saving…" : "保存中…"}</Text>
      ) : null}
      {loading ? (
        <Text style={styles.helperText}>{tr("common.loading")}</Text>
      ) : (
        <View style={styles.tokenSection}>
          <Text style={styles.tokenLabel}>
            {language === "en" ? "Wiki links" : "Wikiリンク"}
          </Text>
          <TokenChips
            tokens={tokens}
            onPressToken={onSearchToken}
            emptyLabel={language === "en" ? "No linked terms" : undefined}
          />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    paddingTop: 12,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  memoInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 14,
    lineHeight: 20,
  },
  memoLink: {
    backgroundColor: "#fef3c7",
    color: "#1f2937",
    fontWeight: "600",
  },
  retryText: { color: "#2563eb", paddingVertical: 10 },
  helperText: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
  },
  tokenSection: {
    marginTop: 12,
  },
  tokenLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
  },
});

export default TaskMemoFields;
