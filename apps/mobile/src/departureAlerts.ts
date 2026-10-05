import { Platform } from "react-native";
import type { DepartureAlertMark, NextDeparture } from "./nextDeparture";
import { departureAlertMarks } from "./nextDeparture";

const notificationIds = ["groundops-depart-5", "groundops-depart-1", "groundops-depart-0"] as const;

type NotificationsModule = typeof import("expo-notifications");

let notifications: NotificationsModule | null = null;
let permissionAsked = false;

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") {
    return null;
  }
  if (notifications) {
    return notifications;
  }
  try {
    notifications = await import("expo-notifications");
    notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    return notifications;
  } catch {
    return null;
  }
}

export async function ensureDepartureAlertPermission(): Promise<boolean> {
  const module = await loadNotifications();
  if (!module) {
    return false;
  }
  const current = await module.getPermissionsAsync();
  if (current.granted) {
    return true;
  }
  if (permissionAsked && !current.canAskAgain) {
    return false;
  }
  permissionAsked = true;
  const requested = await module.requestPermissionsAsync();
  return requested.granted;
}

export async function cancelDepartureAlerts(): Promise<void> {
  const module = await loadNotifications();
  if (!module) {
    return;
  }
  await Promise.all(notificationIds.map((id) => module.cancelScheduledNotificationAsync(id)));
}

export async function scheduleDepartureAlerts(next: NextDeparture | null, now: Date): Promise<void> {
  await cancelDepartureAlerts();
  if (!next) {
    return;
  }
  const granted = await ensureDepartureAlertPermission();
  if (!granted) {
    return;
  }
  const module = await loadNotifications();
  if (!module) {
    return;
  }
  const marks = departureAlertMarks(next.departAt, now);
  for (const mark of marks) {
    await module.scheduleNotificationAsync({
      identifier: notificationIdFor(mark.minutesBefore),
      content: {
        title: departureTitle(mark),
        body: `Depart for ${next.label}`,
        sound: true,
      },
      trigger: {
        type: module.SchedulableTriggerInputTypes.DATE,
        date: mark.fireAt,
      },
    });
  }
}

function notificationIdFor(minutesBefore: DepartureAlertMark["minutesBefore"]): string {
  if (minutesBefore === 5) {
    return "groundops-depart-5";
  }
  if (minutesBefore === 1) {
    return "groundops-depart-1";
  }
  return "groundops-depart-0";
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
