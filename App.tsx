import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppResetProvider } from "./src/context/AppResetContext";
import MainNavigator from "./src/navigation/MainNavigator";

import KeyboardDismissBoundary from "./src/components/common/KeyboardDismissBoundary";
import WidgetMemoLinkBridge from "./src/components/app-bridges/WidgetMemoLinkBridge";

export default function App() {
  return (
    <SafeAreaProvider>
      <WidgetMemoLinkBridge />
      <AppResetProvider>
        <KeyboardDismissBoundary><MainNavigator /></KeyboardDismissBoundary>
      </AppResetProvider>
    </SafeAreaProvider>
  );
}
