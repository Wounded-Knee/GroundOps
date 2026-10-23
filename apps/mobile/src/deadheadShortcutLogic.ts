import type { AddressBookEntry, PlaceSuggestion } from "@groundops/contracts";
import { entryTitle } from "./addressBookMatch";

/** Shown under the place name on iOS. Android shows the title alone. */
export const repositionSubtitle = "Reposition";

/** Apple's quick-action menu holds four items. Used when the phone does not report a limit. */
export const defaultShortcutCap = 4;

export const iosShortcutIcon = "location";

/** Name of the adaptive icon registered by the expo-quick-actions config plugin. */
export const androidShortcutIcon = "shortcut_reposition";

export type DeadheadShortcut = {
  entryId: string;
  /** Empty publishes the current entry title, so a later rename of the place follows. */
  title: string;
};

export type DeadheadShortcutItem = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  params: { entryId: string };
};

export type ShortcutNavKind = "browse" | "preview" | "search" | "sortie";

export type DeadheadCommand =
  | { kind: "start"; destination: PlaceSuggestion }
  | { kind: "missing" }
  | { kind: "unavailable" };

export function shortcutCap(maxCount: number | null | undefined): number {
  if (typeof maxCount !== "number" || !Number.isFinite(maxCount) || maxCount < 1) {
    return defaultShortcutCap;
  }
  return Math.floor(maxCount);
}

/** A blank field, or the current place title left as-is, stays the default. */
export function storedShortcutTitle(typed: string, placeTitle: string): string {
  const trimmed = typed.trim();
  if (trimmed.length === 0 || trimmed === placeTitle.trim()) {
    return "";
  }
  return trimmed;
}

export function publishedShortcutTitle(shortcut: DeadheadShortcut, entry: AddressBookEntry): string {
  const custom = shortcut.title.trim();
  return custom.length > 0 ? custom : entryTitle(entry);
}

export function retainShortcuts(shortcuts: DeadheadShortcut[], entries: AddressBookEntry[]): DeadheadShortcut[] {
  const ids = new Set(entries.map((entry) => entry.id));
  return shortcuts.filter((shortcut) => ids.has(shortcut.entryId));
}

export function addDeadheadShortcut(
  shortcuts: DeadheadShortcut[],
  entryId: string,
  title: string,
  cap: number,
): { shortcuts: DeadheadShortcut[]; added: boolean } {
  const index = shortcuts.findIndex((shortcut) => shortcut.entryId === entryId);
  if (index >= 0) {
    const next = shortcuts.slice();
    next[index] = { entryId, title };
    return { shortcuts: next, added: true };
  }
  if (shortcuts.length >= cap) {
    return { shortcuts, added: false };
  }
  return { shortcuts: [...shortcuts, { entryId, title }], added: true };
}

export function removeDeadheadShortcut(shortcuts: DeadheadShortcut[], entryId: string): DeadheadShortcut[] {
  return shortcuts.filter((shortcut) => shortcut.entryId !== entryId);
}

export function buildShortcutItems(
  shortcuts: DeadheadShortcut[],
  entries: AddressBookEntry[],
  cap: number,
  icon: string,
): DeadheadShortcutItem[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const items: DeadheadShortcutItem[] = [];
  for (const shortcut of shortcuts) {
    if (items.length >= cap) {
      break;
    }
    const entry = byId.get(shortcut.entryId);
    if (!entry) {
      continue;
    }
    const title = publishedShortcutTitle(shortcut, entry).trim();
    if (title.length === 0) {
      continue;
    }
    items.push({
      id: shortcut.entryId,
      title,
      subtitle: repositionSubtitle,
      icon,
      params: { entryId: shortcut.entryId },
    });
  }
  return items;
}

export function parseDeadheadShortcuts(raw: string | null): DeadheadShortcut[] | null {
  if (raw === null || raw.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  const shortcuts: DeadheadShortcut[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as { entryId?: unknown; title?: unknown };
    if (typeof record.entryId !== "string" || record.entryId.length === 0 || typeof record.title !== "string") {
      continue;
    }
    shortcuts.push({ entryId: record.entryId, title: record.title.trim() });
  }
  return shortcuts;
}

export function serializeDeadheadShortcuts(shortcuts: DeadheadShortcut[]): string {
  return JSON.stringify(shortcuts.map((shortcut) => ({ entryId: shortcut.entryId, title: shortcut.title })));
}

export function shortcutNavKind(
  mode: "browse" | "preview" | "guiding" | "arrived",
  guidance: "search" | "sortie" | null,
): ShortcutNavKind {
  if (mode === "guiding" || mode === "arrived") {
    return guidance === "sortie" ? "sortie" : "search";
  }
  return mode;
}

/** A shortcut may replace browse, preview, and search guidance. An open sortie stays. */
export function shortcutMayStart(kind: ShortcutNavKind): boolean {
  return kind !== "sortie";
}

export type DeadheadLink = { kind: "start"; entryId: string } | { kind: "configure"; widgetId: number };

/** A home-screen widget tap. Other Groundops links are left alone. */
export function deadheadLink(url: string | null): DeadheadLink | null {
  if (url === null || url.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "groundops:") {
    return null;
  }
  if (parsed.hostname === "deadhead") {
    const entryId = parsed.searchParams.get("entryId");
    if (entryId === null || entryId.length === 0) {
      return null;
    }
    return { kind: "start", entryId };
  }
  if (parsed.hostname === "deadhead-widget") {
    const raw = parsed.searchParams.get("widgetId");
    if (raw === null || !/^\d+$/.test(raw)) {
      return null;
    }
    return { kind: "configure", widgetId: Number(raw) };
  }
  return null;
}
