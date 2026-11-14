import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;

  const status = await LocalNotifications.checkPermissions();
  if (status.display === 'granted') return true;

  const request = await LocalNotifications.requestPermissions();
  return request.display === 'granted';
}

export async function scheduleReminderNotification(
  noteId: string,
  title: string,
  body: string,
  triggerDate: Date
) {
  if (!Capacitor.isNativePlatform()) return;

  const granted = await requestNotificationPermission();
  if (!granted) return;

  // Omvandla sträng-ID till ett unikt heltal som Android kräver
  const numericId = Math.abs(
    noteId.split('').reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  ) % 2147483647;

  // Avboka eventuell gammal notis för samma anteckning
  await LocalNotifications.cancel({ notifications: [{ id: numericId }] });

  // Schemalägg endast om tiden ligger i framtiden
  if (triggerDate.getTime() > Date.now()) {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId,
          title: title || 'Påminnelse',
          body: body || 'Du har en schemalagd anteckning i BetterKeep.',
          schedule: { at: triggerDate, allowWhileIdle: true },
          sound: 'default',
        },
      ],
    });
  }
}

export async function cancelReminderNotification(noteId: string) {
  if (!Capacitor.isNativePlatform()) return;

  const numericId = Math.abs(
    noteId.split('').reduce((acc, char) => acc * 31 + char.charCodeAt(0), 0)
  ) % 2147483647;

  await LocalNotifications.cancel({ notifications: [{ id: numericId }] });
}
