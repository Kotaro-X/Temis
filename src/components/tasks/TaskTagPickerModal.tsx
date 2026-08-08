import React from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";

import type { Tag } from "../../types";

type Props = {
  styles: Record<string, any>;
  visible: boolean;
  title: string;
  closeLabel: string;
  tagOptions: Tag[];
  selectedTags: Tag[];
  onToggleTag: (tag: Tag) => void;
  onClose: () => void;
};

const TaskTagPickerModal = ({
  styles,
  visible,
  title,
  closeLabel,
  tagOptions,
  selectedTags,
  onToggleTag,
  onClose,
}: Props) => {
  if (!visible) {
    return null;
  }

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.tagPickerOverlay}>
        <Pressable style={styles.tagPickerBackdrop} onPress={onClose} />
        <View style={styles.tagPickerPanel} accessibilityViewIsModal>
          <View style={styles.tagPickerHeader}>
            <Text style={styles.tagPickerTitle}>{title}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={styles.tagPickerCloseButton}
              onPress={onClose}
            >
              <Text style={styles.tagPickerCloseText}>{closeLabel}</Text>
            </Pressable>
          </View>
          <FlatList
            data={tagOptions}
            keyExtractor={(tag) => tag}
            style={styles.tagPickerList}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: tag }) => {
              const selected = selectedTags.includes(tag);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={styles.tagPickerItem}
                  onPress={() => {
                    onToggleTag(tag);
                    onClose();
                  }}
                >
                  <Text
                    style={[
                      styles.tagPickerItemText,
                      selected && styles.tagPickerItemTextSelected,
                    ]}
                  >
                    {tag}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
};

export default TaskTagPickerModal;
