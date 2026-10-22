/** A postal address read from the device. Nothing here is stored on the server. */
export type DevicePostalAddress = {
  contactId: string;
  addressId: string;
  name: string;
  postal: string;
  /** Set when this contact has more than one street address. */
  addressLabel: string | null;
};

export function formatPostalAddress(address: {
  street?: string;
  city?: string;
  state?: string;
  region?: string;
  postcode?: string;
  country?: string;
}): string {
  const region = firstText(address.region, address.state);
  return [address.street, address.city, region, address.postcode, address.country]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(", ");
}

export function contactDisplayName(contact: {
  fullName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
}): string {
  const full = contact.fullName?.trim() ?? "";
  if (full.length > 0) {
    return full;
  }
  const joined = [contact.givenName, contact.familyName]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(" ");
  return joined.length > 0 ? joined : "Unnamed";
}

export function phoneAddressSubtitle(address: { postal: string; addressLabel: string | null }): string {
  return address.addressLabel ? `${address.addressLabel} · ${address.postal}` : address.postal;
}

function firstText(...parts: Array<string | undefined>): string {
  for (const part of parts) {
    const trimmed = part?.trim() ?? "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}
