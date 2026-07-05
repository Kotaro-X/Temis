import { Platform, StyleSheet } from "react-native";

const appChromeStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  body: {
    flex: 1,
    position: "relative",
  },
  statusBarFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    zIndex: 40,
  },
  tabBar: {
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: Platform.OS === "ios" ? StyleSheet.hairlineWidth : 1,
    borderColor:
      Platform.OS === "ios" ? "rgba(15, 23, 42, 0.12)" : "#e5e7eb",
    backgroundColor: "#ffffff",
    ...(Platform.OS === "ios"
      ? {
          shadowColor: "#0f172a",
          shadowOpacity: 0.08,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -6 },
        }
      : {
          elevation: 6,
        }),
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  tabButtonActive: {
    backgroundColor: "#f9fafb",
  },
  tabButtonPressed: {
    backgroundColor: "#f3f4f6",
  },
  tabLabel: {
    fontSize: 13,
    color: "#6b7280",
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: "#111827",
    fontWeight: "700",
  },
  tabIndicator: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 2,
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  tabIndicatorActive: {
    backgroundColor: "#111827",
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e5e7eb",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  sheetItem: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sheetItemText: {
    fontSize: 14,
    color: "#111827",
  },
  sheetItemInline: {
    flexDirection: "row",
    alignItems: "center",
  },
  sheetItemTextWithIcon: {
    marginLeft: 8,
  },
  sheetHelpButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  sheetHelpText: {
    fontSize: 12,
    color: "#2563eb",
    textDecorationLine: "underline",
  },
  sheetCloseButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 8,
  },
  sheetCloseText: {
    fontSize: 12,
    color: "#6b7280",
  },
  dateOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    padding: 24,
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
  errorText: {
    fontSize: 12,
    color: "#dc2626",
    marginBottom: 8,
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
  downloadNoticeOverlay: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.5)",
    padding: 24,
  },
  downloadNoticeBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  downloadNoticePanel: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  downloadNoticeTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0f172a",
    marginBottom: 10,
  },
  downloadNoticeBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#334155",
    marginBottom: 16,
  },
  downloadNoticeLink: {
    color: "#2563eb",
    textDecorationLine: "underline",
  },
  downloadNoticeButton: {
    alignSelf: "flex-end",
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  downloadNoticeButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  languagePickerActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  languagePickerButton: {
    marginLeft: 8,
  },
});

export default appChromeStyles;
