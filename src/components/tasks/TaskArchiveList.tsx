import React from "react";
import { Pressable, Text, View } from "react-native";

import type { ArchivedTaskItem } from "../../hooks/useTasks";
import type { SlotKey, TaskStatus } from "../../types";

type Props = {
  styles: Record<string, any>;
  tr: (key: string) => string;
  items: ArchivedTaskItem[];
  getSlotLabel: (slotKey: SlotKey) => string;
  statusLabel: Record<TaskStatus, string>;
  untitledLabel: string;
  onRestore: (item: ArchivedTaskItem) => void;
};

export type TaskArchiveListProps = Props;

const TaskArchiveList = ({
  styles,
  tr,
  items,
  getSlotLabel,
  statusLabel,
  untitledLabel,
  onRestore,
}: Props) => {
  if (items.length === 0) {
    return <Text style={styles.mutedText}>{tr("archive.none")}</Text>;
  }

  return (
    <>
      {items.map((item) => (
        <View key={item.task.id} style={styles.archiveRow}>
          <View style={styles.archiveContent}>
            <Text style={styles.archiveTitle}>
              {item.task.taskName || untitledLabel}
            </Text>
            <Text style={styles.archiveMeta}>
              {`${getSlotLabel(item.slotKey)} / ${statusLabel[item.task.status]}`}
            </Text>
          </View>
          <Pressable
            style={styles.archiveActionButton}
            onPress={() => onRestore(item)}
          >
            <Text style={styles.archiveActionText}>{tr("archive.restore")}</Text>
          </Pressable>
        </View>
      ))}
    </>
  );
};

export default TaskArchiveList;
