import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppResetProvider } from "./src/context/AppResetContext";
import MainNavigator from "./src/navigation/MainNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <AppResetProvider>
        <MainNavigator />
      </AppResetProvider>
    </SafeAreaProvider>
  );
}
