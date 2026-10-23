import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressBookEntry } from "@groundops/contracts";
import {
  addDeadheadShortcut,
  buildShortcutItems,
  deadheadLink,
  defaultShortcutCap,
  parseDeadheadShortcuts,
  publishedShortcutTitle,
  removeDeadheadShortcut,
  repositionSubtitle,
  retainShortcuts,
  serializeDeadheadShortcuts,
  shortcutCap,
  shortcutMayStart,
  shortcutNavKind,
  storedShortcutTitle,
  type DeadheadShortcut,
} from "./deadheadShortcutLogic.js";

function entry(id: string, nickname: string, placeName = ""): AddressBookEntry {
  return {
    id,
    nickname,
    placeName,
    label: `${nickname || placeName} street`,
    latitude: 1,
    longitude: 2,
    favorite: false,
  };
}

describe("dead-head shortcuts", () => {
  it("uses the phone limit, otherwise four", () => {
    assert.equal(shortcutCap(null), defaultShortcutCap);
    assert.equal(shortcutCap(undefined), 4);
    assert.equal(shortcutCap(0), 4);
    assert.equal(shortcutCap(15.9), 15);
  });

  it("keeps a typed title and treats the place title as the default", () => {
    assert.equal(storedShortcutTitle("  HQ  ", "Hangar"), "HQ");
    assert.equal(storedShortcutTitle("   ", "Hangar"), "");
    assert.equal(storedShortcutTitle("Hangar", "Hangar"), "");
  });

  it("publishes a custom title, otherwise the current place title", () => {
    const place = entry("a", "Hangar");
    assert.equal(publishedShortcutTitle({ entryId: "a", title: "HQ" }, place), "HQ");
    assert.equal(publishedShortcutTitle({ entryId: "a", title: "" }, place), "Hangar");
    assert.equal(publishedShortcutTitle({ entryId: "a", title: "  " }, place), "Hangar");
  });

  it("keeps shortcut order, drops a missing place, and stops at the cap", () => {
    const shortcuts: DeadheadShortcut[] = [
      { entryId: "a", title: "HQ" },
      { entryId: "gone", title: "" },
      { entryId: "b", title: "" },
      { entryId: "c", title: "Yard" },
    ];
    const entries = [entry("c", "C"), entry("b", "Bee", "Denny"), entry("a", "Hangar")];
    const kept = retainShortcuts(shortcuts, entries);
    assert.deepEqual(
      kept.map((shortcut) => shortcut.entryId),
      ["a", "b", "c"],
    );
    const items = buildShortcutItems(kept, entries, 2, "location");
    assert.deepEqual(
      items.map((item) => item.title),
      ["HQ", "Bee"],
    );
    assert.equal(items[0]?.subtitle, repositionSubtitle);
    assert.deepEqual(items[1]?.params, { entryId: "b" });
    assert.equal(items[1]?.icon, "location");
  });

  it("refuses a new shortcut when the list is full and still edits an existing title", () => {
    const shortcuts: DeadheadShortcut[] = [
      { entryId: "a", title: "" },
      { entryId: "b", title: "" },
    ];
    const refused = addDeadheadShortcut(shortcuts, "c", "Yard", 2);
    assert.equal(refused.added, false);
    assert.equal(refused.shortcuts, shortcuts);
    const edited = addDeadheadShortcut(shortcuts, "b", "Base", 2);
    assert.equal(edited.added, true);
    assert.deepEqual(edited.shortcuts, [
      { entryId: "a", title: "" },
      { entryId: "b", title: "Base" },
    ]);
    assert.deepEqual(removeDeadheadShortcut(edited.shortcuts, "a"), [{ entryId: "b", title: "Base" }]);
  });

  it("parses stored shortcuts and drops a malformed row", () => {
    const raw = JSON.stringify([
      { entryId: "a", title: " HQ " },
      { entryId: "", title: "nope" },
      { title: "missing" },
      { entryId: "b", title: "" },
    ]);
    assert.deepEqual(parseDeadheadShortcuts(raw), [
      { entryId: "a", title: "HQ" },
      { entryId: "b", title: "" },
    ]);
    assert.equal(parseDeadheadShortcuts(null), null);
    assert.equal(parseDeadheadShortcuts(""), null);
    assert.equal(parseDeadheadShortcuts("{"), null);
    assert.deepEqual(parseDeadheadShortcuts("[]"), []);
    const stored = parseDeadheadShortcuts(raw);
    assert.equal(serializeDeadheadShortcuts(stored ?? []), JSON.stringify([
      { entryId: "a", title: "HQ" },
      { entryId: "b", title: "" },
    ]));
  });

  it("reads a widget tap and ignores other links", () => {
    assert.deepEqual(deadheadLink("groundops://deadhead?entryId=abc"), { kind: "start", entryId: "abc" });
    assert.deepEqual(deadheadLink("groundops://deadhead-widget?widgetId=12"), { kind: "configure", widgetId: 12 });
    assert.equal(deadheadLink("groundops://deadhead"), null);
    assert.equal(deadheadLink("groundops://deadhead-widget?widgetId=nope"), null);
    assert.equal(deadheadLink("https://example.com/deadhead?entryId=abc"), null);
    assert.equal(deadheadLink(null), null);
  });

  it("blocks an open sortie and allows browse, preview, and search guidance", () => {
    assert.equal(shortcutMayStart(shortcutNavKind("browse", null)), true);
    assert.equal(shortcutMayStart(shortcutNavKind("preview", null)), true);
    assert.equal(shortcutMayStart(shortcutNavKind("guiding", "search")), true);
    assert.equal(shortcutMayStart(shortcutNavKind("arrived", "search")), true);
    assert.equal(shortcutMayStart(shortcutNavKind("guiding", "sortie")), false);
    assert.equal(shortcutMayStart(shortcutNavKind("arrived", "sortie")), false);
  });
});
