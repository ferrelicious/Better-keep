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
                    : `Inloggad: ${userEmail}`
                  : 'Synka med familjen (Hushåll)'}
              </p>
              <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                {userEmail
                  ? household
                    ? 'Realtidssynk aktiv för delade listor & påminnelser'
                    : 'Skapa ett hushåll och bjud in via e-post'
                  : 'Logga in för att dela inköpslistor och påminnelser i realtid'}
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

        {/* Mobile Search Input (in scrollable flow so sticky header stays compact) */}
        <div className="md:hidden relative">
          <Search
            className="w-4 h-4 text-[#525E56] dark:text-[#9BA79F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sök anteckningar eller mejl..."
            aria-label="Sök anteckningar"
            className="w-full h-11 pl-10 pr-10 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] placeholder:text-[#525E56] dark:placeholder:text-[#9BA79F] border border-transparent focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE] focus:bg-white dark:focus:bg-[#191D1A] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Rensa sökning"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full text-[#525E56] dark:text-[#9BA79F]"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Due Reminder Alert Banner */}
        {dueBannerNote && dueBannerNote.reminder && (
          <div
            role="status"
            className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] border border-[#2E6B4E]/25 dark:border-[#8FD4AE]/25 text-[#0D3824] dark:text-[#CBEED9] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start sm:items-center gap-3 min-w-0">
              <Bell className="w-5 h-5 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  Påminnelse nu: {dueBannerNote.title || 'Anteckning'}
                </p>
                <p className="text-xs opacity-85 font-mono-tabular">
                  {formatReminderDateTime(dueBannerNote.reminder.at)} · {dueBannerNote.category}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleToggleReminderComplete(dueBannerNote.id)}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Markera klar</span>
              </button>
              <button
                type="button"
                onClick={() => handleSnoozeReminder(dueBannerNote.id, '15m')}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl bg-white/75 dark:bg-black/25 text-xs font-semibold cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Snooza +15m</span>
              </button>
              <button
                type="button"
                onClick={() => setDueBannerNote(null)}
                aria-label="Stäng avisering"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Category Filter Tabs */}
        <CategoryTabs
          activeCategory={activeCategory}
          onSelectCategory={setActiveCategory}
          counts={categoryCounts}
          onlyReminders={onlyReminders}
          onToggleOnlyReminders={() => setOnlyReminders((prev) => !prev)}
          activeRemindersCount={activeRemindersCount}
        />

        {/* Quick Capture Bar */}
        <button
          type="button"
          onClick={handleOpenNewNote}
          className="w-full max-w-2xl mx-auto text-left rounded-2xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 hover:border-[#2E6B4E]/40 dark:hover:border-[#8FD4AE]/40 px-4 sm:px-5 py-3.5 flex items-center justify-between gap-4 transition-colors duration-150 cursor-pointer"
        >
          <span className="text-sm text-[#525E56] dark:text-[#9BA79F]">
            Skriv en ny anteckning eller lägg till påminnelse...
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2E6B4E] dark:text-[#8FD4AE] shrink-0">
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Skapa</span>
          </span>
        </button>

        {/* Notes Feed */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="h-44 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] animate-pulse"
              />
            ))}
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#18221C]/15 dark:border-[#E3EAE5]/15 py-14 px-6 text-center flex flex-col items-center gap-3 max-w-lg mx-auto my-4">
            <h2 className="font-display text-lg font-semibold">
              {searchQuery || onlyReminders || activeCategory !== 'Alla'
                ? 'Inga matchande anteckningar'
                : 'Inga anteckningar ännu'}
            </h2>
            <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
              {searchQuery || onlyReminders || activeCategory !== 'Alla'
                ? 'Prova att ändra sökord eller välj en annan kategori.'
                : 'Skapa din första anteckning med påminnelse eller importera ett mejl från Gmail eller Outlook.'}
            </p>
            <div className="flex items-center gap-2.5 pt-2 flex-wrap justify-center">
              {(searchQuery || onlyReminders || activeCategory !== 'Alla') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setOnlyReminders(false);
                    setActiveCategory(FILTER_TABS[0]);
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-medium cursor-pointer"
                >
                  Visa alla
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenNewNote}
                className="min-h-[40px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-sm font-semibold cursor-pointer"
              >
                Ny anteckning
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {pinnedNotes.length > 0 && (
              <section aria-labelledby="pinned-heading" className="flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                  <h2 id="pinned-heading">Fästa anteckningar</h2>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tabular">{pinnedNotes.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
                  {pinnedNotes.map((note) => renderNoteWithShareBadge(note))}
                </div>
              </section>
            )}

            {otherNotes.length > 0 && (
              <section aria-labelledby="others-heading" className="flex flex-col gap-3">
                {pinnedNotes.length > 0 && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                    <h2 id="others-heading">Övriga anteckningar</h2>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">{otherNotes.length}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 items-start">
                  {otherNotes.map((note) => renderNoteWithShareBadge(note))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* Mobile Floating Action Button (Thumb Zone, compact <= 15% sticky budget) */}
      <button
        type="button"
        onClick={handleOpenNewNote}
        aria-label="Ny anteckning"
        className="sm:hidden fixed bottom-5 right-5 z-30 inline-flex items-center justify-center gap-2 h-14 px-5 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] shadow-lg font-semibold text-sm active:scale-95 transition-transform cursor-pointer"
      >
        <Plus className="w-5 h-5" aria-hidden="true" />
        <span>Ny anteckning</span>
      </button>

      {/* Undo Delete Snackbar */}
      {deletedUndo && (
        <div
          role="status"
          className="fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-40 rounded-2xl bg-[#171D19] dark:bg-[#E4EBE6] text-[#F6F7F4] dark:text-[#111412] px-4 py-3 shadow-xl flex items-center gap-4 text-sm"
        >
          <span className="whitespace-nowrap">Anteckning borttagen</span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="font-semibold text-[#8FD4AE] dark:text-[#2E6B4E] hover:underline whitespace-nowrap cursor-pointer"
          >
            Ångra
          </button>
          <button
            type="button"
            onClick={() => setDeletedUndo(null)}
            aria-label="Stäng"
            className="opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Create / Edit Note Modal */}
      <NoteEditorModal
        isOpen={editorOpen}
        initialNote={editingNote}
        defaultCategory={defaultNewCategory}
        onClose={() => {
          setEditorOpen(false);
          setEditingNote(null);
        }}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
      />

      {/* Email Import & Gmail/Outlook Preparation Modal */}
      <EmailImportModal
        isOpen={emailModalOpen}
        configs={emailConfigs}
        onClose={() => setEmailModalOpen(false)}
        onImportNote={handleImportEmailNote}
        onSaveConfig={handleSaveEmailConfig}
      />

      {/* Household & Account Modal */}
      <HouseholdModal
        open={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userEmail={userEmail}
        household={household}
        onHouseholdUpdated={async () => {
          if (userEmail) {
            await syncFromCloud(userEmail);
          }
        }}
      />
    </div>
  );
}
