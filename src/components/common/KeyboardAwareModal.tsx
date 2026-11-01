import { isTestEnvironment } from "../../services/environment/runtimeEnvironment";
import React, { useContext, useEffect, useId } from "react";
import { Modal, Text, View, type ModalProps } from "react-native";
import KeyboardDismissBoundary from "./KeyboardDismissBoundary";
import { ModalOverlayContext, modalOverlayLayers } from "./ModalOverlayContext";

export default function KeyboardAwareModal({ children, suppressOverlay = false, ...props }: ModalProps & { suppressOverlay?: boolean }) {
  const renderOverlay = useContext(ModalOverlayContext);
  const id = useId();
  const visible = props.visible !== false;
  useEffect(() => {
    if (renderOverlay && visible && !suppressOverlay) return modalOverlayLayers.register(id);
  }, [renderOverlay, id, suppressOverlay, visible]);
  return <Modal {...props}><KeyboardDismissBoundary><View style={{ flex: 1 }}>{isTestEnvironment() && <Text style={{ backgroundColor: "#714000", color: "white", textAlign: "center", padding: 8 }}>テスト環境</Text>}{children}{renderOverlay && !suppressOverlay && visible ? renderOverlay(id) : null}</View></KeyboardDismissBoundary></Modal>;
}
