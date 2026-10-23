import type { AddressBookEntry } from "@groundops/contracts";
import * as QuickActions from "expo-quick-actions";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  androidShortcutIcon,
  buildShortcutItems,
  iosShortcutIcon,
  parseDeadheadShortcuts,
  retainShortcuts,
  serializeDeadheadShortcuts,
  shortcutCap,
  type DeadheadShortcut,
} from "./deadheadShortcutLogic";
import { publishAndroidShortcuts } from "./deadheadWidget";

export type { DeadheadShortcut } from "./deadheadShortcutLogic";

const listeners = new Set<() => void>();
let shortcuts: DeadheadShortcut[] = [];
let loadedFor: string | null = null;
let publishQueue: Promise<void> = Promise.resolve();

export function getDeadheadShortcuts(): DeadheadShortcut[] {
  return shortcuts;
}

export function subscribeDeadheadShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function deadheadShortcutCap(): number {
  if (Platform.OS === "web") {
    return 0;
  }
  return shortcutCap(QuickActions.maxCount);
}

export async function ensureDeadheadShortcutsLoaded(userId: string): Promise<DeadheadShortcut[]> {
  if (loadedFor === userId) {
    return shortcuts;
  }
  const raw = await readRaw(storageKey(userId));
  if (loadedFor === userId) {
    return shortcuts;
  }
  const parsed = parseDeadheadShortcuts(raw) ?? [];
  loadedFor = userId;
  shortcuts = parsed;
  notify();
  return shortcuts;
}

export async function saveDeadheadShortcuts(userId: string, next: DeadheadShortcut[]): Promise<void> {
  await writeRaw(storageKey(userId), serializeDeadheadShortcuts(next));
  loadedFor = userId;
  shortcuts = next;
  notify();
  return;
}

/** Drops shortcuts whose places are gone, then gives the list to the operating system. */
export function syncPublishedShortcuts(entries: AddressBookEntry[]): Promise<void> {
  const task = publishQueue.then(() => publishNow(entries));
  publishQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

/** Removes the icons from the operating system. The saved list for each driver stays on the device. */
export function clearPublishedShortcuts(): Promise<void> {
  const task = publishQueue.then(async () => {
    loadedFor = null;
    shortcuts = [];
    notify();
    if (Platform.OS === "web") {
      return;
    }
    if (Platform.OS === "android") {
      publishAndroidShortcuts([]);
      return;
    }
    try {
      await QuickActions.setItems([]);
    } catch {
      // The native module is absent until the dev client includes expo-quick-actions.
    }
  });
  publishQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function publishNow(entries: AddressBookEntry[]): Promise<void> {
  if (Platform.OS === "web" || !loadedFor) {
    return;
  }
  const userId = loadedFor;
  const kept = retainShortcuts(shortcuts, entries);
  if (kept.length !== shortcuts.length) {
    await writeRaw(storageKey(userId), serializeDeadheadShortcuts(kept));
    shortcuts = kept;
    notify();
  }
  const items = buildShortcutItems(
    shortcuts,
    entries,
    shortcutCap(QuickActions.maxCount),
    Platform.OS === "ios" ? iosShortcutIcon : androidShortcutIcon,
  );
  if (Platform.OS === "android") {
    const published = publishAndroidShortcuts(
      items.map((item) => ({ id: item.id, title: item.title, entryId: item.params.entryId })),
    );
    if (!published) {
      throw new Error("The shortcut was not published.");
    }
    return;
  }
  await QuickActions.setItems(items);
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function storageKey(userId: string): string {
  const safe = userId.replace(/[^A-Za-z0-9._-]/g, "_");
  return `groundops.deadheadShortcuts.${safe}`;
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return null;
  }
  return SecureStore.getItemAsync(key);
}

async function writeRaw(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
