import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  Bell,
  Calendar as CalendarIcon,
  Check,
  Clock,
  Lock,
  MessageCircle,
  Plus,
  Search,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import { CategoryTabs } from './components/CategoryTabs';
import { EmailImportModal } from './components/EmailImportModal';
import { HouseholdCalendar, HouseholdEvent } from './components/HouseholdCalendar';
import { HouseholdChat, HouseholdMessage } from './components/HouseholdChat';
import { HouseholdModal } from './components/HouseholdModal';
import { NoteCard } from './components/NoteCard';
import { NoteEditorModal } from './components/NoteEditorModal';
import { TopBar } from './components/TopBar';
import {
  SnoozePreset,
  cancelNoteReminderNotification,
  computeSnoozeDate,
  ensureNotificationPermissions,
  formatReminderDateTime,
  syncNoteReminderNotification,
  triggerWebNotification,
} from './services/notifications';
import {
  ThemeMode,
  deleteNoteFromStorage,
  getDefaultEmailConfigs,
  getSavedTheme,
  loadAllNotes,
  loadEmailConfigs,
  saveEmailConfig,
  saveNoteToStorage,
  saveTheme,
} from './services/storage';
import {
  CloudNoteRecord,
  HouseholdInfo,
  deleteCloudNote,
  fetchCloudNotes,
  getUserHousehold,
  supabase,
  upsertCloudNote,
} from './services/supabase';
import {
  EmailProvider,
  EmailProviderConfig,
  FILTER_TABS,
  FilterCategory,
  Note,
  NoteCategory,
  NoteColor,
} from './types/note';

const URGENT_CHANNEL_ID = 'betterkeep-urgent';

async function ensureHighPriorityNotificationChannel() {
  try {
    await ensureNotificationPermissions();
    await LocalNotifications.createChannel({
      id: URGENT_CHANNEL_ID,
      name: 'Hushåll, Chatt & Kalender',
      description: 'Viktiga notiser för delad chatt, kalenderbokningar och påminnelser',
      importance: 5,
      visibility: 1,
      lights: true,
      vibration: true,
    });
  } catch {
    // Web preview fallback
  }
}

function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function eventNotificationId(eventId: string, suffix = 0): number {
  let hash = suffix;
  for (let i = 0; i < eventId.length; i++) {
    hash = (hash * 31 + eventId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash % 2000000000) + 100000;
}

async function scheduleCalendarEventNotifications(ev: HouseholdEvent, immediateFromPartner = false) {
  try {
    await ensureHighPriorityNotificationChannel();
    if (immediateFromPartner) {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: eventNotificationId(ev.id, 1),
            channelId: URGENT_CHANNEL_ID,
            title: `Ny kalenderbokning från ${ev.created_by.split('@')[0]}`,
            body: `${ev.title} (${ev.event_date}${ev.event_time ? ` kl. ${ev.event_time}` : ''})`,
            schedule: { at: new Date(Date.now() + 1000) },
          },
        ],
      });
    }

    if (ev.event_date && ev.event_time) {
      const eventStart = new Date(`${ev.event_date}T${ev.event_time}:00`);
      const beforeMs = (ev.remind_before_minutes ?? 60) * 60 * 1000;
      const remindAt = new Date(eventStart.getTime() - beforeMs);
      if (!Number.isNaN(remindAt.getTime()) && remindAt.getTime() > Date.now()) {
        await LocalNotifications.schedule({
          notifications: [
            {
              id: eventNotificationId(ev.id, 2),
              channelId: URGENT_CHANNEL_ID,
              title: `Påminnelse: ${ev.title}`,
              body: `Börjar kl. ${ev.event_time} (${ev.event_date})${ev.notes ? ` · ${ev.notes}` : ''}`,
              schedule: { at: remindAt },
            },
          ],
        });
      }
    }
  } catch {
    // Fallback on web preview
  }
}

async function notifyIncomingChatMessage(msg: HouseholdMessage) {
  try {
    await ensureHighPriorityNotificationChannel();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: eventNotificationId(msg.id, 3),
          channelId: URGENT_CHANNEL_ID,
          title: `Nytt meddelande från ${msg.sender_email.split('@')[0]}`,
          body: msg.body,
          schedule: { at: new Date(Date.now() + 500) },
        },
      ],
    });
  } catch {
    // Fallback on web preview
  }
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<'notes' | 'calendar' | 'chat'>('notes');
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('Alla');
  const [onlyReminders, setOnlyReminders] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailConfigs, setEmailConfigs] = useState<Record<EmailProvider, EmailProviderConfig>>(
    () => getDefaultEmailConfigs()
  );

  const [householdModalOpen, setHouseholdModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [sharedNoteIds, setSharedNoteIds] = useState<Set<string>>(new Set());
  const [householdEvents, setHouseholdEvents] = useState<HouseholdEvent[]>([]);
  const [householdMessages, setHouseholdMessages] = useState<HouseholdMessage[]>([]);
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  const [deletedUndo, setDeletedUndo] = useState<Note | null>(null);
  const [dueBannerNote, setDueBannerNote] = useState<Note | null>(null);
  const [calendarBanner, setCalendarBanner] = useState<HouseholdEvent | null>(null);
  const [chatBanner, setChatBanner] = useState<HouseholdMessage | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const undoTimerRef = useRef<number | null>(null);
  const activeTabRef = useRef<'notes' | 'calendar' | 'chat'>('notes');

  useEffect(() => {
    ensureHighPriorityNotificationChannel();
  }, []);

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (activeTab === 'chat') {
      setUnreadChatCount(0);
      setChatBanner(null);
    }
  }, [activeTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveTheme(theme);
  }, [theme]);

  const fetchHouseholdEvents = useCallback(async (householdId: string) => {
    const { data, error } = await supabase
      .from('household_events')
      .select('*')
      .eq('household_id', householdId)
      .order('event_date', { ascending: true });
    if (!error && data) {
      setHouseholdEvents(data as HouseholdEvent[]);
      for (const ev of data as HouseholdEvent[]) {
        await scheduleCalendarEventNotifications(ev, false);
      }
    }
  }, []);

  const fetchHouseholdMessages = useCallback(async (householdId: string) => {
    const { data, error } = await supabase
      .from('household_messages')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (!error && data) {
      setHouseholdMessages(data as HouseholdMessage[]);
    }
  }, []);

  const syncFromCloud = useCallback(
    async (email: string) => {
      try {
        const [hh, cloudRecords] = await Promise.all([
          getUserHousehold(email),
          fetchCloudNotes(),
        ]);
        setHousehold(hh);
        if (hh?.id) {
          await Promise.all([
            fetchHouseholdEvents(hh.id),
            fetchHouseholdMessages(hh.id),
          ]);
        } else {
          setHouseholdEvents([]);
          setHouseholdMessages([]);
        }

        const sharedIds = new Set<string>();
        const mergedMap = new Map<string, Note>();

        const localNotes = await loadAllNotes();
        for (const ln of localNotes) {
          mergedMap.set(ln.id, ln);
        }

        for (const rec of cloudRecords) {
          if (rec.household_id) sharedIds.add(rec.id);
          const existing = mergedMap.get(rec.id);
          const cloudTime = new Date(rec.data.updatedAt || rec.updated_at).getTime();
          const localTime = existing ? new Date(existing.updatedAt).getTime() : 0;

          if (!existing || cloudTime >= localTime) {
            mergedMap.set(rec.id, rec.data);
            await saveNoteToStorage(rec.data);
            await syncNoteReminderNotification(rec.data);
          }
        }

        for (const ln of localNotes) {
          if (!cloudRecords.some((r) => r.id === ln.id)) {
            await upsertCloudNote(ln, email, hh?.id ?? null);
            if (hh?.id) sharedIds.add(ln.id);
          }
        }

        setSharedNoteIds(sharedIds);
        setNotes(Array.from(mergedMap.values()));
      } catch {
        // Offline fallback
      }
    },
    [fetchHouseholdEvents, fetchHouseholdMessages]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loadedNotes, loadedConfigs] = await Promise.all([
          loadAllNotes(),
          loadEmailConfigs(),
        ]);
        if (!active) return;
        setNotes(loadedNotes);
        setEmailConfigs(loadedConfigs);

        const { data } = await supabase.auth.getSession();
        const email = data.session?.user?.email ?? null;
        if (active && email) {
          setUserEmail(email);
          await syncFromCloud(email);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const email = session?.user?.email ?? null;
      setUserEmail(email);
      if (email) {
        await syncFromCloud(email);
      } else {
        setHousehold(null);
        setSharedNoteIds(new Set());
        setHouseholdEvents([]);
        setHouseholdMessages([]);
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [syncFromCloud]);

  useEffect(() => {
    if (!userEmail) return;

    const channel = supabase
      .channel('betterkeep-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notes' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setNotes((prev) => prev.filter((n) => n.id !== deletedId));
              setSharedNoteIds((prev) => {
                const next = new Set(prev);
                next.delete(deletedId);
                return next;
              });
              await deleteNoteFromStorage(deletedId);
              await cancelNoteReminderNotification(deletedId);
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const rec = payload.new as CloudNoteRecord;
            if (!rec?.data) return;

            setNotes((prev) => {
              const exists = prev.some((n) => n.id === rec.id);
              return exists
                ? prev.map((n) => (n.id === rec.id ? rec.data : n))
                : [rec.data, ...prev];
            });
            setSharedNoteIds((prev) => {
              const next = new Set(prev);
              if (rec.household_id) next.add(rec.id);
              else next.delete(rec.id);
              return next;
            });

            await saveNoteToStorage(rec.data);
            if (rec.data.reminder && !rec.data.reminder.completed) {
              await ensureHighPriorityNotificationChannel();
            }
            await syncNoteReminderNotification(rec.data);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_events' },
        async (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setHouseholdEvents((prev) => prev.filter((e) => e.id !== deletedId));
              try {
                await LocalNotifications.cancel({
                  notifications: [
                    { id: eventNotificationId(deletedId, 1) },
                    { id: eventNotificationId(deletedId, 2) },
                  ],
                });
              } catch {}
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const ev = payload.new as HouseholdEvent;
            if (!ev?.id
