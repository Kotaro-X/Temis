import { createContext, type ReactNode } from "react";

/** Let a global entry point present from the currently visible native modal. */
export const ModalOverlayContext = createContext<((hostId: string) => ReactNode) | null>(null);
export { modalOverlayLayers } from "../../services/modalOverlayLayers";
