import type { Sortie, SortieWriteRequest } from "@groundops/contracts";
import { authorSortie, ensureCurrentDriver, reviseSortie } from "./calendarClient";

export type SortieSaveResult = Sortie | "unauthorized" | "no-location" | "not-saved" | "unreachable" | "unavailable";

export async function saveSortieDraft(
  apiUrl: string,
  token: string,
  sortieId: string | null,
  body: SortieWriteRequest | "invalid",
): Promise<SortieSaveResult> {
  if (body === "invalid") {
    return "not-saved";
  }
  const ensured = await ensureCurrentDriver(apiUrl, token);
  if (ensured === "unauthorized") {
    return "unauthorized";
  }
  if (ensured === "unreachable") {
    return "unreachable";
  }
  const saved = sortieId ? await reviseSortie(apiUrl, token, sortieId, body) : await authorSortie(apiUrl, token, body);
  if (saved === "unauthorized" || saved === "unreachable" || saved === "unavailable" || saved === "no-location") {
    return saved;
  }
  if (typeof saved === "string") {
    return "not-saved";
  }
  return saved;
}
