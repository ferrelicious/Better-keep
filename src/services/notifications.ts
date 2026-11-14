import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Note } from '../types/note';

export const URGENT_CHANNEL_ID = 'betterkeep-urgent';

let channelCreated = false;

/**
 * Converts a string UUID into a deterministic positive 31-bit integer
 * suitable for Android LocalNotification IDs.
 */
export function noteIdToNotificationId(noteId: string): number {
  let hash = 0;
  for (let i = 0; i < noteId.length; i++) {
    hash = (hash * 31 + noteId.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash);
  return positive === 0 ? 1 : positive;
}

export function eventNotificationId(entityId: string, suffix = 0): number {
  let hash = suffix;
  for (let i = 0; i < entityId.length; i++) {
    hash = (hash * 31 + entityId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 2000000000) + 100000;
}

export async function ensureNotificationPermissions(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const status = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') return true;
      const requested = await LocalNotifications.requestPermissions();
      return requested.display === 'granted';
    }

    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission !== 'denied') {
        const res = await Notification.requestPermission();
        return res === 'granted';
      }
    }
  } catch {
    // Safe fallback in environments without notification APIs
  }
  return false;
}

/**
 * Creates the high-priority Android notification channel (importance 5)
 * used for household chat messages, shared calendar events, and reminders.
 */
export async function ensureHighPriorityNotificationChannel(): Promise<void> {
  try {
    await ensureNotificationPermissions();
    if (Capacitor.isNativePlatform() && !channelCreated) {
      await LocalNotifications.createChannel({
        id: URGENT_CHANNEL_ID,
        name: 'Hushåll, Chatt & Kalender',
        description: 'Viktiga notiser för delad chatt, kalenderbokningar och påminnelser',
        importance: 5,
        visibility: 1,
        lights: true,
        vibration: true,
        sound: 'default',
      });
      channelCreated = true;
    }
  } catch {
    // Web preview fallback
  }
}

export async function syncNoteReminderNotification(note: Note): Promise<void> {
  const notifId = noteIdToNotificationId(note.id);

  if (!note.reminder || note.reminder.completed) {
    await cancelNoteReminderNotification(note.id);
    return;
  }

  const triggerDate = new Date(note.reminder.at);
  if (Number.isNaN(triggerDate.getTime()) || triggerDate.getTime() <= Date.now()) {
    return;
  }

  try {
    if (Capacitor.isNativePlatform()) {
      await ensureHighPriorityNotificationChannel();
      const granted = await ensureNotificationPermissions();
      if (!granted) return;

      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            channelId: URGENT_CHANNEL_ID,
            title: note.title.trim() || 'BetterKeep-påminnelse',
            body: note.body.trim().slice(0, 140) || `Kategori: ${note.category}`,
            schedule: { at: triggerDate, allowWhileIdle: true },
            extra: { noteId: note.id, category: note.category },
          },
        ],
      });
    }
  } catch {
    // Non-fatal in web preview
  }
}

export async function cancelNoteReminderNotification(noteId: string): Promise<void> {
  const notifId = noteIdToNotificationId(noteId);
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
    }
  } catch {
    // Ignore when running purely in web browser
  }
}

export async function scheduleCalendarEventNotifications(
  ev: {
    id: string;
    title: string;
    created_by: string;
    event_date: string;
    event_time?: string | null;
    notes?: string | null;
    remind_before_minutes?: number | null;
  },
  immediateFromPartner = false
): Promise<void> {
  try {
    await ensureHighPriorityNotificationChannel();

    if (Capacitor.isNativePlatform()) {
      if (immediateFromPartner) {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: eventNotificationId(ev.id, 1),
              channelId: URGENT_CHANNEL_ID,
              title: `Ny kalenderbokning från ${ev.created_by.split('@')[0]}`,
              body: `${ev.title} (${ev.event_date}${ev.event_time ? ` kl. ${ev.event_time}` : ''})`,
              schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
            },
          ],
        });
      }

      if (ev.event_date && ev.event_time) {
        const eventStart = new Date(`${ev.event_date}T${ev.event_time}:00`);
        const beforeMs = (ev.remind_before_minutes ?? 60) * 60 * 1000;
        const remindAt = new Date(eventStart.getTime() - beforeMs);
        if (!Number.isNaN(remindAt.getTime()) && remindAt.getTime() > Date.now()) {
          await LocalNotifications.cancel({
            notifications: [{ id: eventNotificationId(ev.id, 2) }],
          });
          await LocalNotifications.schedule({
            notifications: [
              {
                id: eventNotificationId(ev.id, 2),
                channelId: URGENT_CHANNEL_ID,
                title: `Påminnelse: ${ev.title}`,
                body: `Börjar kl. ${ev.event_time} (${ev.event_date})${ev.notes ? ` · ${ev.notes}` : ''}`,
                schedule: { at: remindAt, allowWhileIdle: true },
              },
            ],
          });
        }
      }
    } else if (
      immediateFromPartner &&
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`Ny kalenderbokning från ${ev.created_by.split('@')[0]}`, {
        body: `${ev.title} (${ev.event_date}${ev.event_time ? ` kl. ${ev.event_time}` : ''})`,
        tag: `betterkeep-cal-${ev.id}`,
      });
    }
  } catch {
    // Fallback on web preview
  }
}

export async function cancelCalendarEventNotifications(eventId: string): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.cancel({
        notifications: [
          { id: eventNotificationId(eventId, 1) },
          { id: eventNotificationId(eventId, 2) },
        ],
      });
    }
  } catch {
    // Ignore
  }
}

export async function notifyIncomingChatMessage(msg: {
  id: string;
  sender_email: string;
  body: string;
}): Promise<void> {
  try {
    await ensureHighPriorityNotificationChannel();

    if (Capacitor.isNativePlatform()) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: eventNotificationId(msg.id, 3),
            channelId: URGENT_CHANNEL_ID,
            title: `Nytt meddelande från ${msg.sender_email.split('@')[0]}`,
            body: msg.body,
            schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
          },
        ],
      });
    } else if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(`Nytt meddelande från ${msg.sender_email.split('@')[0]}`, {
        body: msg.body,
        tag: `betterkeep-chat-${msg.id}`,
      });
    }
  } catch {
    // Fallback on web preview
  }
}

export function triggerWebNotification(note: Note): void {
  try {
    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted' &&
      !Capacitor.isNativePlatform()
    ) {
      new Notification(note.title || 'BetterKeep-påminnelse', {
        body: note.body.slice(0, 120) || `Kategori: ${note.category}`,
        tag: `betterkeep-${note.id}`,
      });
    }
  } catch {
    // Ignore browser notification restrictions
  }
}

export function formatReminderDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Ogiltigt datum';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const timeStr = date.toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (targetStart.getTime() === todayStart.getTime()) {
    return `Idag ${timeStr}`;
  }
  if (targetStart.getTime() === tomorrowStart.getTime()) {
    return `Imorgon ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
  });
  return `${dateStr} ${timeStr}`;
}

export function isReminderOverdue(isoString: string, completed: boolean): boolean {
  if (completed) return false;
  const ts = new Date(isoString).getTime();
  return !Number.isNaN(ts) && ts < Date.now();
}

export type SnoozePreset = '15m' | '1h' | 'tomorrow';

export function computeSnoozeDate(preset: SnoozePreset): string {
  const now = new Date();
  if (preset === '15m') {
    return new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  }
  if (preset === '1h') {
    return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}
