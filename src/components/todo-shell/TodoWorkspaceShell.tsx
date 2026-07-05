import React from "react";

import { useAppSettings } from "../../context/AppSettingsContext";
import { useAppUI } from "../../context/AppUIContext";
import { TodoWorkspaceProvider } from "../../context/TodoWorkspaceContext";
import TodoWorkspaceScreen from "../../screens/TodoWorkspaceScreen";

type ViewConfig = {
  insetsTop: number;
};

type Props = {
  active: boolean;
  viewConfig: ViewConfig;
  children: (todoWorkspace: React.ReactNode) => React.ReactNode;
};

const TodoWorkspaceShell = ({
  active,
  viewConfig,
  children,
}: Props) => {
  const {
    appLanguage,
    storageReady,
    tagLibrary,
    tr,
    untitledLabel,
  } = useAppSettings();
  const { selectedDate, openMenu } = useAppUI();

  const todoWorkspace = active ? (
    <TodoWorkspaceScreen
      visible
      insetsTop={viewConfig.insetsTop}
      tr={tr}
      onOpenMenu={openMenu}
    />
  ) : null;

  return (
    <TodoWorkspaceProvider
      active={active}
      selectedDate={selectedDate}
      storageReady={storageReady}
      tagLibrary={tagLibrary}
      language={appLanguage}
      tr={tr}
      untitledLabel={untitledLabel}
    >
      {children(todoWorkspace)}
    </TodoWorkspaceProvider>
  );
};

export default TodoWorkspaceShell;
