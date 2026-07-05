import React from "react";
import { Pressable, Text } from "react-native";

import { useAppUI } from "../../context/AppUIContext";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  onCloseMenu: () => void;
};

const MemoWorkspaceMenuBridge = ({ styles, tr, onCloseMenu }: Props) => {
  const { openMemoHome, openMemoResearch } = useAppUI();

  return (
    <>
      <Pressable
        style={styles.sheetItem}
        onPress={() => {
          openMemoHome();
          onCloseMenu();
        }}
      >
        <Text style={styles.sheetItemText}>Memo</Text>
      </Pressable>
      <Pressable
        style={styles.sheetItem}
        onPress={() => {
          openMemoResearch();
          onCloseMenu();
        }}
      >
        <Text style={styles.sheetItemText}>{tr("research.title")}</Text>
      </Pressable>
    </>
  );
};

export default MemoWorkspaceMenuBridge;
