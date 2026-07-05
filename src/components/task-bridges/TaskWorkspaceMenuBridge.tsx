import React, { useCallback } from "react";
import { Pressable, Text } from "react-native";

import { useAppUI } from "../../context/AppUIContext";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  onCloseMenu: () => void;
};

const TaskWorkspaceMenuBridge = ({ styles, tr, onCloseMenu }: Props) => {
  const { openTaskArchive, openTaskLogs } = useAppUI();

  const handleArchivePress = useCallback(() => {
    openTaskArchive();
    onCloseMenu();
  }, [onCloseMenu, openTaskArchive]);

  const handleLogsPress = useCallback(() => {
    openTaskLogs();
    onCloseMenu();
  }, [onCloseMenu, openTaskLogs]);

  return (
    <>
      <Pressable style={styles.sheetItem} onPress={handleArchivePress}>
        <Text style={styles.sheetItemText}>{tr("menu.archive")}</Text>
      </Pressable>
      <Pressable style={styles.sheetItem} onPress={handleLogsPress}>
        <Text style={styles.sheetItemText}>{tr("menu.logs")}</Text>
      </Pressable>
    </>
  );
};

export default TaskWorkspaceMenuBridge;
