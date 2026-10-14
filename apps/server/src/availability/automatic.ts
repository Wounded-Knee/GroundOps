import type { User } from "@groundops/contracts";
import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db } from "../db.js";
import { driver, sortie } from "../schema.js";
import { setAvailability } from "./availability.js";

/** A lead check, calendar guidance, a commencement, or the conclusion of a sortie. */
export type AvailabilityEvent = "lead" | "guidance" | "commencement" | "conclusion";

export type AutomaticAvailabilityInput = {
  event: AvailabilityEvent;
  /** An uncommenced sortie starts in strictly less than the threshold. */
  withinLead: boolean;
  autoSetUnavailable: boolean;
  autoSetAvailable: boolean;
};

/**
 * The choice to write for one event, or null when this event must not change it.
 * Lead and calendar guidance set unavailable only. Commencement and conclusion set available, unless another sortie is already inside the lead.
 */
export function automaticAvailabilityChoice(input: AutomaticAvailabilityInput): boolean | null {
  if (input.event === "guidance") {
    return input.autoSetUnavailable ? false : null;
  }
  if (input.withinLead && input.autoSetUnavailable) {
    return false;
  }
  if ((input.event === "commencement" || input.event === "conclusion") && input.autoSetAvailable) {
    return true;
  }
  return null;
}

/**
 * Calendar Guide. Sets unavailable when that flag is on.
 * When the flag is off, this is the same check as commencement.
 */
export function guidanceAvailabilityChoice(
  input: Omit<AutomaticAvailabilityInput, "event">,
): boolean | null {
  if (input.autoSetUnavailable) {
    return false;
  }
  return automaticAvailabilityChoice({ ...input, event: "commencement" });
}

type DriverAutomaticRow = {
  id: string;
  userId: string;
  thresholdMinutes: number;
  autoSetUnavailable: boolean;
  autoSetAvailable: boolean;
};

/** Applies one availability event for this driver. A missing driver does nothing. */
export async function applyAutomaticAvailability(person: User, event: AvailabilityEvent, now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.userId, person.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  await applyEvent(row, event, now);
}

/** Calendar Guide. Sets unavailable when that flag is on; otherwise the commencement check. */
export async function applyGuidanceAvailability(person: User, now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.userId, person.id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return;
  }
  const choice = guidanceAvailabilityChoice({
    withinLead: await withinLead(row.id, row.thresholdMinutes, now),
    autoSetUnavailable: row.autoSetUnavailable,
    autoSetAvailable: row.autoSetAvailable,
  });
  await writeChoice(row, choice, now);
}

/** Lead check for every driver who can be set unavailable. Does not set anyone available. */
export async function applyAutomaticAvailabilityLead(now: Date): Promise<void> {
  const rows = await db
    .select(driverAutomaticSelect)
    .from(driver)
    .where(eq(driver.autoSetUnavailable, true));
  for (const row of rows) {
    await applyEvent(row, "lead", now);
  }
}

const driverAutomaticSelect = {
  id: driver.id,
  userId: driver.userId,
  thresholdMinutes: driver.availabilityThresholdMinutes,
  autoSetUnavailable: driver.autoSetUnavailable,
  autoSetAvailable: driver.autoSetAvailable,
};

async function applyEvent(row: DriverAutomaticRow, event: AvailabilityEvent, now: Date): Promise<void> {
  const lead = await withinLead(row.id, row.thresholdMinutes, now);
  const choice = automaticAvailabilityChoice({
    event,
    withinLead: lead,
    autoSetUnavailable: row.autoSetUnavailable,
    autoSetAvailable: row.autoSetAvailable,
  });
  // #region agent log
  fetch("http://127.0.0.1:7255/ingest/bba8e72d-4c30-46ba-aea7-aa7d479478a0",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"6a49b2"},body:JSON.stringify({sessionId:"6a49b2",hypothesisId:"B",location:"availability/automatic.ts:applyEvent",message:"automatic availability choice",data:{event,withinLead:lead,autoSetUnavailable:row.autoSetUnavailable,autoSetAvailable:row.autoSetAvailable,thresholdMinutes:row.thresholdMinutes,choice},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  await writeChoice(row, choice, now);
}

async function writeChoice(row: DriverAutomaticRow, choice: boolean | null, now: Date): Promise<void> {
  if (choice === null) {
    return;
  }
  await setAvailability(
    {
      id: row.userId,
      displayName: null,
      email: null,
      platformAdministrator: false,
    },
    choice,
    now,
  );
}

/** True when an uncommenced sortie is scheduled to start in strictly less than the threshold. */
async function withinLead(driverId: string, thresholdMinutes: number, now: Date): Promise<boolean> {
  if (thresholdMinutes <= 0) {
    return false;
  }
  const upcoming = await db
    .select({ scheduledStart: sortie.scheduledStart })
    .from(sortie)
    .where(and(eq(sortie.authorDriverId, driverId), isNull(sortie.actualStart), gte(sortie.scheduledStart, now)))
    .orderBy(asc(sortie.scheduledStart))
    .limit(1);
  const next = upcoming[0];
  if (!next) {
    return false;
  }
  const remainingMs = next.scheduledStart.getTime() - now.getTime();
  return remainingMs < thresholdMinutes * 60_000;
}
