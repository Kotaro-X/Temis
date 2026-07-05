import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Selection = {
  start: number;
  end: number;
};

type Props = {
  value: string;
  selection: Selection | null;
  onChangeText: (text: string) => void;
  onSelectionChange: (selection: Selection) => void;
};

const OPEN_BRACKETS = "（（";
const CLOSE_BRACKETS = "））";

const BracketToolbar = ({
  value,
  selection,
  onChangeText,
  onSelectionChange,
}: Props) => {
  const safeSelection = selection ?? { start: value.length, end: value.length };

  const applyInsertion = (insertText: string, atStart: boolean) => {
    const insertIndex = atStart ? safeSelection.start : safeSelection.end;
    const nextValue =
      value.slice(0, insertIndex) + insertText + value.slice(insertIndex);
    const delta = insertText.length;

    let nextSelection: Selection;
    if (atStart) {
      nextSelection = {
        start: safeSelection.start + delta,
        end: safeSelection.end + delta,
      };
    } else if (safeSelection.start === safeSelection.end) {
      nextSelection = {
        start: safeSelection.start + delta,
        end: safeSelection.end + delta,
      };
    } else {
      nextSelection = {
        start: safeSelection.start,
        end: safeSelection.end,
      };
    }

    onChangeText(nextValue);
    onSelectionChange(nextSelection);
  };

  return (
    <View style={styles.container}>
      <View style={styles.spacer} />
      <Pressable
        style={styles.button}
        onPress={() => applyInsertion(OPEN_BRACKETS, true)}
        accessibilityLabel="（（ を挿入"
      >
        <Text style={styles.buttonText}>{OPEN_BRACKETS}</Text>
      </Pressable>
      <Pressable
        style={[styles.button, styles.buttonLast]}
        onPress={() => applyInsertion(CLOSE_BRACKETS, false)}
        accessibilityLabel="）） を挿入"
      >
        <Text style={styles.buttonText}>{CLOSE_BRACKETS}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#f3f4f6",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  spacer: {
    flex: 1,
  },
  button: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 48,
    alignItems: "center",
    marginLeft: 8,
  },
  buttonLast: {
    marginLeft: 6,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
});

export default BracketToolbar;
