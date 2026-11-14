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
            if (!ev?.id) return;
            setHouseholdEvents((prev) => {
              const exists = prev.some((item) => item.id === ev.id);
              return exists ? prev.map((item) => (item.id === ev.id ? ev : item)) : [...prev, ev];
            });
            const isFromPartner =
              payload.eventType === 'INSERT' &&
              ev.created_by.toLowerCase() !== userEmail.toLowerCase();
            if (isFromPartner) {
              setCalendarBanner(ev);
            }
            await scheduleCalendarEventNotifications(ev, isFromPartner);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'household_messages' },
        async (payload) => {
          const msg = payload.new as HouseholdMessage;
          if (!msg?.id) return;
          setHouseholdMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
          const isFromPartner = msg.sender_email.toLowerCase() !== userEmail.toLowerCase();
          if (isFromPartner) {
            if (activeTabRef.current !== 'chat') {
              setUnreadChatCount((c) => c + 1);
              setChatBanner(msg);
            }
            await notifyIncomingChatMessage(msg);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members' },
        async () => {
          const hh = await getUserHousehold(userEmail);
          setHousehold(hh);
          if (hh?.id) {
            await Promise.all([
              fetchHouseholdEvents(hh.id),
              fetchHouseholdMessages(hh.id),
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail, fetchHouseholdEvents, fetchHouseholdMessages]);

  useEffect(() => {
    const checkDueReminders = () => {
      const now = Date.now();
      const dueNote = notes.find((n) => {
        if (!n.reminder || n.reminder.completed) return false;
        const ts = new Date(n.reminder.at).getTime();
        return (
          !Number.isNaN(ts) &&
          ts <= now &&
          now - ts < 5 * 60 * 1000 &&
          !notifiedIdsRef.current.has(`${n.id}:${n.reminder.at}`)
        );
      });

      if (dueNote && dueNote.reminder) {
        notifiedIdsRef.current.add(`${dueNote.id}:${dueNote.reminder.at}`);
        setDueBannerNote(dueNote);
        triggerWebNotification(dueNote);
      }
    };

    checkDueReminders();
    const timer = window.setInterval(checkDueReminders, 15000);
    return () => window.clearInterval(timer);
  }, [notes]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditorOpen(false);
        setEmailModalOpen(false);
        setHouseholdModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSendChatMessage = useCallback(
    async (body: string) => {
      if (!userEmail || !household?.id) return;
      const { data, error } = await supabase
        .from('household_messages')
        .insert({
          household_id: household.id,
          sender_email: userEmail,
          body,
        })
        .select()
        .single();

      if (!error && data) {
        const created = data as HouseholdMessage;
        setHouseholdMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created]
        );
      }
    },
    [userEmail, household]
  );

  const handleAddCalendarEvent = useCallback(
    async (draft: {
      title: string;
      notes: string;
      event_date: string;
      event_time: string;
      remind_before_minutes: number;
    }) => {
      if (!userEmail || !household?.id) return;
      const { data, error } = await supabase
        .from('household_events')
        .insert({
          household_id: household.id,
          created_by: userEmail,
          title: draft.title,
          notes: draft.notes || null,
          event_date: draft.event_date,
          event_time: draft.event_time || null,
          remind_before_minutes: draft.remind_before_minutes,
        })
        .select()
        .single();

      if (!error && data) {
        const created = data as HouseholdEvent;
        setHouseholdEvents((prev) =>
          prev.some((e) => e.id === created.id) ? prev : [...prev, created]
        );
        await scheduleCalendarEventNotifications(created, false);
      }
    },
    [userEmail, household]
  );

  const handleDeleteCalendarEvent = useCallback(async (id: string) => {
    setHouseholdEvents((prev) => prev.filter((e) => e.id !== id));
    await supabase.from('household_events').delete().eq('id', id);
    try {
      await LocalNotifications.cancel({
        notifications: [
          { id: eventNotificationId(id, 1) },
          { id: eventNotificationId(id, 2) },
        ],
      });
    } catch {}
  }, []);

  const persistNoteEverywhere = useCallback(
    async (note: Note, forceHouseholdId?: string | null) => {
      await saveNoteToStorage(note);
      if (userEmail) {
        const hhId =
          forceHouseholdId !== undefined ? forceHouseholdId : (household?.id ?? null);

        if (hhId) {
          setSharedNoteIds((prev) => new Set(prev).add(note.id));
        } else {
          setSharedNoteIds((prev) => {
            const next = new Set(prev);
            next.delete(note.id);
            return next;
          });
        }
        await upsertCloudNote(note, userEmail, hhId);
      }
    },
    [userEmail, household]
  );

  const handleSaveChatAsNote = useCallback(
    async (body: string) => {
      const now = new Date().toISOString();
      const newNote: Note = {
        id: generateNoteId(),
        title: 'Från chatten',
        body,
        category: 'Privat',
        color: 'sage',
        pinned: false,
        reminder: null,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [newNote, ...prev]);
      setActiveTab('notes');
      await persistNoteEverywhere(newNote, household?.id ?? null);
    },
    [household, persistNoteEverywhere]
  );

  const handleToggleShareWithHousehold = useCallback(
    async (note: Note) => {
      if (!userEmail || !household) {
        setHouseholdModalOpen(true);
        return;
      }
      const nextHouseholdId = sharedNoteIds.has(note.id) ? null : household.id;
      const updated: Note = { ...note, updatedAt: new Date().toISOString() };
      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      await persistNoteEverywhere(updated, nextHouseholdId);
    },
    [userEmail, household, sharedNoteIds, persistNoteEverywhere]
  );

  const handleSaveNote = useCallback(
    async (draft: {
      id?: string;
      title: string;
      body: string;
      category: NoteCategory;
      color: NoteColor;
      pinned: boolean;
      reminder: { at: string; completed: boolean } | null;
    }) => {
      const now = new Date().toISOString();
      const existing = draft.id ? notes.find((n) => n.id === draft.id) : undefined;

      const updatedNote: Note = existing
        ? {
            ...existing,
            title: draft.title,
            body: draft.body,
            category: draft.category,
            color: draft.color,
            pinned: draft.pinned,
            reminder: draft.reminder,
            updatedAt: now,
          }
        : {
            id: generateNoteId(),
            title: draft.title,
            body: draft.body,
            category: draft.category,
            color: draft.color,
            pinned: draft.pinned,
            reminder: draft.reminder,
            createdAt: now,
            updatedAt: now,
          };

      setNotes((prev) => {
        const exists = prev.some((n) => n.id === updatedNote.id);
        return exists
          ? prev.map((n) => (n.id === updatedNote.id ? updatedNote : n))
          : [updatedNote, ...prev];
      });
      setEditorOpen(false);
      setEditingNote(null);

      const targetHhId = existing
        ? sharedNoteIds.has(existing.id)
          ? (household?.id ?? null)
          : null
        : (household?.id ?? null);

      await persistNoteEverywhere(updatedNote, targetHhId);
      if (updatedNote.reminder && !updatedNote.reminder.completed) {
        await ensureHighPriorityNotificationChannel();
      }
      await syncNoteReminderNotification(updatedNote);
    },
    [notes, household, sharedNoteIds, persistNoteEverywhere]
  );

  const handleTogglePin = useCallback(
    async (noteId: string) => {
      const target = notes.find((n) => n.id === noteId);
      if (!target) return;

      const updated: Note = {
        ...target,
        pinned: !target.pinned,
        updatedAt: new Date().toISOString(),
      };
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      await persistNoteEverywhere(
        updated,
        sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
      );
    },
    [notes, sharedNoteIds, household, persistNoteEverywhere]
  );

  const handleDeleteNote = useCallback(
    async (noteId: string) => {
      const target = notes.find((n) => n.id === noteId);
      if (!target) return;

      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (dueBannerNote?.id === noteId) setDueBannerNote(null);

      setDeletedUndo(target);
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => {
        setDeletedUndo(null);
      }, 5000);

      await deleteNoteFromStorage(noteId);
      await cancelNoteReminderNotification(noteId);
      if (userEmail) {
        await deleteCloudNote(noteId);
      }
    },
    [notes, dueBannerNote, userEmail]
  );

  const handleUndoDelete = useCallback(async () => {
    if (!deletedUndo) return;
    const restored = deletedUndo;
    setDeletedUndo(null);
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);

    setNotes((prev) => [restored, ...prev]);
    await persistNoteEverywhere(restored, household?.id ?? null);
    await syncNoteReminderNotification(restored);
  }, [deletedUndo, household, persistNoteEverywhere]);

  const handleToggleReminderComplete = useCallback(
    async (noteId: string) => {
      const target = notes.find((n) => n.id === noteId);
      if (!target || !target.reminder) return;

      const updated: Note = {
        ...target,
        reminder: {
          ...target.reminder,
          completed: !target.reminder.completed,
        },
        updatedAt: new Date().toISOString(),
      };
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      if (dueBannerNote?.id === noteId) setDueBannerNote(null);

      await persistNoteEverywhere(
        updated,
        sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
      );
      await syncNoteReminderNotification(updated);
    },
    [notes, dueBannerNote, sharedNoteIds, household, persistNoteEverywhere]
  );

  const handleSnoozeReminder = useCallback(
    async (noteId: string, preset: SnoozePreset) => {
      const target = notes.find((n) => n.id === noteId);
      if (!target) return;

      const nextAt = computeSnoozeDate(preset);
      const updated: Note = {
        ...target,
        reminder: {
          at: nextAt,
          completed: false,
          snoozedCount: (target.reminder?.snoozedCount ?? 0) + 1,
        },
        updatedAt: new Date().toISOString(),
      };
      setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
      if (dueBannerNote?.id === noteId) setDueBannerNote(null);

      await persistNoteEverywhere(
        updated,
        sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
      );
      await syncNoteReminderNotification(updated);
    },
    [notes, dueBannerNote, sharedNoteIds, household, persistNoteEverywhere]
  );

  const handleImportEmailNote = useCallback(
    async (newNote: Note) => {
      setNotes((prev) => [newNote, ...prev]);
      setActiveCategory(newNote.category);
      await persistNoteEverywhere(newNote, null);
      if (newNote.reminder) {
        await ensureHighPriorityNotificationChannel();
        await syncNoteReminderNotification(newNote);
      }
    },
    [persistNoteEverywhere]
  );

  const handleSaveEmailConfig = useCallback(async (config: EmailProviderConfig) => {
    setEmailConfigs((prev) => ({
      ...prev,
      [config.provider]: config,
    }));
    await saveEmailConfig(config);
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<FilterCategory, number> = {
      Alla: notes.length,
      Arbete: 0,
      Privat: 0,
      Gmail: 0,
      Outlook: 0,
    };
    for (const n of notes) {
      counts[n.category] = (counts[n.category] ?? 0) + 1;
    }
    return counts;
  }, [notes]);

  const activeRemindersCount = useMemo(
    () => notes.filter((n) => n.reminder && !n.reminder.completed).length,
    [notes]
  );

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (activeCategory !== 'Alla' && note.category !== activeCategory) return false;
        if (onlyReminders && !note.reminder) return false;
        if (!q) return true;
        return (
          note.title.toLowerCase().includes(q) ||
          note.body.toLowerCase().includes(q) ||
          note.category.toLowerCase().includes(q) ||
          (note.sourceMeta?.sender?.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, activeCategory, onlyReminders, searchQuery]);

  const pinnedNotes = useMemo(() => filteredNotes.filter((n) => n.pinned), [filteredNotes]);
  const otherNotes = useMemo(() => filteredNotes.filter((n) => !n.pinned), [filteredNotes]);
  const defaultNewCategory: NoteCategory = activeCategory === 'Alla' ? 'Arbete' : activeCategory;

  const renderNoteItem = (note: Note) => {
    const isShared = sharedNoteIds.has(note.id);
    return (
      <div key={note.id} className="flex flex-col gap-1.5">
        <NoteCard
          note={note}
          onEdit={(n) => {
            setEditingNote(n);
            setEditorOpen(true);
          }}
          onTogglePin={handleTogglePin}
          onDelete={handleDeleteNote}
          onToggleReminderComplete={handleToggleReminderComplete}
          onSnoozeReminder={handleSnoozeReminder}
        />
        {userEmail && household && (
          <button
            type="button"
            onClick={() => handleToggleShareWithHousehold(note)}
            className={`self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
              isShared
                ? 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]'
                : 'bg-[#ECEFE9] dark:bg-[#212723] text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            {isShared ? (
              <>
                <Users className="w-3 h-3" />
                <span>Delad med {household.name}</span>
              </>
            ) : (
              <>
                <Lock className="w-3 h-3" />
                <span>Privat (tryck för att dela)</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  if (showSplash) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#F6F7F4] dark:bg-[#111412] text-[#171D19] dark:text-[#E4EBE6] px-6">
        <div className="w-20 h-20 rounded-3xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] flex items-center justify-center shadow-lg mb-5">
          <Check className="w-10 h-10 stroke-[2.5]" />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight">BetterKeep</h1>
        <p className="text-sm font-medium text-[#525E56] dark:text-[#9BA79F] mt-1.5 tracking-wide">
          by Ferrelicious
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F4] dark:bg-[#111412] text-[#171D19] dark:text-[#E4EBE6] transition-colors duration-150">
      <TopBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenNewNote={() => {
          setEditingNote(null);
          setEditorOpen(true);
        }}
        onOpenEmailImport={() => setEmailModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4 pb-24 sm:py-6 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 px-4 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">
                {userEmail
                  ? household
                    ? household.name + ' (' + household.members.length + ' medlemmar)'
                    : 'Inloggad: ' + userEmail
                  : 'Synka med familjen (Hushåll)'}
              </p>
              <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                {userEmail
                  ? household
                    ? 'Realtidssynk aktiv för listor, kalender & chatt'
                    : 'Skapa ett hushåll och bjud in via e-post'
                  : 'Logga in för att dela listor, kalender och chatt i realtid'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHouseholdModalOpen(true)}
            className="shrink-0 min-h-[34px] px-3.5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold cursor-pointer"
          >
            {userEmail ? 'Hantera' : 'Logga in'}
          </button>
        </div>

        <div className="flex items-center gap-1.5 bg-[#ECEFE9] dark:bg-[#212723] p-1 rounded-2xl self-start flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'notes'
                ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                : 'text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            <StickyNote className="w-4 h-4" />
            <span>Anteckningar</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'calendar'
                ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                : 'text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            <span>Kalender</span>
            {householdEvents.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono-tabular bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]">
                {householdEvents.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                : 'text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            <span>Chatt</span>
            {unreadChatCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono-tabular bg-[#B3261E] text-white">
                {unreadChatCount}
              </span>
            )}
          </button>
        </div>

        {chatBanner && activeTab !== 'chat' && (
          <div
            role="status"
            className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] border border-[#2E6B4E]/25 dark:border-[#8FD4AE]/25 text-[#0D3824] dark:text-[#CBEED9] p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <MessageCircle className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  Nytt meddelande från {chatBanner.sender_email.split('@')[0]}
                </p>
                <p className="text-xs opacity-85 truncate">{chatBanner.body}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('chat');
                  setChatBanner(null);
                }}
                className="min-h-[34px] px-3 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold cursor-pointer"
              >
                Öppna chatt
              </button>
              <button
                type="button"
                onClick={() => setChatBanner(null)}
                aria-label="Stäng"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {calendarBanner && (
          <div
            role="status"
            className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] border border-[#2E6B4E]/25 dark:border-[#8FD4AE]/25 text-[#0D3824] dark:text-[#CBEED9] p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <CalendarIcon className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  Ny bokning från {calendarBanner.created_by.split('@')[0]}: {calendarBanner.title}
                </p>
                <p className="text-xs opacity-85 font-mono-tabular">
                  {calendarBanner.event_date}
                  {calendarBanner.event_time ? ` kl. ${calendarBanner.event_time}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('calendar');
                  setCalendarBanner(null);
                }}
                className="min-h-[34px] px-3 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold cursor-pointer"
              >
                Visa kalender
              </button>
              <button
                type="button"
                onClick={() => setCalendarBanner(null)}
                aria-label="Stäng"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'chat' ? (
          <HouseholdChat
            messages={householdMessages}
            householdName={household?.name}
            userEmail={userEmail}
            onSendMessage={handleSendChatMessage}
            onSaveAsNote={handleSaveChatAsNote}
            onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
          />
        ) : activeTab === 'calendar' ? (
          <HouseholdCalendar
            events={householdEvents}
            householdName={household?.name}
            userEmail={userEmail}
            onAddEvent={handleAddCalendarEvent}
            onDeleteEvent={handleDeleteCalendarEvent}
            onOpenHouseholdModal={() =>
