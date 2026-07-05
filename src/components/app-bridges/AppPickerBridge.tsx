import React from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";

import appChromeStyles from "../../styles/appChromeStyles";

type CalendarCell = {
  iso: string;
  day: number;
  inCurrentMonth: boolean;
};

type Props = {
  visible: boolean;
  onRequestClose: () => void;
  tr: (key: string) => string;
  dateDraft: string;
  onChangeDateDraft: (value: string) => void;
  dateError: string | null;
  calendarMonthLabel: string;
  calendarWeekdayLabels: string[];
  calendarCells: CalendarCell[];
  onPrevDate: () => void;
  onToday: () => void;
  onNextDate: () => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (iso: string) => void;
  onConfirm: () => void;
};

const AppPickerBridge = ({
  visible,
  onRequestClose,
  tr,
  dateDraft,
  onChangeDateDraft,
  dateError,
  calendarMonthLabel,
  calendarWeekdayLabels,
  calendarCells,
  onPrevDate,
  onToday,
  onNextDate,
  onPrevMonth,
  onNextMonth,
  onSelectDate,
  onConfirm,
}: Props) => (
  <Modal
    transparent
    visible={visible}
    animationType="fade"
    onRequestClose={onRequestClose}
  >
    <View style={appChromeStyles.dateOverlay}>
      <Pressable style={appChromeStyles.dateBackdrop} onPress={onRequestClose} />
      <View style={appChromeStyles.datePanel}>
        <Text style={appChromeStyles.dateTitle}>{tr("date.select")}</Text>
        <View style={appChromeStyles.dateShiftRow}>
          <Pressable style={appChromeStyles.dateShiftButton} onPress={onPrevDate}>
            <Text style={appChromeStyles.dateShiftText}>{tr("date.prev")}</Text>
          </Pressable>
          <Pressable style={appChromeStyles.dateShiftButton} onPress={onToday}>
            <Text style={appChromeStyles.dateShiftText}>{tr("date.today")}</Text>
          </Pressable>
          <Pressable style={appChromeStyles.dateShiftButton} onPress={onNextDate}>
            <Text style={appChromeStyles.dateShiftText}>{tr("date.next")}</Text>
          </Pressable>
        </View>
        <TextInput
          style={appChromeStyles.dateInput}
          value={dateDraft}
          onChangeText={onChangeDateDraft}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
        <View style={appChromeStyles.calendarHeaderRow}>
          <Pressable
            style={appChromeStyles.calendarMonthButton}
            onPress={onPrevMonth}
          >
            <Text style={appChromeStyles.calendarMonthButtonText}>◀︎</Text>
          </Pressable>
          <Text style={appChromeStyles.calendarMonthLabel}>{calendarMonthLabel}</Text>
          <Pressable
            style={appChromeStyles.calendarMonthButton}
            onPress={onNextMonth}
          >
            <Text style={appChromeStyles.calendarMonthButtonText}>▶︎</Text>
          </Pressable>
        </View>
        <View style={appChromeStyles.calendarWeekdayRow}>
          {calendarWeekdayLabels.map((label) => (
            <Text key={label} style={appChromeStyles.calendarWeekdayText}>
              {label}
            </Text>
          ))}
        </View>
        <View style={appChromeStyles.calendarGrid}>
          {calendarCells.map((cell) => {
            const isSelected = cell.iso === dateDraft;
            return (
              <Pressable
                key={cell.iso}
                style={[
                  appChromeStyles.calendarCell,
                  isSelected && appChromeStyles.calendarCellSelected,
                ]}
                onPress={() => onSelectDate(cell.iso)}
              >
                <Text
                  style={[
                    appChromeStyles.calendarCellText,
                    !cell.inCurrentMonth && appChromeStyles.calendarCellTextMuted,
                    isSelected && appChromeStyles.calendarCellTextSelected,
                  ]}
                >
                  {cell.day}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {dateError ? <Text style={appChromeStyles.errorText}>{dateError}</Text> : null}
        <View style={appChromeStyles.dateActionRow}>
          <Pressable
            style={appChromeStyles.dateActionButton}
            onPress={onRequestClose}
          >
            <Text style={appChromeStyles.dateActionText}>{tr("common.cancel")}</Text>
          </Pressable>
          <Pressable
            style={[
              appChromeStyles.dateActionButton,
              appChromeStyles.dateActionPrimary,
            ]}
            onPress={onConfirm}
          >
            <Text
              style={[
                appChromeStyles.dateActionText,
                appChromeStyles.dateActionPrimaryText,
              ]}
            >
              {tr("date.confirm")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>
);

export default AppPickerBridge;
