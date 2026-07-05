import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import MemoTextEditor from "../inputs/MemoTextEditor";
import TokenChips from "../TokenChips";
import { loadMemoByTaskId, updateMemo } from "../../repositories/memoRepository";
import { extractTokens } from "../../utils/wikiLink";
import { AppLanguage, t } from "../../i18n";

type Props = {
  taskId: string;
  onSearchToken?: (token: string) => void;
  language: AppLanguage;
};

const TaskMemoPanel = ({ taskId, onSearchToken, language }: Props) => {
  const tr = (key: string) => t(language, key);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadMemoByTaskId(taskId)
      .then((memo) => {
        if (active) {
          setBody(memo?.body ?? "");
        }
      })
      .catch(() => {
        if (active) {
          setBody("");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  const tokens = useMemo(() => extractTokens(body), [body]);

  const saveDraft = async (nextBody: string) => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await updateMemo(taskId, nextBody, { indexMode: "async" });
      lastSavedRef.current = nextBody;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    lastSavedRef.current = body;
  }, [taskId]);

  useEffect(() => {
    if (loading || body === lastSavedRef.current) {
      return;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraft(body);
    }, 800);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [body, loading]);

  useEffect(() => () => {
    if (body !== lastSavedRef.current) {
      void saveDraft(body);
    }
  }, [body]);

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      >
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{tr("memo.title")}</Text>
        </View>
        <MemoTextEditor
          value={body}
          onChangeText={setBody}
          placeholder={language === "en" ? "Enter memo" : "メモを入力"}
          inputStyle={styles.memoInput}
          linkStyle={styles.memoLink}
          enableHighlight={false}
        />
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
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

export default TaskMemoPanel;
