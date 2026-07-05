import React, { useCallback } from "react";
import { Pressable, Text } from "react-native";

import { useAppUI } from "../../context/AppUIContext";
import { useTaskWorkspace } from "../../context/TaskWorkspaceContext";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  onCloseMenu: () => void;
};

const TaskSelectionMenuBridge = ({ styles, tr, onCloseMenu }: Props) => {
  const { selectionMode, enterSelectionMode, exitSelectionMode } =
    useTaskWorkspace();
  const { openTaskToday } = useAppUI();

  const handlePress = useCallback(() => {
    if (selectionMode) {
      exitSelectionMode();
    } else {
      openTaskToday();
      enterSelectionMode();
    }
    onCloseMenu();
  }, [
    enterSelectionMode,
    exitSelectionMode,
    onCloseMenu,
    openTaskToday,
    selectionMode,
  ]);

  return (
    <Pressable style={styles.sheetItem} onPress={handlePress}>
      <Text style={styles.sheetItemText}>
        {selectionMode ? tr("menu.selectionEnd") : tr("menu.selectionStart")}
      </Text>
    </Pressable>
  );
};

export default TaskSelectionMenuBridge;
