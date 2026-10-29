import type { GeoCoordinate, Sortie, SortieWriteRequest } from "@groundops/contracts";
import { parseStoredSortie } from "./calendarCache";
import { localDatabase } from "./localDatabase";
import { enqueueObservation } from "./locationOutbox";
import { provisionalSortie } from "./provisionalWindow";
import { saveSortieDraft } from "./saveSortie";

export type PendingCommand = {
  sortieId: string;
  kind: "create" | "revise";
  body: SortieWriteRequest;
  provisional: Sortie;
  preImage: Sortie | null;
  authoredAt: string;
};

export async function readPending(userId: string): Promise<PendingCommand[]> {
  const db = await localDatabase();
  const rows = await db.getAllAsync<{
    sortie_id: string;
    kind: string;
    body_json: string;
    provisional_json: string;
    pre_image_json: string | null;
    authored_at: string;
  }>("SELECT sortie_id, kind, body_json, provisional_json, pre_image_json, authored_at FROM pending_sortie WHERE user_id = ? ORDER BY authored_at", userId);
  const commands: PendingCommand[] = [];
  for (const row of rows) {
    const command = parseCommand(row);
    if (command) {
      commands.push(command);
    }
  }
  return commands;
}

export async function removePending(userId: string, sortieId: string): Promise<void> {
  const db = await localDatabase();
  await db.runAsync("DELETE FROM pending_sortie WHERE user_id = ? AND sortie_id = ?", userId, sortieId);
}

export async function queueSortieCommand(input: {
  userId: string;
  sortieId: string;
  kind: "create" | "revise";
  body: SortieWriteRequest;
  sorties: readonly Sortie[];
  gps: GeoCoordinate | null;
  now?: Date;
}): Promise<Sortie | "no-origin"> {
  const now = input.now ?? new Date();
  const existing = await readPending(input.userId);
  const previousPending = existing.find((command) => command.sortieId === input.sortieId);
  const kind = previousPending?.kind ?? input.kind;
  const displayed = input.sorties.find((sortie) => sortie.id === input.sortieId) ?? null;
  const previous = previousPending?.provisional ?? (kind === "revise" ? displayed : null);
  const built = provisionalSortie({
    id: input.sortieId,
    previous,
    body: input.body,
    sorties: input.sorties,
    gps: input.gps,
    now,
  });
  if (built === "no-origin") {
    return "no-origin";
  }
  const command: PendingCommand = {
    sortieId: input.sortieId,
    kind,
    body: kind === "create" ? { ...input.body, id: input.sortieId } : input.body,
    provisional: built.sortie,
    preImage: kind === "revise" ? (previousPending?.preImage ?? displayed) : null,
    authoredAt: previousPending?.authoredAt ?? now.toISOString(),
  };
  await writePending(input.userId, command);
  if (built.origin === "gps" && input.gps) {
    await enqueueObservation(input.userId, {
      id: crypto.randomUUID(),
      observedAt: now.toISOString(),
      latitude: input.gps.latitude,
      longitude: input.gps.longitude,
      accuracyMeters: null,
    });
  }
  return built.sortie;
}

export type SortiePersist =
  | { status: "saved"; sortie: Sortie }
  | { status: "queued"; sortie: Sortie }
  | { status: "unauthorized" }
  | { status: "no-location" }
  | { status: "not-saved" };

export async function saveOrQueueSortie(input: {
  apiUrl: string;
  token: string;
  userId: string;
  sortieId: string | null;
  body: SortieWriteRequest;
  sorties: readonly Sortie[];
  gps: GeoCoordinate | null;
}): Promise<SortiePersist> {
  const pending = await readPending(input.userId);
  const held = input.sortieId ? pending.find((command) => command.sortieId === input.sortieId) : undefined;
  const creating = held?.kind === "create" || input.sortieId === null;
  const id = creating ? (held?.sortieId ?? crypto.randomUUID()) : input.sortieId;
  if (!id) {
    return { status: "not-saved" };
  }
  const saved = await saveSortieDraft(
    input.apiUrl,
    input.token,
    creating ? null : id,
    creating ? { ...input.body, id } : input.body,
  );
  if (saved === "unauthorized") {
    return { status: "unauthorized" };
  }
  if (saved === "no-location") {
    return { status: "no-location" };
  }
  if (saved === "unreachable" || saved === "unavailable") {
    const queued = await queueSortieCommand({
      userId: input.userId,
      sortieId: id,
      kind: creating ? "create" : "revise",
      body: input.body,
      sorties: input.sorties,
      gps: input.gps,
    });
    return queued === "no-origin" ? { status: "no-location" } : { status: "queued", sortie: queued };
  }
  if (typeof saved === "string") {
    return { status: "not-saved" };
  }
  await removePending(input.userId, saved.id);
  return { status: "saved", sortie: saved };
}

async function writePending(userId: string, command: PendingCommand): Promise<void> {
  const db = await localDatabase();
  await db.runAsync(
    `INSERT INTO pending_sortie (user_id, sortie_id, kind, body_json, provisional_json, pre_image_json, authored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, sortie_id) DO UPDATE SET
       kind = excluded.kind,
       body_json = excluded.body_json,
       provisional_json = excluded.provisional_json,
       pre_image_json = excluded.pre_image_json,
       authored_at = pending_sortie.authored_at`,
    userId,
    command.sortieId,
    command.kind,
    JSON.stringify(command.body),
    JSON.stringify(command.provisional),
    command.preImage ? JSON.stringify(command.preImage) : null,
    command.authoredAt,
  );
}

function parseCommand(row: {
  sortie_id: string;
  kind: string;
  body_json: string;
  provisional_json: string;
  pre_image_json: string | null;
  authored_at: string;
}): PendingCommand | null {
  if (row.kind !== "create" && row.kind !== "revise") {
    return null;
  }
  try {
    const body: unknown = JSON.parse(row.body_json);
    const provisional = parseStoredSortie(JSON.parse(row.provisional_json) as unknown);
    const preImage = row.pre_image_json ? parseStoredSortie(JSON.parse(row.pre_image_json) as unknown) : null;
    if (!isBody(body) || !provisional) {
      return null;
    }
    return {
      sortieId: row.sortie_id,
      kind: row.kind,
      body,
      provisional,
      preImage,
      authoredAt: row.authored_at,
    };
  } catch {
    return null;
  }
}

function isBody(value: unknown): value is SortieWriteRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.label === "string" && Array.isArray(record.stops);
}
