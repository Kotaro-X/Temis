import { isTestEnvironment } from "../../services/environment/runtimeEnvironment";
import React from "react";
import { Modal, Text, View, type ModalProps } from "react-native";
import KeyboardDismissBoundary from "./KeyboardDismissBoundary";

export default function KeyboardAwareModal({ children, ...props }: ModalProps) {
  return <Modal {...props}><KeyboardDismissBoundary><View style={{ flex: 1 }}>{isTestEnvironment() && <Text style={{ backgroundColor: "#714000", color: "white", textAlign: "center", padding: 8 }}>テスト環境</Text>}{children}</View></KeyboardDismissBoundary></Modal>;
}
