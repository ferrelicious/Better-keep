import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Note } from '../types/note';

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

export async function syncNoteReminderNotification(note: Note): Promise<void> {
  const notifId = noteIdToNotificationId(note.id);

  // Cancel any existing notification first if no active future reminder
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
      const granted = await ensureNotificationPermissions();
      if (!granted) return;

      await LocalNotifications.cancel({ notifications: [{ id: notifId }] });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
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
