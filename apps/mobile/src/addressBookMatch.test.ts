import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressBookEntry } from "@groundops/contracts";
import {
  destinationFromEntry,
  entrySuggestion,
  entrySubtitle,
  entryTitle,
  localSuggestionLimit,
  matchLocalAddresses,
  samePlace,
  sortAddressEntries,
  withoutDuplicatePlaces,
  type PhoneMatchSource,
} from "./addressBookMatch.js";

function entry(id: string, nickname: string, favorite: boolean, placeName = ""): AddressBookEntry {
  return {
    id,
    nickname,
    placeName,
    label: `${nickname || placeName} street`,
    latitude: Number(id),
    longitude: 1,
    favorite,
    owned: false,
    companyShared: false,
    platformShared: false,
  };
}

function phone(name: string, starred: boolean, addressId = name): PhoneMatchSource {
  return {
    contactId: "c",
    addressId,
    name,
    postal: `${name} road`,
    addressLabel: null,
    starred,
  };
}

describe("address book matching", () => {
  it("sorts favorites ahead of other names", () => {
    assert.deepEqual(
      sortAddressEntries([entry("2", "Oak", false), entry("1", "Elm", true)]).map((item) => item.nickname),
      ["Elm", "Oak"],
    );
  });

  it("returns nothing until the driver types", () => {
    assert.deepEqual(matchLocalAddresses("  ", [entry("1", "Oak", true)], []), []);
  });

  it("puts saved favorites, then saved places, then starred phone addresses", () => {
    const hits = matchLocalAddresses("a", [entry("2", "Ada", false), entry("1", "Amy", true)], [
      phone("Ann", false),
      phone("Abe", true),
    ]);
    assert.deepEqual(
      hits.map((hit) => (hit.source === "entry" ? hit.suggestion.name : hit.name)),
      ["Amy", "Ada", "Abe", "Ann"],
    );
    assert.equal(hits[0]?.source, "entry");
    assert.equal(hits[2]?.source, "phone");
  });

  it("matches a nickname, a place name, or a street, ignoring case", () => {
    const hangar = { ...entry("1", "Hangar", false, "Denny's"), label: "3 Ramp Rd" };
    assert.equal(matchLocalAddresses("RAMP", [hangar], []).length, 1);
    assert.equal(matchLocalAddresses("hang", [hangar], []).length, 1);
    assert.equal(matchLocalAddresses("denny", [hangar], []).length, 1);
    assert.equal(matchLocalAddresses("dock", [hangar], []).length, 0);
    const titled = matchLocalAddresses("denny", [hangar], []);
    const hit = titled[0];
    assert.equal(hit?.source, "entry");
    if (hit?.source === "entry") {
      assert.equal(hit.suggestion.name, "Hangar");
      assert.equal(hit.suggestion.label, "3 Ramp Rd");
      assert.equal(hit.suggestion.detail, "Denny's, 3 Ramp Rd");
    }
  });

  it("keeps the picked title as the destination label", () => {
    const hangar = {
      ...entry("1", "Hangar", false, "Denny's"),
      label: "40.1, -75.2",
      latitude: 40.1,
      longitude: -75.2,
    };
    const place = destinationFromEntry(hangar);
    assert.equal(place.name, "Hangar");
    assert.equal(place.label, "Hangar");
    assert.equal(place.detail, "Denny's, 40.1, -75.2");
    assert.equal(place.latitude, 40.1);
    assert.equal(place.longitude, -75.2);
    assert.equal(entrySuggestion(hangar).label, "40.1, -75.2");

    const named = { ...entry("2", "", false, "Oak"), label: "2 Oak St" };
    assert.equal(destinationFromEntry(named).label, "Oak");
    const bare = { ...entry("3", "  ", false, "  "), label: "4 Bare St" };
    assert.equal(destinationFromEntry(bare).label, "4 Bare St");
  });

  it("titles a row with the nickname, then the place name, then the address", () => {
    const both = { ...entry("1", "Breakfast", false, "Denny's"), label: "9 Main St" };
    assert.equal(entryTitle(both), "Breakfast");
    assert.equal(entrySubtitle(both), "Denny's, 9 Main St");
    const named = { ...entry("2", "", false, "Oak"), label: "2 Oak St" };
    assert.equal(entryTitle(named), "Oak");
    assert.equal(entrySubtitle(named), "2 Oak St");
    const bare = { ...entry("3", "  ", false, "  "), label: "4 Bare St" };
    assert.equal(entryTitle(bare), "4 Bare St");
    assert.equal(entrySubtitle(bare), "4 Bare St");
    assert.deepEqual(
      sortAddressEntries([named, { ...entry("4", "Elm", false), label: "1 Elm St" }]).map(entryTitle),
      ["Elm", "Oak"],
    );
  });

  it("caps each source", () => {
    const entries = Array.from({ length: localSuggestionLimit + 2 }, (_, index) =>
      entry(String(index + 1), `Place ${index}`, false),
    );
    const phones = Array.from({ length: localSuggestionLimit + 2 }, (_, index) => phone(`Person ${index}`, false, String(index)));
    const hits = matchLocalAddresses("p", entries, phones);
    assert.equal(hits.filter((hit) => hit.source === "entry").length, localSuggestionLimit);
    assert.equal(hits.filter((hit) => hit.source === "phone").length, localSuggestionLimit);
  });

  it("drops a remote place that shares coordinates with a saved entry", () => {
    const saved = matchLocalAddresses("hangar", [entry("1", "Hangar", true)], []);
    const remote = [
      { name: "Hangar", label: "3 Ramp Rd", detail: "3 Ramp Rd", latitude: 1, longitude: 1.00005 },
      { name: "Other", label: "9 Dock", detail: "9 Dock", latitude: 8, longitude: 8 },
    ];
    assert.equal(samePlace({ latitude: 1, longitude: 1 }, remote[0]!), true);
    const kept = withoutDuplicatePlaces(remote, saved);
    assert.deepEqual(kept.map((place) => place.name), ["Other"]);
  });
});
