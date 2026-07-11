import { StyleSheet } from "react-native";

const TIME_PICKER_ITEM_HEIGHT = 44;
const TIME_PICKER_VISIBLE_ROWS = 5;
const TIME_PICKER_SIDE_PADDING =
  ((TIME_PICKER_VISIBLE_ROWS - 1) / 2) * TIME_PICKER_ITEM_HEIGHT;

export const dateTimeStyles = {
  todoDateOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    padding: 24,
  },
  timePickerPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
  },
  timePickerColumns: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  timePickerColumn: {
    width: 96,
    height: TIME_PICKER_ITEM_HEIGHT * 5,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f9fafb",
  },
  timePickerContent: {
    paddingVertical: TIME_PICKER_SIDE_PADDING,
  },
  timePickerItem: {
    height: TIME_PICKER_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  timePickerItemText: {
    fontSize: 20,
    color: "#9ca3af",
  },
  timePickerItemTextSelected: {
    color: "#111827",
    fontWeight: "700",
  },
  timePickerColon: {
    fontSize: 22,
    color: "#111827",
    marginHorizontal: 14,
    fontWeight: "700",
  },
  dateBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  datePanel: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
  },
  dateTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 12,
  },
  dateShiftRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  dateShiftButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
  },
  dateShiftText: {
    fontSize: 12,
    color: "#111827",
  },
  dateInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  calendarHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  calendarMonthButton: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  calendarMonthButtonText: {
    fontSize: 12,
    color: "#111827",
  },
  calendarMonthLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  calendarWeekdayRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  calendarWeekdayText: {
    width: `${100 / 7}%`,
    textAlign: "center",
    fontSize: 11,
    color: "#6b7280",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 8,
  },
  calendarCell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderRadius: 8,
  },
  calendarCellSelected: {
    backgroundColor: "#111827",
  },
  calendarCellText: {
    fontSize: 12,
    color: "#111827",
  },
  calendarCellTextMuted: {
    color: "#9ca3af",
  },
  calendarCellTextSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  dateActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 8,
  },
  dateActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dateActionText: {
    fontSize: 13,
    color: "#111827",
  },
  dateActionPrimary: {
    backgroundColor: "#111827",
    borderRadius: 8,
    marginLeft: 8,
  },
  dateActionPrimaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
};
