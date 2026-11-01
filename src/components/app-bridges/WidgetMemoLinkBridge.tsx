import { useEffect } from "react";
import { Linking } from "react-native";
import { widgetMemoRequests } from "../../features/widgetMemo/widgetMemoRequests";

let initialURLHandled = false;

/** Lives above account/environment gates so URLs survive a delayed app startup. */
export default function WidgetMemoLinkBridge() {
  useEffect(() => {
    let alive = true;
    let receivedEvent = false;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      receivedEvent = true;
      widgetMemoRequests.receive(url);
    });
    if (!initialURLHandled) {
      void Linking.getInitialURL().then(url => {
        if (!alive || initialURLHandled) return;
        initialURLHandled = true;
        if (!receivedEvent) widgetMemoRequests.receive(url);
      }).catch(() => { /* A later URL event can still open the editor. */ });
    }
    return () => { alive = false; subscription.remove(); };
  }, []);
  return null;
}
