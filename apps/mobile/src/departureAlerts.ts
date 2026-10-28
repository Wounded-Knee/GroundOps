import { Platform } from "react-native";
import type { NextDeparture } from "./nextDeparture";
import { departureAlertRequests, departureNotificationIds } from "./departureAlertRequests";

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
  await Promise.all(departureNotificationIds.map((id) => module.cancelScheduledNotificationAsync(id)));
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
  const requests = departureAlertRequests(next, now);
  for (const request of requests) {
    await module.scheduleNotificationAsync({
      identifier: request.identifier,
      content: {
        title: request.title,
        body: request.body,
        sound: true,
        data: { collapseTag: request.collapseTag },
      },
      trigger: {
        type: module.SchedulableTriggerInputTypes.DATE,
        date: request.fireAt,
      },
    });
  }
}
