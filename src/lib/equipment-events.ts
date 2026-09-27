const listeners = new Set<() => void>();
export function subscribeEquipment(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifyEquipment(): void {
  for (const listener of listeners) listener();
}
