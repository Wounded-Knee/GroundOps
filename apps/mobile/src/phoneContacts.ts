import { Contact, ContactField, getPermissionsAsync, requestPermissionsAsync } from "expo-contacts";
import { Platform } from "react-native";
import { contactDisplayName, formatPostalAddress, type DevicePostalAddress } from "./phoneAddress";

const fields = [ContactField.FULL_NAME, ContactField.GIVEN_NAME, ContactField.FAMILY_NAME, ContactField.ADDRESSES] as const;

export async function phoneContactsAccess(): Promise<"granted" | "denied" | "unavailable"> {
  if (Platform.OS === "web") {
    return "unavailable";
  }
  try {
    const current = await getPermissionsAsync();
    return current.granted ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function requestPhoneContactsAccess(): Promise<"granted" | "denied" | "unavailable"> {
  if (Platform.OS === "web") {
    return "unavailable";
  }
  try {
    const current = await getPermissionsAsync();
    if (current.granted) {
      return "granted";
    }
    const next = await requestPermissionsAsync();
    return next.granted ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function readPostalAddresses(): Promise<DevicePostalAddress[]> {
  if (Platform.OS === "web") {
    return [];
  }
  const details = await Contact.getAllDetails(fields);
  const rows: DevicePostalAddress[] = [];
  for (const contact of details) {
    const contactId = contact.id.trim();
    if (contactId.length === 0) {
      continue;
    }
    const addresses = contact.addresses ?? [];
    const kept = addresses.flatMap((address) => {
      const postal = formatPostalAddress(address);
      if (postal.length === 0 || address.id.trim().length === 0) {
        return [];
      }
      return [{ id: address.id, postal, label: address.label?.trim() ?? "" }];
    });
    if (kept.length === 0) {
      continue;
    }
    const name = contactDisplayName(contact);
    const multiple = kept.length > 1;
    for (const address of kept) {
      rows.push({
        contactId,
        addressId: address.id,
        name,
        postal: address.postal,
        addressLabel: multiple && address.label.length > 0 ? address.label : null,
      });
    }
  }
  return rows;
}
