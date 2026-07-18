"use client";

/**
 * Tiny pub/sub so GemmaPanel can toggle worksheet rows in the Dashboard
 * without a global state library. Toggles are UI-only (not persisted).
 */

export type ToggleEvent = { entryIds: string[]; active: boolean };

const TOPIC = "cashwise:toggle-entries";

export function emitToggle(ev: ToggleEvent) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOPIC, { detail: ev }));
}

export function onToggle(cb: (ev: ToggleEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<ToggleEvent>).detail);
  window.addEventListener(TOPIC, handler);
  return () => window.removeEventListener(TOPIC, handler);
}
