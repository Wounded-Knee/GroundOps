import type { AddressBookEntry } from "@groundops/contracts";
import { requireNativeModule } from "expo";
import { Platform } from "react-native";
import { entryTitle } from "./addressBookMatch";

type WidgetBinding = {
  widgetId: number;
  entryId: string;
  title: string;
};

type DeadheadWidgetNative = {
  places(): WidgetBinding[];
  setPlace(widgetId: number, title: string, entryId: string, displayTitle: string): boolean;
  clear(widgetId: number): boolean;
  setShortcuts(raw: string): boolean;
  pin(id: string, title: string, entryId: string): boolean;
};

let native: DeadheadWidgetNative | null | undefined;

function module(): DeadheadWidgetNative | null {
  if (Platform.OS !== "android") {
    return null;
  }
  if (native !== undefined) {
    return native;
  }
  try {
    native = requireNativeModule<DeadheadWidgetNative>("DeadheadWidget");
  } catch {
    native = null;
  }
  return native;
}

/** Replaces the long-press shortcuts with this list. An empty list removes them. */
export function publishAndroidShortcuts(items: { id: string; title: string; entryId: string }[]): boolean {
  return module()?.setShortcuts(JSON.stringify(items)) ?? false;
}

/** Asks the launcher to place an icon, the same size as the app icon, with this label. */
export function pinAndroidShortcut(id: string, title: string, entryId: string): boolean {
  return module()?.pin(id, title, entryId) ?? false;
}

export function setDeadheadWidgetPlace(
  widgetId: number,
  title: string,
  entryId: string,
  displayTitle: string,
): boolean {
  return module()?.setPlace(widgetId, title, entryId, displayTitle) ?? false;
}

/** Keeps each home-screen icon's label in step with the saved place. A deleted place asks to be chosen again. */
export function syncDeadheadWidgets(entries: AddressBookEntry[]): void {
  const widget = module();
  if (!widget) {
    return;
  }
  try {
    for (const place of widget.places()) {
      const entry = entries.find((item) => item.id === place.entryId);
      if (!entry) {
        widget.clear(place.widgetId);
        continue;
      }
      const displayTitle = place.title.trim() || entryTitle(entry);
      widget.setPlace(place.widgetId, place.title, place.entryId, displayTitle);
    }
  } catch {
    // The installed build may not include the widget module yet.
  }
}
