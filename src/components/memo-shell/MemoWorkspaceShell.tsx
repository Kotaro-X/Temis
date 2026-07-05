import React, { useMemo } from "react";
import { Modal } from "react-native";

import { useAppRefresh } from "../../context/AppRefreshContext";
import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import MemoDetailScreen from "../../screens/MemoDetailScreen";
import MemoScreen, { type MemoNavigation } from "../../screens/MemoScreen";
import ResearchScreen from "../../screens/ResearchScreen";
import MemoSearchModal from "../MemoSearchModal";

type Props = {
  active: boolean;
  children: (memoWorkspace: React.ReactNode) => React.ReactNode;
};

const MemoWorkspaceShell = ({
  active,
  children,
}: Props) => {
  const { appLanguage } = useAppSettings();
  const { refreshVersions, touchDomains } = useAppRefresh();
  const {
    openMenu,
    openTasks,
    openMemoHome,
    memoScreen,
    memoDetailId,
    memoSearchOpen,
    memoSearchQuery,
    openMemoDetail,
    closeMemoDetail,
    closeMemoSearch,
  } = useAppUI();

  const handleCloseMemoDetail = () => {
    closeMemoDetail();
    touchDomains(["memos"]);
  };

  const memoNavigation = useMemo<MemoNavigation>(
    () => ({
      push: (_screen: "MemoDetail", params: { id: string }) => {
        openMemoDetail(params.id);
      },
    }),
    [openMemoDetail],
  );

  const memoWorkspace = active ? (
    memoScreen === "research" ? (
      <ResearchScreen
        onBack={openMemoHome}
        onOpenMenu={openMenu}
        language={appLanguage}
        refreshToken={refreshVersions.memos}
      />
    ) : (
      <MemoScreen
        onBack={openTasks}
        onOpenMenu={openMenu}
        navigation={memoNavigation}
        initialTab={memoScreen === "notes" ? "note" : undefined}
        refreshToken={refreshVersions.memos}
        language={appLanguage}
      />
    )
  ) : null;

  return (
    <>
      {children(memoWorkspace)}
      <MemoSearchModal
        visible={memoSearchOpen}
        onClose={closeMemoSearch}
        navigation={memoNavigation}
        initialQuery={memoSearchQuery}
        language={appLanguage}
      />
      <Modal
        visible={!!memoDetailId}
        animationType="slide"
        onRequestClose={handleCloseMemoDetail}
      >
        {memoDetailId ? (
          <MemoDetailScreen
            memoId={memoDetailId}
            onBack={handleCloseMemoDetail}
            language={appLanguage}
          />
        ) : null}
      </Modal>
    </>
  );
};

export default MemoWorkspaceShell;
