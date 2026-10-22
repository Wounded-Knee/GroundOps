import type {
  AddressBookEntry,
  AddressBookEntryPatch,
  AddressBookEntryWrite,
  AddressBookResponse,
  PhoneAddressStar,
} from "@groundops/contracts";

export type AddressBookFailure = "unauthorized" | "invalid" | "missing" | "unreachable";

export async function readAddressBook(
  apiUrl: string,
  token: string,
): Promise<AddressBookResponse | AddressBookFailure> {
  try {
    const response = await fetch(`${apiUrl}/address-book`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return failureFromStatus(response.status);
    }
    const body: unknown = await response.json();
    return isAddressBook(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function createAddressBookEntry(
  apiUrl: string,
  token: string,
  body: AddressBookEntryWrite,
): Promise<AddressBookEntry | AddressBookFailure> {
  return writeEntry(apiUrl, token, "POST", "/address-book", body);
}

export async function patchAddressBookEntry(
  apiUrl: string,
  token: string,
  id: string,
  body: AddressBookEntryPatch,
): Promise<AddressBookEntry | AddressBookFailure> {
  return writeEntry(apiUrl, token, "PATCH", `/address-book/${id}`, body);
}

export async function deleteAddressBookEntry(
  apiUrl: string,
  token: string,
  id: string,
): Promise<"ok" | AddressBookFailure> {
  return remove(apiUrl, token, `/address-book/${id}`);
}

export async function starPhoneAddress(
  apiUrl: string,
  token: string,
  star: PhoneAddressStar,
): Promise<"ok" | AddressBookFailure> {
  return writeStar(apiUrl, token, "POST", star);
}

export async function unstarPhoneAddress(
  apiUrl: string,
  token: string,
  star: PhoneAddressStar,
): Promise<"ok" | AddressBookFailure> {
  return writeStar(apiUrl, token, "DELETE", star);
}

async function writeEntry(
  apiUrl: string,
  token: string,
  method: "POST" | "PATCH",
  path: string,
  body: AddressBookEntryWrite | AddressBookEntryPatch,
): Promise<AddressBookEntry | AddressBookFailure> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return failureFromStatus(response.status);
    }
    const payload: unknown = await response.json();
    return isEntry(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function writeStar(
  apiUrl: string,
  token: string,
  method: "POST" | "DELETE",
  star: PhoneAddressStar,
): Promise<"ok" | AddressBookFailure> {
  try {
    const response = await fetch(`${apiUrl}/address-book/phone-stars`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(star),
    });
    if (response.status === 204) {
      return "ok";
    }
    return failureFromStatus(response.status);
  } catch {
    return "unreachable";
  }
}

async function remove(apiUrl: string, token: string, path: string): Promise<"ok" | AddressBookFailure> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 204) {
      return "ok";
    }
    return failureFromStatus(response.status);
  } catch {
    return "unreachable";
  }
}

function failureFromStatus(status: number): AddressBookFailure {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 400) {
    return "invalid";
  }
  if (status === 404) {
    return "missing";
  }
  return "unreachable";
}

function isAddressBook(value: unknown): value is AddressBookResponse {
  return isRecord(value) && Array.isArray(value.entries) && value.entries.every(isEntry) && Array.isArray(value.phoneStars) && value.phoneStars.every(isStar);
}

function isEntry(value: unknown): value is AddressBookEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.nickname === "string" &&
    typeof value.placeName === "string" &&
    typeof value.label === "string" &&
    typeof value.latitude === "number" &&
    typeof value.longitude === "number" &&
    typeof value.favorite === "boolean"
  );
}

function isStar(value: unknown): value is PhoneAddressStar {
  return isRecord(value) && typeof value.contactId === "string" && typeof value.addressId === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
