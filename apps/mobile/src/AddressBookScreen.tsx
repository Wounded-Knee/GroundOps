import type { AddressBookEntry, PlaceSuggestion } from "@groundops/contracts";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { entrySubtitle, entrySuggestion, entryTitle, sortAddressEntries } from "./addressBookMatch";
import {
  addDeadheadShortcut,
  publishedShortcutTitle,
  removeDeadheadShortcut,
  storedShortcutTitle,
} from "./deadheadShortcutLogic";
import {
  deadheadShortcutCap,
  ensureDeadheadShortcutsLoaded,
  getDeadheadShortcuts,
  saveDeadheadShortcuts,
  subscribeDeadheadShortcuts,
  syncPublishedShortcuts,
} from "./deadheadShortcutStore";
import { pinAndroidShortcut } from "./deadheadWidget";
import {
  ensureAddressBookLoaded,
  getAddressBookSnapshot,
  removeSavedEntry,
  requestDeviceAddresses,
  saveAddressRecord,
  setEntryCompanyShare,
  setEntryFavorite,
  setEntryPlatformShare,
  setPhoneStarred,
  subscribeAddressBook,
  type AddressBookSnapshot,
} from "./addressBookStore";
import { AddressPicker } from "./AddressPicker";
import { resolveApiUrl } from "./apiUrl";
import { geocodePostal } from "./phoneGeocode";
import { phoneAddressSubtitle, type DevicePostalAddress } from "./phoneAddress";
import type { PlaceGuideCommand } from "./placeGuide";
import { requestDrivingRoute } from "./routingClient";
import { useTheme } from "./ThemeProvider";
import type { ThemeColors } from "./theme";

const apiUrl = resolveApiUrl();
const couldNotLoad = "The address book could not be loaded.";
const notSaved = "The address was not saved.";
const locationRequired = "Location is required.";
const routeFailed = "The route failed.";
const notLocated = "That address could not be located.";
const contactsDenied = "Groundops cannot read addresses from your contacts.";
const shortcutFull = "The phone's shortcut list is full.";
const shortcutNotSaved = "The shortcut was not saved.";
const shortcutNotPinned = "The home screen did not add the icon.";

type PhoneRow = DevicePostalAddress & { starred: boolean };

type AddressDraft = {
  id: string | null;
  nickname: string;
  placeName: string;
  placeNameManual: boolean;
  query: string;
  chosen: PlaceSuggestion | null;
};

export function AddressBookScreen({
  token,
  userId,
  onUnauthorized,
  onGuide,
  onCreateSortie,
}: {
  token: string;
  userId: string;
  onUnauthorized: () => void;
  onGuide: (command: PlaceGuideCommand) => void;
  onCreateSortie: (place: PlaceSuggestion) => void;
}) {
  const { styles } = useAddressStyles();
  const book = useSyncExternalStore(subscribeAddressBook, getAddressBookSnapshot, getAddressBookSnapshot);
  const shortcuts = useSyncExternalStore(subscribeDeadheadShortcuts, getDeadheadShortcuts, getDeadheadShortcuts);
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const [draft, setDraft] = useState<AddressDraft | null>(null);
  const [shortcutDraft, setShortcutDraft] = useState<{ entryId: string; title: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPhones, setShowPhones] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShowPhones(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestDeviceAddresses();
    void (async () => {
      const loaded = await ensureAddressBookLoaded(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (loaded === "unauthorized") {
        onUnauthorizedRef.current();
        return;
      }
      if (loaded !== "ok") {
        setMessage(couldNotLoad);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (Platform.OS === "web") {
      return;
    }
    void ensureDeadheadShortcutsLoaded(userId);
  }, [userId]);

  const entries = sortAddressEntries(book.entries);
  const phones = starredPhones(book);

  function openAdd(): void {
    setMessage(null);
    setDraft({ id: null, nickname: "", placeName: "", placeNameManual: false, query: "", chosen: null });
  }

  function openEdit(entry: AddressBookEntry): void {
    setMessage(null);
    setDraft({
      id: entry.id,
      nickname: entry.nickname,
      placeName: entry.placeName,
      placeNameManual: entry.placeName.trim().length > 0,
      query: entry.label,
      chosen: {
        name: entry.placeName.trim() || entry.label,
        label: entry.label,
        detail: "",
        latitude: entry.latitude,
        longitude: entry.longitude,
      },
    });
  }

  function openShortcut(entry: AddressBookEntry): void {
    const existing = shortcuts.find((shortcut) => shortcut.entryId === entry.id);
    if (!existing && shortcuts.length >= deadheadShortcutCap()) {
      setMessage(shortcutFull);
      return;
    }
    setMessage(null);
    const title = existing ? publishedShortcutTitle(existing, entry) : entryTitle(entry);
    setShortcutDraft({ entryId: entry.id, title });
  }

  async function saveShortcut(): Promise<void> {
    if (!shortcutDraft || busy) {
      return;
    }
    const entry = entries.find((item) => item.id === shortcutDraft.entryId);
    if (!entry) {
      setShortcutDraft(null);
      return;
    }
    const title = storedShortcutTitle(shortcutDraft.title, entryTitle(entry));
    const result = addDeadheadShortcut(shortcuts, entry.id, title, deadheadShortcutCap());
    if (!result.added) {
      setMessage(shortcutFull);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveDeadheadShortcuts(userId, result.shortcuts);
      await syncPublishedShortcuts(book.entries);
      const visible = publishedShortcutTitle({ entryId: entry.id, title }, entry);
      if (Platform.OS === "android" && !pinAndroidShortcut(entry.id, visible, entry.id)) {
        setMessage(shortcutNotPinned);
      }
      setShortcutDraft(null);
    } catch {
      setMessage(shortcutNotSaved);
    } finally {
      setBusy(false);
    }
  }

  async function removeShortcut(entryId: string): Promise<void> {
    if (busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await saveDeadheadShortcuts(userId, removeDeadheadShortcut(shortcuts, entryId));
      await syncPublishedShortcuts(book.entries);
      setShortcutDraft(null);
    } catch {
      setMessage(shortcutNotSaved);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!draft?.chosen || busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const saved = await saveAddressRecord(apiUrl, token, {
      id: draft.id,
      nickname: draft.nickname,
      placeName: draft.placeName,
      place: draft.chosen,
    });
    setBusy(false);
    if (saved === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (typeof saved === "string") {
      setMessage(notSaved);
      return;
    }
    setDraft(null);
  }

  async function guideTo(place: PlaceSuggestion): Promise<void> {
    if (Platform.OS === "web" || busy) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      setBusy(false);
      setMessage(locationRequired);
      return;
    }
    let position: Location.LocationObject;
    try {
      position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    } catch {
      setBusy(false);
      setMessage(locationRequired);
      return;
    }
    const route = await requestDrivingRoute(
      apiUrl,
      token,
      { latitude: position.coords.latitude, longitude: position.coords.longitude },
      place,
    );
    setBusy(false);
    if (route === "unauthorized") {
      onUnauthorized();
      return;
    }
    if (route === "failed") {
      setMessage(routeFailed);
      return;
    }
    onGuide({ destination: place, route });
  }

  async function guidePhone(row: PhoneRow): Promise<void> {
    const place = await placeFromPhone(row);
    if (place === "failed") {
      setMessage(notLocated);
      return;
    }
    await guideTo(place);
  }

  async function sortiePhone(row: PhoneRow): Promise<void> {
    const place = await placeFromPhone(row);
    if (place === "failed") {
      setMessage(notLocated);
      return;
    }
    onCreateSortie(place);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Your addresses</Text>
      <Pressable accessibilityRole="button" onPress={openAdd} style={styles.primary}>
        <Text style={styles.primaryText}>Add address</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {entries.length === 0 ? <Text style={styles.empty}>No saved addresses yet.</Text> : null}
      {entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          busy={busy}
          canShareWithCompany={book.canShareWithCompany}
          canShareWithPlatform={book.canShareWithPlatform}
          onStar={() => {
            void setEntryFavorite(apiUrl, token, entry.id, !entry.favorite).then((result) => {
              if (result === "unauthorized") {
                onUnauthorized();
              } else if (typeof result === "string") {
                setMessage(notSaved);
              }
            });
          }}
          onShareCompany={() => {
            void setEntryCompanyShare(apiUrl, token, entry.id, !entry.companyShared).then((result) => {
              if (result === "unauthorized") {
                onUnauthorized();
              } else if (typeof result === "string") {
                setMessage(notSaved);
              }
            });
          }}
          onSharePlatform={() => {
            void setEntryPlatformShare(apiUrl, token, entry.id, !entry.platformShared).then((result) => {
              if (result === "unauthorized") {
                onUnauthorized();
              } else if (typeof result === "string") {
                setMessage(notSaved);
              }
            });
          }}
          onGuide={() => void guideTo(entrySuggestion(entry))}
          onShortcut={() => openShortcut(entry)}
          shortcutOn={shortcuts.some((shortcut) => shortcut.entryId === entry.id)}
          onEdit={() => openEdit(entry)}
          onSortie={() => onCreateSortie(entrySuggestion(entry))}
          onDelete={() => {
            void removeSavedEntry(apiUrl, token, entry.id).then((result) => {
              if (result === "unauthorized") {
                onUnauthorized();
              } else if (result !== "ok") {
                setMessage(notSaved);
              }
            });
          }}
        />
      ))}
      {book.phoneAccess === "unavailable" ? null : (
        <>
          <Text style={styles.heading}>From your phone</Text>
          {book.phoneAccess === "denied" ? (
            <View>
              <Text style={styles.empty}>{contactsDenied}</Text>
              <Pressable accessibilityRole="button" onPress={() => void requestDeviceAddresses()} style={styles.secondary}>
                <Text style={styles.secondaryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          {book.phoneAccess !== "denied" && (book.phoneAccess === "unknown" || !showPhones) ? (
            <Text style={styles.empty}>Loading addresses from your phone…</Text>
          ) : null}
          {showPhones && book.phoneAccess === "granted" && phones.length === 0 ? (
            <Text style={styles.empty}>No contacts with a street address.</Text>
          ) : null}
          {showPhones
            ? phones.map((row) => (
            <PhoneAddressRow
              key={`${row.contactId}:${row.addressId}`}
              row={row}
              onStar={() => {
                void setPhoneStarred(apiUrl, token, { contactId: row.contactId, addressId: row.addressId }, !row.starred).then(
                  (result) => {
                    if (result === "unauthorized") {
                      onUnauthorized();
                    } else if (result !== "ok") {
                      setMessage(notSaved);
                    }
                  },
                );
              }}
              onGuide={() => void guidePhone(row)}
              onSortie={() => void sortiePhone(row)}
            />
          ))
            : null}
        </>
      )}
    </ScrollView>
    {draft ? (
      <AddressForm
        draft={draft}
        busy={busy}
        token={token}
        message={message}
        onChange={setDraft}
        onCancel={() => setDraft(null)}
        onSave={() => void saveDraft()}
        onUnauthorized={onUnauthorized}
      />
    ) : null}
    {shortcutDraft ? (
      <ShortcutForm
        title={shortcutDraft.title}
        busy={busy}
        canRemove={shortcuts.some((shortcut) => shortcut.entryId === shortcutDraft.entryId)}
        onChange={(title) => setShortcutDraft({ ...shortcutDraft, title })}
        onCancel={() => setShortcutDraft(null)}
        onSave={() => void saveShortcut()}
        onRemove={() => void removeShortcut(shortcutDraft.entryId)}
      />
    ) : null}
    </View>
  );
}

function EntryRow({
  entry,
  busy,
  canShareWithCompany,
  canShareWithPlatform,
  onStar,
  onShareCompany,
  onSharePlatform,
  onGuide,
  onShortcut,
  shortcutOn,
  onEdit,
  onSortie,
  onDelete,
}: {
  entry: AddressBookEntry;
  busy: boolean;
  canShareWithCompany: boolean;
  canShareWithPlatform: boolean;
  onStar: () => void;
  onShareCompany: () => void;
  onSharePlatform: () => void;
  onGuide: () => void;
  onShortcut: () => void;
  shortcutOn: boolean;
  onEdit: () => void;
  onSortie: () => void;
  onDelete: () => void;
}) {
  const { styles } = useAddressStyles();
  const title = entryTitle(entry);
  const subtitle = entrySubtitle(entry);
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        {entry.owned ? <StarButton favorite={entry.favorite} onPress={onStar} /> : null}
        <View style={styles.rowText}>
          <Text style={styles.name}>{title}</Text>
          {subtitle === title ? null : <Text style={styles.address}>{subtitle}</Text>}
        </View>
      </View>
      <View style={styles.actions}>
        {Platform.OS === "web" ? null : (
          <TextButton label="Guide" disabled={busy} onPress={onGuide} />
        )}
        {Platform.OS === "web" ? null : (
          <TextButton
            label="Shortcut"
            disabled={busy}
            selected={shortcutOn}
            onPress={onShortcut}
          />
        )}
        {entry.owned && canShareWithCompany ? (
          <TextButton
            label="Share with company"
            disabled={busy}
            selected={entry.companyShared}
            onPress={onShareCompany}
          />
        ) : null}
        {entry.owned && canShareWithPlatform ? (
          <TextButton
            label="Share with platform"
            disabled={busy}
            selected={entry.platformShared}
            onPress={onSharePlatform}
          />
        ) : null}
        {entry.owned ? <TextButton label="Edit" disabled={busy} onPress={onEdit} /> : null}
        <TextButton label="Sortie" disabled={busy} onPress={onSortie} />
        {entry.owned ? <TextButton label="Delete" disabled={busy} onPress={onDelete} /> : null}
      </View>
    </View>
  );
}

function AddressForm({
  draft,
  busy,
  token,
  message,
  onChange,
  onCancel,
  onSave,
  onUnauthorized,
}: {
  draft: AddressDraft;
  busy: boolean;
  token: string;
  message: string | null;
  onChange: (draft: AddressDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  onUnauthorized: () => void;
}) {
  const { colors, styles } = useAddressStyles();
  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{draft.id ? "Edit address" : "Add address"}</Text>
        <AddressPicker
          label="Location/address"
          appearance="field"
          query={draft.query}
          token={token}
          onQueryChange={(next) => {
            onChange({
              ...draft,
              query: next,
              chosen: draft.chosen && draft.chosen.label === next ? draft.chosen : null,
            });
          }}
          onSelect={(suggestion) => {
            onChange({
              ...draft,
              query: suggestion.label,
              chosen: suggestion,
              placeName: draft.placeNameManual ? draft.placeName : suggestion.name,
            });
          }}
          onUnauthorized={onUnauthorized}
        />
        <Text style={styles.label}>Location nickname</Text>
        <TextInput
          value={draft.nickname}
          onChangeText={(nickname) => onChange({ ...draft, nickname })}
          placeholder="Hangar"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Text style={styles.label}>Location name</Text>
        <TextInput
          value={draft.placeName}
          onChangeText={(placeName) => onChange({ ...draft, placeName, placeNameManual: true })}
          placeholder="Denny's"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!draft.chosen || busy}
          onPress={onSave}
          style={[styles.primary, !draft.chosen || busy ? styles.disabled : null]}
        >
          <Text style={styles.primaryText}>Save</Text>
        </Pressable>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondary}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ShortcutForm({
  title,
  busy,
  canRemove,
  onChange,
  onCancel,
  onSave,
  onRemove,
}: {
  title: string;
  busy: boolean;
  canRemove: boolean;
  onChange: (title: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const { colors, styles } = useAddressStyles();
  return (
    <View style={styles.backdrop}>
      <ScrollView contentContainerStyle={styles.card} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Shortcut</Text>
        <Text style={styles.label}>
          Choose the name once. The home screen icon uses the app icon, with this name under it, and opens dead-head
          navigation to this place.
        </Text>
        <Text style={styles.label}>Name on the home screen</Text>
        <TextInput
          value={title}
          onChangeText={onChange}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onSave}
          style={[styles.primary, busy ? styles.disabled : null]}
        >
          <Text style={styles.primaryText}>{canRemove ? "Save" : "Add to home screen"}</Text>
        </Pressable>
        {canRemove ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={onRemove} style={styles.secondary}>
            <Text style={styles.secondaryText}>Remove shortcut</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondary}>
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function PhoneAddressRow({
  row,
  onStar,
  onGuide,
  onSortie,
}: {
  row: PhoneRow;
  onStar: () => void;
  onGuide: () => void;
  onSortie: () => void;
}) {
  const { styles } = useAddressStyles();
  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <StarButton favorite={row.starred} onPress={onStar} />
        <View style={styles.rowText}>
          <Text style={styles.name}>{row.name}</Text>
          <Text style={styles.address}>{phoneAddressSubtitle(row)}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        {Platform.OS === "web" ? null : <TextButton label="Guide" onPress={onGuide} />}
        <TextButton label="Sortie" onPress={onSortie} />
      </View>
    </View>
  );
}

function StarButton({ favorite, onPress }: { favorite: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={favorite ? "Remove favorite" : "Favorite"}
      onPress={onPress}
      style={starStyles.hit}
    >
      <Ionicons name={favorite ? "star" : "star-outline"} size={22} color={colors.text} />
    </Pressable>
  );
}

function TextButton({
  label,
  disabled = false,
  selected = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const { styles } = useAddressStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.actionText, selected ? styles.actionSelected : null, disabled ? styles.actionDisabled : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

async function placeFromPhone(row: PhoneRow): Promise<PlaceSuggestion | "failed"> {
  const coordinate = await geocodePostal(row.contactId, row.addressId, row.postal);
  if (coordinate === "failed") {
    return "failed";
  }
  return {
    name: row.name,
    label: row.postal,
    detail: phoneAddressSubtitle(row),
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
  };
}

function starredPhones(book: AddressBookSnapshot): PhoneRow[] {
  const stars = new Set(book.phoneStars.map((star) => `${star.contactId}\n${star.addressId}`));
  return book.phones
    .map((phone) => ({ ...phone, starred: stars.has(`${phone.contactId}\n${phone.addressId}`) }))
    .sort(
      (left, right) =>
        Number(right.starred) - Number(left.starred) ||
        left.name.localeCompare(right.name) ||
        left.addressId.localeCompare(right.addressId),
    );
}

let cachedAddressStyles: { colors: ThemeColors; styles: ReturnType<typeof createStyles> } | null = null;

function useAddressStyles() {
  const { colors } = useTheme();
  if (cachedAddressStyles?.colors !== colors) {
    cachedAddressStyles = { colors, styles: createStyles(colors) };
  }
  return { colors, styles: cachedAddressStyles.styles };
}

const starStyles = StyleSheet.create({
  hit: {
    paddingVertical: 4,
    paddingRight: 8,
  },
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    content: {
      padding: 16,
      gap: 8,
      paddingBottom: 32,
    },
    backdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: colors.overlay,
      padding: 16,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 8,
    },
    title: {
      color: colors.text,
      fontSize: 20,
    },
    heading: {
      color: colors.text,
      fontSize: 20,
      marginTop: 8,
    },
    label: {
      color: colors.text,
      fontSize: 14,
    },
    input: {
      color: colors.text,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 8,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    primary: {
      backgroundColor: colors.primary,
      borderRadius: 8,
      paddingVertical: 14,
      alignItems: "center",
    },
    disabled: {
      opacity: 0.5,
    },
    primaryText: {
      color: colors.primaryText,
      fontSize: 16,
    },
    secondary: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: 8,
      paddingVertical: 10,
      alignItems: "center",
      marginTop: 8,
    },
    secondaryText: {
      color: colors.text,
      fontSize: 16,
    },
    message: {
      color: colors.text,
      fontSize: 16,
    },
    empty: {
      color: colors.textMuted,
      fontSize: 16,
    },
    row: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingVertical: 10,
      gap: 8,
    },
    rowHead: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    rowText: {
      flex: 1,
    },
    name: {
      color: colors.text,
      fontSize: 16,
    },
    address: {
      color: colors.textMuted,
      fontSize: 14,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 16,
      paddingLeft: 30,
    },
    actionText: {
      color: colors.text,
      fontSize: 16,
    },
    actionSelected: {
      color: colors.accent,
    },
    actionDisabled: {
      color: colors.textMuted,
    },
  });
}
