import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { getMemoByTaskId, upsertMemoForTask } from "../db/memoRepo";
import TokenChips from "../components/TokenChips";
import TokenReferenceOverlay from "../components/TokenReferenceOverlay";
import { extractTokens } from "../utils/wikiLink";

type Props = {
  taskId: string;
  onSelectTaskId?: (taskId: string) => void;
};

const TaskDetailScreen = ({ taskId, onSelectTaskId }: Props) => {
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMemoByTaskId(taskId)
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

  const handleSave = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await upsertMemoForTask(taskId, body);
    } finally {
      setSaving(false);
    }
  };

  const handlePressToken = (token: string) => {
    setActiveToken(token);
    setOverlayOpen(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>メモ</Text>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? "保存中" : "保存"}</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.memoInput}
        placeholder="メモを入力"
        multiline
        value={body}
        onChangeText={setBody}
      />
      {loading ? (
        <Text style={styles.helperText}>読み込み中...</Text>
      ) : (
        <View style={styles.tokenSection}>
          <Text style={styles.tokenLabel}>リンク単語一覧</Text>
          <TokenChips tokens={tokens} onPressToken={handlePressToken} />
        </View>
      )}
      <TokenReferenceOverlay
        visible={overlayOpen}
        token={activeToken}
        onClose={() => setOverlayOpen(false)}
        onSelectTaskId={onSelectTaskId}
      />
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
  saveButton: {
    backgroundColor: "#111827",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  memoInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    minHeight: 120,
    textAlignVertical: "top",
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

export default TaskDetailScreen;
