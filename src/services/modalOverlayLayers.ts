const layers = new Set<string>();
export const modalOverlayLayers = {
  getSnapshot: () => [...layers].at(-1) ?? "root",
  register: (id: string) => {
    layers.add(id);
    return () => { layers.delete(id); };
  },
};
