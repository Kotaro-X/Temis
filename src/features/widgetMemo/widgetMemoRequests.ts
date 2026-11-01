import { createWidgetMemoRequests } from "./widgetMemoCore";
import { modalOverlayLayers } from "../../services/modalOverlayLayers";

export const widgetMemoRequests = createWidgetMemoRequests(modalOverlayLayers.getSnapshot);
