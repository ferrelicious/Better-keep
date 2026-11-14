import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, Clock, Lock, Plus, Search, Users, X } from 'lucide-react';
import { CategoryTabs } from './components/CategoryTabs';
import { EmailImportModal } from './components/EmailImportModal';
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

function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
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

  // Supabase Auth & Household state
  const [householdModalOpen, setHouseholdModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [sharedNoteIds, setSharedNoteIds] = useState<Set<string>>(new Set());

  const [deletedUndo, setDeletedUndo] = useState<Note | null>(null);
  const [dueBannerNote, setDueBannerNote] = useState<Note | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const undoTimerRef = useRef<number | null>(null);

  // Splash screen timer on app launch
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowSplash(false);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  // Sync Tailwind dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveTheme(theme);
  }, [theme]);

  // Helper to refresh user, household and cloud notes
  const syncFromCloud = useCallback(async (email: string) => {
    try {
      const [hh, cloudRecords] = await Promise.all([
        getUserHousehold(email),
        fetchCloudNotes(),
      ]);
      setHousehold(hh);

      const sharedIds = new Set<string>();
      const mergedMap = new Map<string, Note>();

      // Start with local notes
      const localNotes = await loadAllNotes();
      for (const ln of localNotes) {
        mergedMap.set(ln.id, ln);
      }

      // Merge cloud notes (newer wins) & schedule notifications for incoming reminders
      for (const rec of cloudRecords) {
        if (rec.household_id) {
          sharedIds.add(rec.id);
        }
        const existing = mergedMap.get(rec.id);
        const cloudTime = new Date(rec.data.updatedAt || rec.updated_at).getTime();
        const localTime = existing ? new Date(existing.updatedAt).getTime() : 0;

        if (!existing || cloudTime >= localTime) {
          mergedMap.set(rec.id, rec.data);
          await saveNoteToStorage(rec.data);
          await syncNoteReminderNotification(rec.data);
        }
      }

      // Push local notes that don't exist in cloud yet
      for (const ln of localNotes) {
        const inCloud = cloudRecords.some((r) => r.id === ln.id);
        if (!inCloud) {
          await upsertCloudNote(ln, email, hh?.id ?? null);
          if (hh?.id) sharedIds.add(ln.id);
        }
      }

      setSharedNoteIds(sharedIds);
      setNotes(Array.from(mergedMap.values()));
    } catch {
      // Offline or unconfigured fallback
    }
  }, []);

  // Initial load from IndexedDB / localStorage + Supabase session check
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
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [syncFromCloud]);

  // Realtime subscription for seamless household sync
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
              await ensureNotificationPermissions();
            }
            await syncNoteReminderNotification(rec.data);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members' },
        async () => {
          const hh = await getUserHousehold(userEmail);
          setHousehold(hh);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userEmail]);

  // Poll reminders to show in-app banner or web notification when due
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

  // Global Escape handler for modals
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

  const persistNoteEverywhere = useCallback(
    async (note: Note, forceHouseholdId?: string | null) => {
      await saveNoteToStorage(note);
      if (userEmail) {
        const hhId =
          forceHouseholdId !== undefined
            ? forceHouseholdId
            : sharedNoteIds.has(note.id)
              ? (household?.id ?? null)
              : (household?.id ?? null);

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
    [userEmail, household, sharedNoteIds]
  );

  const handleToggleShareWithHousehold = useCallback(
    async (note: Note) => {
      if (!userEmail || !household) {
        setHouseholdModalOpen(true);
        return;
      }
      const currentlyShared = sharedNoteIds.has(note.id);
      const nextHouseholdId = currentlyShared ? null : household.id;
      const updated: Note = { ...note, updatedAt: new Date().toISOString() };

      setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
      await persistNoteEverywhere(updated, nextHouseholdId);
    },
    [userEmail, household, sharedNoteIds, persistNoteEverywhere]
  );

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleOpenNewNote = () => {
    setEditingNote(null);
    setEditorOpen(true);
  };

  const handleEditNote = (note: Note) => {
    setEditingNote(note);
    setEditorOpen(true);
  };

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
        await ensureNotificationPermissions();
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
        await ensureNotificationPermissions();
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

  // Category counts
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

  // Filtered & sorted notes
  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (activeCategory !== 'Alla' && note.category !== activeCategory) {
          return false;
        }
        if (onlyReminders && !note.reminder) {
          return false;
        }
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

  const defaultNewCategory: NoteCategory =
    activeCategory === 'Alla' ? 'Arbete' : activeCategory;

  const renderNoteWithShareBadge = (note: Note) => {
    const isShared = sharedNoteIds.has(note.id);
    return (
      <div key={note.id} className="flex flex-col gap-1.5">
        <NoteCard
          note={note}
          onEdit={handleEditNote}
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F7F4] dark:bg-[#111412] text-[#171D19] dark:text-[#E4EBE6] px-6 transition-opacity duration-300">
        <div className="w-16 h-16 rounded-3xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] flex items-center justify-center shadow-lg mb-5">
          <Check className="w-8 h-8 stroke-[2.5]" />
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">
          BetterKeep
        </h1>
        <p className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F] mt-1 tracking-wide">
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
        onToggleTheme={handleToggleTheme}
        onOpenNewNote={handleOpenNewNote}
        onOpenEmailImport={() => setEmailModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4 pb-24 sm:py-6 flex flex-col gap-5">
        {/* Household & Account Sync Bar */}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 px-4 py-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate">
                {userEmail
                  ? household
                  ? `${household.name} (${household.members.length} medlemmar)`
