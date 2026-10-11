import type {
  DirectoryCompany,
  DirectoryCompanyList,
  DirectoryFacility,
  DirectoryFacilityList,
  DirectoryNameRequest,
  DirectoryUser,
  DirectoryUserList,
  DirectoryUserRequest,
} from "@groundops/contracts";

export type DirectoryFailure = "unauthorized" | "forbidden" | "invalid" | "missing" | "in-use" | "unreachable";

export async function readCompanies(
  apiUrl: string,
  token: string,
): Promise<DirectoryCompanyList | DirectoryFailure> {
  return readList(apiUrl, token, "/companies", isCompanyList);
}

export async function createCompany(
  apiUrl: string,
  token: string,
  name: string,
): Promise<DirectoryCompany | DirectoryFailure> {
  return writeNamed(apiUrl, token, "POST", "/companies", { name });
}

export async function updateCompany(
  apiUrl: string,
  token: string,
  id: string,
  name: string,
): Promise<DirectoryCompany | DirectoryFailure> {
  return writeNamed(apiUrl, token, "PATCH", `/companies/${id}`, { name });
}

export async function deleteCompany(apiUrl: string, token: string, id: string): Promise<"ok" | DirectoryFailure> {
  return remove(apiUrl, token, `/companies/${id}`);
}

export async function readFacilities(
  apiUrl: string,
  token: string,
): Promise<DirectoryFacilityList | DirectoryFailure> {
  return readList(apiUrl, token, "/facilities", isFacilityList);
}

export async function createFacility(
  apiUrl: string,
  token: string,
  name: string,
): Promise<DirectoryFacility | DirectoryFailure> {
  return writeNamed(apiUrl, token, "POST", "/facilities", { name });
}

export async function updateFacility(
  apiUrl: string,
  token: string,
  id: string,
  name: string,
): Promise<DirectoryFacility | DirectoryFailure> {
  return writeNamed(apiUrl, token, "PATCH", `/facilities/${id}`, { name });
}

export async function deleteFacility(apiUrl: string, token: string, id: string): Promise<"ok" | DirectoryFailure> {
  return remove(apiUrl, token, `/facilities/${id}`);
}

export async function readDirectoryUsers(
  apiUrl: string,
  token: string,
): Promise<DirectoryUserList | DirectoryFailure> {
  return readList(apiUrl, token, "/users", isUserList);
}

export async function createDirectoryUser(
  apiUrl: string,
  token: string,
  body: DirectoryUserRequest,
): Promise<DirectoryUser | DirectoryFailure> {
  return writeUser(apiUrl, token, "POST", "/users", body);
}

export async function updateDirectoryUser(
  apiUrl: string,
  token: string,
  id: string,
  body: DirectoryUserRequest,
): Promise<DirectoryUser | DirectoryFailure> {
  return writeUser(apiUrl, token, "PATCH", `/users/${id}`, body);
}

export async function deleteDirectoryUser(
  apiUrl: string,
  token: string,
  id: string,
): Promise<"ok" | DirectoryFailure> {
  return remove(apiUrl, token, `/users/${id}`);
}

async function readList<T>(
  apiUrl: string,
  token: string,
  path: string,
  parse: (value: unknown) => value is T,
): Promise<T | DirectoryFailure> {
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return failureFromStatus(response.status);
    }
    const body: unknown = await response.json();
    return parse(body) ? body : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function writeNamed(
  apiUrl: string,
  token: string,
  method: "POST" | "PATCH",
  path: string,
  body: DirectoryNameRequest,
): Promise<DirectoryCompany | DirectoryFailure> {
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
    return isNamed(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function writeUser(
  apiUrl: string,
  token: string,
  method: "POST" | "PATCH",
  path: string,
  body: DirectoryUserRequest,
): Promise<DirectoryUser | DirectoryFailure> {
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
    return isDirectoryUser(payload) ? payload : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function remove(apiUrl: string, token: string, path: string): Promise<"ok" | DirectoryFailure> {
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

function failureFromStatus(status: number): DirectoryFailure {
  if (status === 401) {
    return "unauthorized";
  }
  if (status === 403) {
    return "forbidden";
  }
  if (status === 400) {
    return "invalid";
  }
  if (status === 404) {
    return "missing";
  }
  if (status === 409) {
    return "in-use";
  }
  return "unreachable";
}

function isCompanyList(value: unknown): value is DirectoryCompanyList {
  return isRecord(value) && Array.isArray(value.companies) && value.companies.every(isNamed);
}

function isFacilityList(value: unknown): value is DirectoryFacilityList {
  return isRecord(value) && Array.isArray(value.facilities) && value.facilities.every(isNamed);
}

function isUserList(value: unknown): value is DirectoryUserList {
  return isRecord(value) && Array.isArray(value.users) && value.users.every(isDirectoryUser);
}

function isNamed(value: unknown): value is DirectoryCompany {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.createdAt === "string";
}

function isDirectoryUser(value: unknown): value is DirectoryUser {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNullableString(value.displayName) &&
    isNullableString(value.email) &&
    typeof value.createdAt === "string"
  );
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
