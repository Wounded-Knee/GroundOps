import type { DepartureAlertMark, NextDeparture } from "./nextDeparture";
import { departureAlertMarks } from "./nextDeparture";

/** Android posts every departure alert under this tag so a later mark replaces the earlier row. */
export const departureCollapseTag = "groundops-depart";

const notificationIds = {
  5: "groundops-depart-5",
  1: "groundops-depart-1",
  0: "groundops-depart-0",
} as const;

export const departureNotificationIds = [notificationIds[5], notificationIds[1], notificationIds[0]] as const;

export type DepartureAlertRequest = {
  identifier: (typeof departureNotificationIds)[number];
  title: string;
  body: string;
  collapseTag: typeof departureCollapseTag;
  fireAt: Date;
};

/** Pending alarms for the marks still in the future. Identifiers stay distinct; the tray tag does not. */
export function departureAlertRequests(next: NextDeparture, now: Date): DepartureAlertRequest[] {
  return departureAlertMarks(next.departAt, now).map((mark) => ({
    identifier: notificationIds[mark.minutesBefore],
    title: departureTitle(mark),
    body: `Depart for ${next.label}`,
    collapseTag: departureCollapseTag,
    fireAt: mark.fireAt,
  }));
}

function departureTitle(mark: DepartureAlertMark): string {
  if (mark.minutesBefore === 0) {
    return "Departure time";
  }
  if (mark.minutesBefore === 1) {
    return "Depart in 1 minute";
  }
  return "Depart in 5 minutes";
}
