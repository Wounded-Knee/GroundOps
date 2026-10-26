import type { AddressBookEntry, GeoCoordinate, PlaceSuggestion } from "@groundops/contracts";

/** Saved places and phone addresses shown ahead of remote suggestions. */
export const localSuggestionLimit = 5;

const coordinateEpsilon = 0.0001;

export type PhoneMatchSource = {
  contactId: string;
  addressId: string;
  name: string;
  postal: string;
  addressLabel: string | null;
  starred: boolean;
};

export type LocalSuggestion =
  | { source: "entry"; suggestion: PlaceSuggestion }
  | {
      source: "phone";
      contactId: string;
      addressId: string;
      name: string;
      postal: string;
      addressLabel: string | null;
    };

/** Nickname, otherwise the place name, otherwise the address. */
export function entryTitle(entry: AddressBookEntry): string {
  return entry.nickname.trim() || entry.placeName.trim() || entry.label.trim();
}

/** The address, with the place name ahead of it when a nickname is also set. */
export function entrySubtitle(entry: AddressBookEntry): string {
  const nickname = entry.nickname.trim();
  const placeName = entry.placeName.trim();
  if (nickname.length > 0 && placeName.length > 0) {
    return `${placeName}, ${entry.label}`;
  }
  return entry.label;
}

export function sortAddressEntries(entries: AddressBookEntry[]): AddressBookEntry[] {
  return [...entries].sort(
    (left, right) =>
      Number(right.favorite) - Number(left.favorite) ||
      entryTitle(left).localeCompare(entryTitle(right)) ||
      left.id.localeCompare(right.id),
  );
}

export function entrySuggestion(entry: AddressBookEntry): PlaceSuggestion {
  const title = entryTitle(entry);
  const subtitle = entrySubtitle(entry);
  return {
    name: title,
    label: entry.label,
    detail: subtitle === title ? "" : subtitle,
    latitude: entry.latitude,
    longitude: entry.longitude,
  };
}

/** The title the driver just picked, kept as the destination label from here on. */
export function destinationFromEntry(entry: AddressBookEntry): PlaceSuggestion {
  return { ...entrySuggestion(entry), label: entryTitle(entry) };
}

export function samePlace(left: GeoCoordinate, right: GeoCoordinate): boolean {
  return (
    Math.abs(left.latitude - right.latitude) < coordinateEpsilon &&
    Math.abs(left.longitude - right.longitude) < coordinateEpsilon
  );
}

/** Favorites, then other saved places, then starred phone addresses, then the rest. */
export function matchLocalAddresses(
  query: string,
  entries: AddressBookEntry[],
  phones: PhoneMatchSource[],
): LocalSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }
  const saved = sortAddressEntries(entries.filter((entry) => entryMatches(entry, needle)))
    .slice(0, localSuggestionLimit)
    .map((entry): LocalSuggestion => ({ source: "entry", suggestion: entrySuggestion(entry) }));
  const device = [...phones]
    .filter((phone) => phoneMatches(phone, needle))
    .sort(
      (left, right) =>
        Number(right.starred) - Number(left.starred) ||
        left.name.localeCompare(right.name) ||
        left.addressId.localeCompare(right.addressId),
    )
    .slice(0, localSuggestionLimit)
    .map(
      (phone): LocalSuggestion => ({
        source: "phone",
        contactId: phone.contactId,
        addressId: phone.addressId,
        name: phone.name,
        postal: phone.postal,
        addressLabel: phone.addressLabel,
      }),
    );
  return [...saved, ...device];
}

/** Drops a remote place that sits on a saved entry. The saved nickname stays. */
export function withoutDuplicatePlaces(remote: PlaceSuggestion[], local: LocalSuggestion[]): PlaceSuggestion[] {
  const saved = local.flatMap((hit) => (hit.source === "entry" ? [hit.suggestion] : []));
  return remote.filter((place) => !saved.some((entry) => samePlace(entry, place)));
}

function entryMatches(entry: AddressBookEntry, needle: string): boolean {
  return (
    entry.nickname.toLowerCase().includes(needle) ||
    entry.placeName.toLowerCase().includes(needle) ||
    entry.label.toLowerCase().includes(needle)
  );
}

function phoneMatches(phone: PhoneMatchSource, needle: string): boolean {
  return (
    phone.name.toLowerCase().includes(needle) ||
    phone.postal.toLowerCase().includes(needle) ||
    (phone.addressLabel?.toLowerCase().includes(needle) ?? false)
  );
}
