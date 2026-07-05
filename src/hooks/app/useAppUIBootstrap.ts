import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { loadDownloadCompleteNoticeShown } from "../../../storage";

type Args = {
  languagePickerOpen: boolean;
  downloadNoticePending: boolean;
  toDateString: (date: Date) => string;
  setSelectedDate: React.Dispatch<React.SetStateAction<string>>;
  setDateDraft: React.Dispatch<React.SetStateAction<string>>;
  setDateError: React.Dispatch<React.SetStateAction<string | null>>;
  setDownloadNoticePending: React.Dispatch<React.SetStateAction<boolean>>;
  setDownloadCompleteNoticeOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export const useAppUIBootstrap = ({
  languagePickerOpen,
  downloadNoticePending,
  toDateString,
  setSelectedDate,
  setDateDraft,
  setDateError,
  setDownloadNoticePending,
  setDownloadCompleteNoticeOpen,
}: Args) => {
  const lastActiveDateRef = useRef(toDateString(new Date()));

  useEffect(() => {
    const handleAppStateChange = (state: string) => {
      if (state !== "active") {
        return;
      }
      const today = toDateString(new Date());
      if (today !== lastActiveDateRef.current) {
        lastActiveDateRef.current = today;
        setSelectedDate(today);
        setDateDraft(today);
        setDateError(null);
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [setDateDraft, setDateError, setSelectedDate, toDateString]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const shown = await loadDownloadCompleteNoticeShown();
      if (active && !shown) {
        setDownloadNoticePending(true);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [setDownloadNoticePending]);

  useEffect(() => {
    if (!downloadNoticePending || languagePickerOpen) {
      return;
    }
    setDownloadCompleteNoticeOpen(true);
    setDownloadNoticePending(false);
  }, [
    downloadNoticePending,
    languagePickerOpen,
    setDownloadCompleteNoticeOpen,
    setDownloadNoticePending,
  ]);
};

