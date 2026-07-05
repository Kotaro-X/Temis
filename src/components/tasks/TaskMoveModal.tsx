import React from "react";
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

type SlotOption = {
  key: string;
  label: string;
  active: boolean;
  onPress: () => void;
};

type Props = {
  styles: Record<string, any>;
  visible: boolean;
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  prevLabel: string;
  nextLabel: string;
  dateDraft: string;
  onChangeDateDraft: (value: string) => void;
  dateError: string | null;
  slotOptions: SlotOption[];
  onPrevDate: () => void;
  onNextDate: () => void;
  onClose: () => void;
  onConfirm: () => void;
};

export type TaskMoveModalProps = Props;

const TaskMoveModal = ({
  styles,
  visible,
  title,
  cancelLabel,
  confirmLabel,
  prevLabel,
  nextLabel,
  dateDraft,
  onChangeDateDraft,
  dateError,
  slotOptions,
  onPrevDate,
  onNextDate,
  onClose,
  onConfirm,
}: Props) => {
  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.dateOverlay}>
        <Pressable style={styles.dateBackdrop} onPress={onClose} />
        <View style={styles.datePanel}>
          <Text style={styles.dateTitle}>{title}</Text>
          <View style={styles.dateShiftRow}>
            <Pressable style={styles.dateShiftButton} onPress={onPrevDate}>
              <Text style={styles.dateShiftText}>{prevLabel}</Text>
            </Pressable>
            <Pressable style={styles.dateShiftButton} onPress={onNextDate}>
              <Text style={styles.dateShiftText}>{nextLabel}</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.dateInput}
            value={dateDraft}
            onChangeText={onChangeDateDraft}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
          {dateError ? <Text style={styles.errorText}>{dateError}</Text> : null}
          <View style={styles.moveSlotRow}>
            {slotOptions.map((slot) => (
              <Pressable
                key={slot.key}
                style={[
                  styles.moveSlotButton,
                  slot.active && styles.moveSlotButtonActive,
                ]}
                onPress={slot.onPress}
              >
                <Text
                  style={[
                    styles.moveSlotText,
                    slot.active && styles.moveSlotTextActive,
                  ]}
                >
                  {slot.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.dateActionRow}>
            <Pressable style={styles.dateActionButton} onPress={onClose}>
              <Text style={styles.dateActionText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.dateActionButton, styles.dateActionPrimary]}
              onPress={onConfirm}
            >
              <Text style={[styles.dateActionText, styles.dateActionPrimaryText]}>
                {confirmLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default TaskMoveModal;
