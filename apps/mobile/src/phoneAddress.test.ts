import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactDisplayName, formatPostalAddress, phoneAddressSubtitle } from "./phoneAddress.js";

describe("phone address", () => {
  it("joins the street parts and skips blanks", () => {
    assert.equal(
      formatPostalAddress({
        street: " 123 Main St ",
        city: "Springfield",
        state: "IL",
        region: "",
        postcode: "62701",
        country: "USA",
      }),
      "123 Main St, Springfield, IL, 62701, USA",
    );
    assert.equal(formatPostalAddress({ street: "Hangar 4", region: "California", state: "CA" }), "Hangar 4, California");
  });

  it("uses the full name, then the given and family names", () => {
    assert.equal(contactDisplayName({ fullName: " Ada Lovelace ", givenName: "Ada" }), "Ada Lovelace");
    assert.equal(contactDisplayName({ givenName: "Ada", familyName: "Lovelace" }), "Ada Lovelace");
    assert.equal(contactDisplayName({}), "Unnamed");
  });

  it("shows the address label when a contact has more than one street", () => {
    assert.equal(phoneAddressSubtitle({ postal: "1 Oak St", addressLabel: "home" }), "home · 1 Oak St");
    assert.equal(phoneAddressSubtitle({ postal: "1 Oak St", addressLabel: null }), "1 Oak St");
  });
});
