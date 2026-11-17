import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  Clock,
  Lock,
  MessageCircle,
  Package,
  Plus,
  Search,
  ShoppingCart,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import { CategoryTabs } from './components/CategoryTabs';
import { EmailImportModal } from './components/EmailImportModal';
import { HouseholdCalendar, HouseholdEvent } from './components/HouseholdCalendar';
import {
  HouseholdChat,
  HouseholdMessage,
  OutgoingChatPayload,
} from './components/HouseholdChat';
import { HouseholdModal } from './components/HouseholdModal';
import { MailManager } from './components/MailManager';
import { NoteCard } from './components/NoteCard';
import { NoteEditorModal } from './components/NoteEditorModal';
import { SettingsModal } from './components/SettingsModal';
import { ShoppingList, ShoppingWriteContext } from './components/ShoppingList';
import { TopBar } from './components/TopBar';
import { UpdateBanner } from './components/UpdateBanner';
import {
  decryptText,
  encryptBlob,
  encryptText,
  resolveHouseholdSecret,
} from './services/crypto';
import {
  DEFAULT_STORES,
  RawShoppingItem,
  RawShoppingPreset,
  ShoppingDepartment,
  ShoppingItem,
  ShoppingPreset,
  categorizeShoppingItem,
  hasShoppingPrefix,
  normalizeDepartment,
  parseShoppingCommand,
} from './services/shoppingParser';
import {
  MailItem,
  MailShareFilter,
  ParsedMailDraft,
  RawMailItem,
  SharedContentPayload,
  decryptMailItem,
  encryptMailDraft,
} from './services/mailService';
import { UpdateCheckResult } from './services/updater';
import {
  SnoozePreset,
  cancelCalendarEventNotifications,
  cancelNoteReminderNotification,
  computeSnoozeDate,
  ensureHighPriorityNotificationChannel,
  formatReminderDateTime,
  notifyIncomingChatMessage,
  notifyShoppingListCompleted,
  scheduleCalendarEventNotifications,
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
  NoteShareFilter,
} from './types/note';

function generateNoteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function safeDecryptShoppingField(
  value: string | null | undefined,
  isEncrypted: boolean | undefined,
  secret: string | null
): Promise<string> {
  if (!value) return '';
  if (isEncrypted === false) return value;
  if (!secret) return isEncrypted ? 'Låst' : value;
  try {
    return await decryptText(value, secret);
  } catch {
    return value;
  }
}

const STORE_COORDS_STORAGE_KEY = 'betterkeep_store_coords_v1';
const SHOPPING_DATES_STORAGE_KEY = 'betterkeep_shopping_dates_v1';
const SHOPPING_CAL_EVENTS_KEY = 'betterkeep_shopping_cal_events_v1';
const MAIL_CAL_EVENTS_KEY = 'betterkeep_mail_cal_events_v1';

function readJsonMap(storageKey: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeJsonMapEntry(
  storageKey: string,
  entryKey: string,
  value: string | null
): Record<string, string> {
  const current = readJsonMap(storageKey);
  if (value) {
    current[entryKey] = value;
  } else {
    delete current[entryKey];
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(current));
  } catch {
    // Ignore storage errors
  }
  return current;
}

function saveLocalStoreCoords(
  storeName: string,
  lat: number | null | undefined,
  lng: number | null | undefined
): void {
  if (!storeName.trim() || typeof lat !== 'number' || typeof lng !== 'number') return;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  try {
    const raw = localStorage.getItem(STORE_COORDS_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, { lat: number; lng: number }>) : {};
    map[storeName.trim().toLowerCase()] = { lat, lng };
    localStorage.setItem(STORE_COORDS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

function getLocalStoreCoords(storeName: string): { lat: number; lng: number } | null {
  if (!storeName.trim()) return null;
  try {
    const raw = localStorage.getItem(STORE_COORDS_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { lat: number; lng: number }>;
    const found = map[storeName.trim().toLowerCase()];
    if (
      found &&
      typeof found.lat === 'number' &&
      typeof found.lng === 'number' &&
      Number.isFinite(found.lat) &&
      Number.isFinite(found.lng)
    ) {
      return found;
    }
    return null;
  } catch {
    return null;
  }
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [activeTab, setActiveTab] = useState<'notes' | 'shopping' | 'mail' | 'calendar' | 'chat'>('notes');
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    try {
      return Boolean(
        typeof window !== 'undefined' &&
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    } catch {
      return false;
    }
  });
  const [activeCategory, setActiveCategory] = useState<FilterCategory>('Alla');
  const [noteShareFilter, setNoteShareFilter] = useState<NoteShareFilter>('all');
  const [onlyReminders, setOnlyReminders] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

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
  const [rawShoppingItems, setRawShoppingItems] = useState<RawShoppingItem[]>([]);
  const [rawShoppingPresets, setRawShoppingPresets] = useState<RawShoppingPreset[]>([]);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);
  const [shoppingPresets, setShoppingPresets] = useState<ShoppingPreset[]>([]);
  const [rawMailItems, setRawMailItems] = useState<RawMailItem[]>([]);
  const [mailItems, setMailItems] = useState<MailItem[]>([]);
  const [pendingSharedContent, setPendingSharedContent] =
    useState<SharedContentPayload | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [passphraseVersion, setPassphraseVersion] = useState(0);
  const [latestRelease, setLatestRelease] = useState<UpdateCheckResult | null>(null);

  const [deletedUndo, setDeletedUndo] = useState<Note | null>(null);
  const [dueBannerNote, setDueBannerNote] = useState<Note | null>(null);
  const [calendarBanner, setCalendarBanner] = useState<HouseholdEvent | null>(null);
  const [chatBanner, setChatBanner] = useState<HouseholdMessage | null>(null);
  const [shoppingDoneBanner, setShoppingDoneBanner] = useState<{
    actorName: string;
    at: string;
  } | null>(null);
  const [localStoreDates, setLocalStoreDates] = useState<Record<string, string>>(() =>
    readJsonMap(SHOPPING_DATES_STORAGE_KEY)
  );
  const [shoppingNavRequest, setShoppingNavRequest] = useState<{
    storeName: string;
    nonce: number;
  } | null>(null);
  const [highlightedMailRequest, setHighlightedMailRequest] = useState<{
    mailId: string;
    nonce: number;
  } | null>(null);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const undoTimerRef = useRef<number | null>(null);
  const activeTabRef = useRef<'notes' | 'shopping' | 'mail' | 'calendar' | 'chat'>('notes');
  const householdRef = useRef<HouseholdInfo | null>(null);
  const householdEventsRef = useRef<HouseholdEvent[]>([]);
  const shoppingItemsRef = useRef<ShoppingItem[]>([]);
  const mailItemsRef = useRef<MailItem[]>([]);
  const lastHandledShareIdRef = useRef<string | null>(null);

  useEffect(() => {
    householdRef.current = household;
  }, [household]);

  useEffect(() => {
    householdEventsRef.current = householdEvents;
  }, [householdEvents]);

  useEffect(() => {
    shoppingItemsRef.current = shoppingItems;
  }, [shoppingItems]);

  const encryptionSecret = useMemo(
    () => (household ? resolveHouseholdSecret(household) : null),
    [household, passphraseVersion]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      const decrypted = await Promise.all(
        rawShoppingItems.map(async (raw) => {
          const rawLabel = raw.label ?? raw.title ?? '';
          const label = await safeDecryptShoppingField(
            rawLabel,
            raw.is_encrypted,
            encryptionSecret
          );
          const storeName = await safeDecryptShoppingField(
            raw.store_name,
            raw.is_encrypted,
            encryptionSecret
          );
          const storeAddress = await safeDecryptShoppingField(
            raw.store_address,
            raw.is_encrypted,
            encryptionSecret
          );
          const department = raw.department
            ? normalizeDepartment(raw.department)
            : categorizeShoppingItem(label);

          return {
            id: raw.id,
            household_id: raw.household_id,
            label,
            store_name: storeName,
            store_address: storeAddress,
            department,
            checked: Boolean(raw.checked),
            planned_date: raw.planned_date ?? null,
            is_encrypted: raw.is_encrypted,
            created_by: raw.created_by ?? raw.added_by ?? '',
            created_at: raw.created_at,
          } satisfies ShoppingItem;
        })
      );
      if (active) setShoppingItems(decrypted);
    })();
    return () => {
      active = false;
    };
  }, [rawShoppingItems, encryptionSecret]);

  useEffect(() => {
    let active = true;
    (async () => {
      const decrypted = await Promise.all(
        rawShoppingPresets.map(async (raw) => {
          const label = await safeDecryptShoppingField(
            raw.label,
            raw.is_encrypted,
            encryptionSecret
          );
          const storeName = await safeDecryptShoppingField(
            raw.store_name,
            raw.is_encrypted,
            encryptionSecret
          );
          const storeAddress = await safeDecryptShoppingField(
            raw.store_address,
            raw.is_encrypted,
            encryptionSecret
          );
          const department = raw.department
            ? normalizeDepartment(raw.department)
            : categorizeShoppingItem(label);

          const dbLat =
            typeof raw.lat === 'number' && Number.isFinite(raw.lat) ? raw.lat : null;
          const dbLng =
            typeof raw.lng === 'number' && Number.isFinite(raw.lng) ? raw.lng : null;
          const fallbackCoords =
            dbLat === null || dbLng === null
              ? getLocalStoreCoords(storeName || label)
              : null;

          return {
            id: raw.id,
            household_id: raw.household_id,
            preset_type: raw.preset_type,
            label,
            store_name: storeName,
            store_address: storeAddress,
            department,
            lat: dbLat ?? fallbackCoords?.lat ?? null,
            lng: dbLng ?? fallbackCoords?.lng ?? null,
            is_encrypted: raw.is_encrypted,
            created_by: raw.created_by ?? raw.added_by ?? undefined,
            created_at: raw.created_at,
          } satisfies ShoppingPreset;
        })
      );
      if (active) setShoppingPresets(decrypted);
    })();
    return () => {
      active = false;
    };
  }, [rawShoppingPresets, encryptionSecret]);

  const knownStoreNames = useMemo(() => {
    const set = new Set<string>(DEFAULT_STORES);
    for (const p of shoppingPresets) {
      if (p.preset_type === 'store') {
        const name = (p.store_name || p.label).trim();
        if (name) set.add(name);
      }
    }
    for (const item of shoppingItems) {
      if (item.store_name.trim()) set.add(item.store_name.trim());
    }
    return Array.from(set);
  }, [shoppingPresets, shoppingItems]);

  const storePlannedDates = useMemo(() => {
    const map: Record<string, string> = { ...localStoreDates };
    for (const ev of householdEvents) {
      const title = (ev.title || '').trim();
      const match = title.match(/^🛒\s*Handla på\s+(.+?)(?:\s*\(\d+\s*varor?\))?$/i);
      if (match) {
        const key = match[1].trim().toLowerCase();
        if (!map[key]) map[key] = ev.event_date;
      } else if (/^🛒\s*Handla\s*\(\d+\s*varor?\)$/i.test(title)) {
        if (!map['']) map[''] = ev.event_date;
      }
    }
    for (const item of shoppingItems) {
      if (!item.checked && item.planned_date) {
        map[item.store_name.trim().toLowerCase()] = item.planned_date;
      }
    }
    return map;
  }, [localStoreDates, householdEvents, shoppingItems]);

  useEffect(() => {
    mailItemsRef.current = mailItems;
  }, [mailItems]);

  useEffect(() => {
    let active = true;
    (async () => {
      const decrypted = await Promise.all(
        rawMailItems.map((raw) => decryptMailItem(raw, encryptionSecret))
      );
      if (active) setMailItems(decrypted);
    })();
    return () => {
      active = false;
    };
  }, [rawMailItems, encryptionSecret]);

  const activeMailCount = useMemo(
    () => mailItems.filter((m) => !m.completed).length,
    [mailItems]
  );

  const uncheckedShoppingCount = useMemo(
    () => shoppingItems.filter((item) => !item.checked).length,
    [shoppingItems]
  );

  useEffect(() => {
    ensureHighPriorityNotificationChannel();
  }, []);

  // Listen for Android Share Target payloads (app-shared-content CustomEvent + cold-start bridge)
  useEffect(() => {
    const acceptSharedPayload = (payload: SharedContentPayload | null | undefined) => {
      if (!payload || (payload.type !== 'image' && payload.type !== 'text')) return;
      const dedupeKey =
        payload.shareId !== undefined
          ? String(payload.shareId)
          : `${payload.type}:${(payload.base64 || payload.text || '').slice(0, 48)}`;
      if (lastHandledShareIdRef.current === dedupeKey) return;
      lastHandledShareIdRef.current = dedupeKey;

      setShowSplash(false);
      setActiveTab('mail');
      setPendingSharedContent(payload);
    };

    const onSharedEvent = (ev: Event) => {
      const customEv = ev as CustomEvent<SharedContentPayload>;
      acceptSharedPayload(customEv.detail);
    };

    window.addEventListener('app-shared-content', onSharedEvent);

    try {
      const nativeBridge = (
        window as unknown as {
          BetterKeepNativeShare?: { consumePendingShare?: () => string | null };
        }
      ).BetterKeepNativeShare;
      const pendingJson = nativeBridge?.consumePendingShare?.();
      if (pendingJson) {
        const parsed = JSON.parse(pendingJson) as SharedContentPayload;
        acceptSharedPayload(parsed);
      }
    } catch {
      // Ignore malformed native share payload
    }

    return () => {
      window.removeEventListener('app-shared-content', onSharedEvent);
    };
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
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effectiveTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    saveTheme(theme);
  }, [theme, effectiveTheme]);

  const fetchHouseholdEvents = useCallback(
    async (householdId: string, currentUserEmail?: string | null) => {
      const { data, error } = await supabase
        .from('household_events')
        .select('*')
        .eq('household_id', householdId)
        .order('event_date', { ascending: true });
      if (!error && data) {
        const myEmail = (currentUserEmail ?? '').toLowerCase();
        const visibleEvents = (data as HouseholdEvent[]).filter(
          (ev) => !ev.is_private || ev.created_by.toLowerCase() === myEmail
        );
        setHouseholdEvents(visibleEvents);
        for (const ev of visibleEvents) {
          await scheduleCalendarEventNotifications(ev, false, myEmail);
        }
      }
    },
    []
  );

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

  const fetchHouseholdShoppingItems = useCallback(async (householdId: string) => {
    const { data, error } = await supabase
      .from('household_shopping_items')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      setRawShoppingItems(data as RawShoppingItem[]);
    }
  }, []);

  const fetchHouseholdShoppingPresets = useCallback(async (householdId: string) => {
    const { data, error } = await supabase
      .from('household_shopping_presets')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      setRawShoppingPresets(data as RawShoppingPreset[]);
    }
  }, []);

  const fetchHouseholdMailItems = useCallback(
    async (householdId: string, currentUserEmail?: string | null) => {
      const { data, error } = await supabase
        .from('household_mail_items')
        .select('*')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false });
      if (!error && data) {
        const myEmail = (currentUserEmail ?? '').toLowerCase();
        const visible = (data as RawMailItem[]).filter(
          (item) => !item.is_private || item.created_by.toLowerCase() === myEmail
        );
        setRawMailItems(visible);
      }
    },
    []
  );

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
            fetchHouseholdEvents(hh.id, email),
            fetchHouseholdMessages(hh.id),
            fetchHouseholdShoppingItems(hh.id),
            fetchHouseholdShoppingPresets(hh.id),
            fetchHouseholdMailItems(hh.id, email),
          ]);
        } else {
          setHouseholdEvents([]);
          setHouseholdMessages([]);
          setRawShoppingItems([]);
          setRawShoppingPresets([]);
          setShoppingItems([]);
          setShoppingPresets([]);
          setRawMailItems([]);
          setMailItems([]);
        }

        const sharedIds = new Set<string>();
        const mergedMap = new Map<string, Note>();

        const localNotes = await loadAllNotes();
        for (const ln of localNotes) {
          mergedMap.set(ln.id, ln);
        }

        for (const rec of cloudRecords) {
          if (
            rec.data?.isPrivate &&
            rec.owner_email.toLowerCase() !== email.toLowerCase()
          ) {
            continue;
          }
          if (rec.household_id && !rec.data?.isPrivate) sharedIds.add(rec.id);
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
            const hhToUse = ln.isPrivate ? null : (hh?.id ?? null);
            await upsertCloudNote(ln, email, hhToUse);
            if (hhToUse) sharedIds.add(ln.id);
          }
        }

        setSharedNoteIds(sharedIds);
        setNotes(Array.from(mergedMap.values()));
      } catch {
        // Offline fallback
      }
    },
    [
      fetchHouseholdEvents,
      fetchHouseholdMessages,
      fetchHouseholdShoppingItems,
      fetchHouseholdShoppingPresets,
      fetchHouseholdMailItems,
    ]
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
        setRawShoppingItems([]);
        setRawShoppingPresets([]);
        setShoppingItems([]);
        setShoppingPresets([]);
        setRawMailItems([]);
        setMailItems([]);
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
            if (
              rec.data.isPrivate &&
              rec.owner_email.toLowerCase() !== userEmail.toLowerCase()
            ) {
              return;
            }

            setNotes((prev) => {
              const exists = prev.some((n) => n.id === rec.id);
              return exists
                ? prev.map((n) => (n.id === rec.id ? rec.data : n))
                : [rec.data, ...prev];
            });
            setSharedNoteIds((prev) => {
              const next = new Set(prev);
              if (rec.household_id && !rec.data.isPrivate) next.add(rec.id);
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
              await cancelCalendarEventNotifications(deletedId);
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const ev = payload.new as HouseholdEvent;
            if (!ev?.id) return;
            const isMine = ev.created_by.toLowerCase() === userEmail.toLowerCase();
            if (ev.is_private && !isMine) {
              return;
            }
            setHouseholdEvents((prev) => {
              const exists = prev.some((item) => item.id === ev.id);
              return exists ? prev.map((item) => (item.id === ev.id ? ev : item)) : [...prev, ev];
            });
            const isFromPartner =
              payload.eventType === 'INSERT' && !isMine && !ev.is_private;
            if (isFromPartner) {
              setCalendarBanner(ev);
            }
            await scheduleCalendarEventNotifications(ev, isFromPartner, userEmail);
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
            let previewBody = msg.body;
            if (msg.is_encrypted) {
              const currentHousehold = householdRef.current;
              const secret = currentHousehold ? resolveHouseholdSecret(currentHousehold) : null;
              if (secret && msg.body) {
                try {
                  previewBody = await decryptText(msg.body, secret);
                } catch {
                  previewBody = 'Nytt krypterat meddelande';
                }
              } else if (!msg.body && msg.attachment_type) {
                previewBody =
                  msg.attachment_type === 'image'
                    ? 'Skickade en krypterad bild'
                    : msg.attachment_type === 'audio'
                      ? 'Skickade ett röstmeddelande'
                      : 'Skickade en krypterad fil';
              } else {
                previewBody = 'Nytt krypterat meddelande';
              }
            }
            if (!previewBody && msg.attachment_type) {
              previewBody =
                msg.attachment_type === 'image'
                  ? 'Skickade en bild'
                  : msg.attachment_type === 'audio'
                    ? 'Skickade ett röstmeddelande'
                    : 'Skickade en fil';
            }
            const notificationMsg: HouseholdMessage = { ...msg, body: previewBody };
            const completedMatch = previewBody.match(
              /^✅\s*Inköpslistan är klar!\s*\(Utfört av ([^)]+)\)/i
            );
            if (completedMatch) {
              const actorName = completedMatch[1].trim() || msg.sender_email.split('@')[0];
              setShoppingDoneBanner({ actorName, at: msg.created_at });
              if (activeTabRef.current !== 'chat') {
                setUnreadChatCount((c) => c + 1);
              }
              await notifyShoppingListCompleted(msg.id, actorName);
            } else {
              if (activeTabRef.current !== 'chat') {
                setUnreadChatCount((c) => c + 1);
                setChatBanner(notificationMsg);
              }
              await notifyIncomingChatMessage(notificationMsg);
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_shopping_items' },
        (payload) => {
          const currentHhId = householdRef.current?.id;
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setRawShoppingItems((prev) => prev.filter((item) => item.id !== deletedId));
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const item = payload.new as RawShoppingItem;
            if (!item?.id) return;
            if (currentHhId && item.household_id !== currentHhId) return;
            setRawShoppingItems((prev) => {
              const exists = prev.some((i) => i.id === item.id);
              return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [...prev, item];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_shopping_presets' },
        (payload) => {
          const currentHhId = householdRef.current?.id;
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setRawShoppingPresets((prev) => prev.filter((p) => p.id !== deletedId));
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const preset = payload.new as RawShoppingPreset;
            if (!preset?.id) return;
            if (currentHhId && preset.household_id !== currentHhId) return;
            setRawShoppingPresets((prev) => {
              const exists = prev.some((p) => p.id === preset.id);
              return exists
                ? prev.map((p) => (p.id === preset.id ? preset : p))
                : [...prev, preset];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_mail_items' },
        (payload) => {
          const currentHhId = householdRef.current?.id;
          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setRawMailItems((prev) => prev.filter((item) => item.id !== deletedId));
            }
          } else if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const item = payload.new as RawMailItem;
            if (!item?.id) return;
            if (currentHhId && item.household_id !== currentHhId) return;
            const isMine = item.created_by.toLowerCase() === userEmail.toLowerCase();
            if (item.is_private && !isMine) return;
            setRawMailItems((prev) => {
              const exists = prev.some((i) => i.id === item.id);
              return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [item, ...prev];
            });
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
              fetchHouseholdEvents(hh.id, userEmail),
              fetchHouseholdMessages(hh.id),
              fetchHouseholdShoppingItems(hh.id),
              fetchHouseholdShoppingPresets(hh.id),
              fetchHouseholdMailItems(hh.id, userEmail),
            ]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    userEmail,
    fetchHouseholdEvents,
    fetchHouseholdMessages,
    fetchHouseholdShoppingItems,
    fetchHouseholdShoppingPresets,
    fetchHouseholdMailItems,
  ]);

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
        setSettingsModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const resolveShoppingContext = useCallback(
    async (context?: ShoppingWriteContext): Promise<ShoppingWriteContext> => {
      let activeEmail = (context?.userEmail || userEmail || '').trim().toLowerCase();
      if (!activeEmail) {
        const { data: sessionData, error: sessionError } = await supabase.auth.getUser();
        if (sessionError) throw sessionError;
        activeEmail = sessionData.user?.email?.trim().toLowerCase() ?? '';
      }
      if (!activeEmail) {
        throw new Error('Användarens e-post (added_by) saknas.');
      }

      let activeHouseholdId = (context?.householdId || household?.id || '').trim();
      let resolvedSecret = (context?.secret || '').trim();

      if (!activeHouseholdId) {
        const activeHh = await getUserHousehold(activeEmail);
        if (activeHh?.id) {
          activeHouseholdId = activeHh.id;
          if (!resolvedSecret && activeHh.encryption_secret) {
            resolvedSecret = resolveHouseholdSecret(activeHh);
          }
        }
      }

      if (!activeHouseholdId) {
        throw new Error('Aktivt household_id saknas.');
      }

      if (!resolvedSecret) {
        if (household?.id === activeHouseholdId && household.encryption_secret) {
          resolvedSecret = resolveHouseholdSecret(household);
        } else {
          const { data: hhRow, error: hhError } = await supabase
            .from('households')
            .select('encryption_secret')
            .eq('id', activeHouseholdId)
            .maybeSingle();
          if (hhError) throw hhError;
          resolvedSecret = resolveHouseholdSecret({
            id: activeHouseholdId,
            encryption_secret: hhRow?.encryption_secret ?? null,
          });
        }
      }

      return {
        householdId: activeHouseholdId,
        userEmail: activeEmail,
        secret: resolvedSecret,
      };
    },
    [userEmail, household]
  );

  const findShoppingCalendarEvent = useCallback(
    (storeName: string, currentEvents: HouseholdEvent[]): HouseholdEvent | undefined => {
      const storeKey = storeName.trim().toLowerCase();
      const linkedMap = readJsonMap(SHOPPING_CAL_EVENTS_KEY);
      const mappedId = linkedMap[storeKey];
      if (mappedId) {
        const byId = currentEvents.find((e) => e.id === mappedId);
        if (byId) return byId;
      }
      return currentEvents.find((ev) => {
        const t = (ev.title || '').trim();
        if (storeKey) {
          const m1 = t.match(/^🛒\s*Handla på\s+(.+?)(?:\s*\(\d+\s*varor?\))?$/i);
          if (m1 && m1[1].trim().toLowerCase() === storeKey) return true;
          const m2 = t.match(/^✅\s*Handlat klart på\s+(.+)$/i);
          if (m2 && m2[1].trim().toLowerCase() === storeKey) return true;
        } else {
          if (/^(?:🛒\s*Handla\s*\(\d+\s*varor?\)|✅\s*Handlat klart)$/i.test(t)) {
            return true;
          }
        }
        return false;
      });
    },
    []
  );

  const syncShoppingCalendarEvent = useCallback(
    async (
      storeName: string,
      plannedDate: string | null,
      uncheckedCount: number,
      completed: boolean,
      overrideContext?: { householdId: string; userEmail: string }
    ) => {
      const activeHhId = overrideContext?.householdId || householdRef.current?.id || '';
      const activeEmail = overrideContext?.userEmail || userEmail || '';
      if (!activeHhId || !activeEmail) return;

      const cleanStore = storeName.trim();
      const storeKey = cleanStore.toLowerCase();
      const existingEv = findShoppingCalendarEvent(cleanStore, householdEventsRef.current);

      if (completed) {
        const nextMap = writeJsonMapEntry(SHOPPING_DATES_STORAGE_KEY, storeKey, null);
        setLocalStoreDates(nextMap);
        if (!existingEv) return;

        const doneTitle = cleanStore
          ? `✅ Handlat klart på ${cleanStore}`
          : '✅ Handlat klart';
        const { data, error } = await supabase
          .from('household_events')
          .update({
            title: doneTitle,
            notes: 'Alla varor är avbockade i inköpslistan.',
          })
          .eq('id', existingEv.id)
          .select()
          .single();

        if (!error && data) {
          const updated = data as HouseholdEvent;
          setHouseholdEvents((prev) =>
            prev.map((e) => (e.id === updated.id ? updated : e))
          );
          await cancelCalendarEventNotifications(updated.id);
        }
        return;
      }

      if (!plannedDate) {
        if (existingEv && existingEv.title.trim().startsWith('🛒')) {
          setHouseholdEvents((prev) => prev.filter((e) => e.id !== existingEv.id));
          await supabase.from('household_events').delete().eq('id', existingEv.id);
          await cancelCalendarEventNotifications(existingEv.id);
          writeJsonMapEntry(SHOPPING_CAL_EVENTS_KEY, storeKey, null);
        }
        return;
      }

      const activeTitle = cleanStore
        ? `🛒 Handla på ${cleanStore} (${uncheckedCount} varor)`
        : `🛒 Handla (${uncheckedCount} varor)`;
      const activeNotes = cleanStore
        ? `Planerat inköp på ${cleanStore} · Tryck för att öppna listan`
        : 'Planerat inköp · Tryck för att öppna listan';

      if (existingEv) {
        const { data, error } = await supabase
          .from('household_events')
          .update({
            title: activeTitle,
            notes: activeNotes,
            event_date: plannedDate,
            event_time: null,
            remind_before_minutes: 0,
            is_private: false,
          })
          .eq('id', existingEv.id)
          .select()
          .single();

        if (!error && data) {
          const updated = data as HouseholdEvent;
          setHouseholdEvents((prev) =>
            prev.map((e) => (e.id === updated.id ? updated : e))
          );
          writeJsonMapEntry(SHOPPING_CAL_EVENTS_KEY, storeKey, updated.id);
          await scheduleCalendarEventNotifications(updated, false, activeEmail);
        }
        return;
      }

      const { data, error } = await supabase
        .from('household_events')
        .insert({
          household_id: activeHhId,
          created_by: activeEmail,
          title: activeTitle,
          notes: activeNotes,
          event_date: plannedDate,
          event_time: null,
          remind_before_minutes: 0,
          is_private: false,
        })
        .select()
        .single();

      if (!error && data) {
        const created = data as HouseholdEvent;
        setHouseholdEvents((prev) =>
          prev.some((e) => e.id === created.id) ? prev : [...prev, created]
        );
        writeJsonMapEntry(SHOPPING_CAL_EVENTS_KEY, storeKey, created.id);
        await scheduleCalendarEventNotifications(created, false, activeEmail);
      }
    },
    [userEmail, findShoppingCalendarEvent]
  );

  const handleScheduleShoppingDate = useCallback(
    async (storeName: string, dateYmd: string | null) => {
      const { householdId: activeHouseholdId, userEmail: activeEmail } =
        await resolveShoppingContext();
      const cleanStore = storeName.trim();
      const storeKey = cleanStore.toLowerCase();

      const nextDates = writeJsonMapEntry(
        SHOPPING_DATES_STORAGE_KEY,
        storeKey,
        dateYmd
      );
      setLocalStoreDates(nextDates);

      const matchingIds = shoppingItemsRef.current
        .filter((i) => !i.checked && i.store_name.trim().toLowerCase() === storeKey)
        .map((i) => i.id);

      if (matchingIds.length > 0) {
        setShoppingItems((prev) =>
          prev.map((i) =>
            matchingIds.includes(i.id) ? { ...i, planned_date: dateYmd } : i
          )
        );
        setRawShoppingItems((prev) =>
          prev.map((i) =>
            matchingIds.includes(i.id) ? { ...i, planned_date: dateYmd } : i
          )
        );
        const { error: updateErr } = await supabase
          .from('household_shopping_items')
          .update({ planned_date: dateYmd })
          .in('id', matchingIds);
        if (updateErr && !/planned_date/i.test(updateErr.message)) {
          throw updateErr;
        }
      }

      await syncShoppingCalendarEvent(
        cleanStore,
        dateYmd,
        matchingIds.length,
        false,
        { householdId: activeHouseholdId, userEmail: activeEmail }
      );
    },
    [resolveShoppingContext, syncShoppingCalendarEvent]
  );

  const handleAddShoppingItems = useCallback(
    async (
      rawText: string,
      storeNameOverride?: string,
      departmentOverride?: ShoppingDepartment,
      context?: ShoppingWriteContext,
      plannedDateOverride?: string | null
    ): Promise<number> => {
      const {
        householdId: activeHouseholdId,
        userEmail: activeEmail,
        secret,
      } = await resolveShoppingContext(context);

      const parsed = parseShoppingCommand(rawText, knownStoreNames);
      if (parsed.items.length === 0) return 0;

      const resolvedStoreName = (
        storeNameOverride !== undefined ? storeNameOverride : parsed.storeName
      ).trim();
      const storeKey = resolvedStoreName.toLowerCase();

      const effectivePlannedDate =
        parsed.plannedDate ??
        plannedDateOverride ??
        localStoreDates[storeKey] ??
        null;

      if (effectivePlannedDate) {
        const nextDates = writeJsonMapEntry(
          SHOPPING_DATES_STORAGE_KEY,
          storeKey,
          effectivePlannedDate
        );
        setLocalStoreDates(nextDates);
      }

      const matchingStorePreset = resolvedStoreName
        ? shoppingPresets.find(
            (p) =>
              p.preset_type === 'store' &&
              (p.store_name || p.label).trim().toLowerCase() === storeKey
          )
        : undefined;
      const resolvedStoreAddress = matchingStorePreset?.store_address.trim() ?? '';

      const existingUncheckedKeys = new Set(
        shoppingItemsRef.current
          .filter((i) => !i.checked)
          .map((i) => `${i.store_name.trim().toLowerCase()}::${i.label.trim().toLowerCase()}`)
      );

      const newItems = parsed.items.filter(
        (label) =>
          !existingUncheckedKeys.has(`${storeKey}::${label.trim().toLowerCase()}`)
      );

      if (newItems.length === 0) return 0;

      const encStoreName = resolvedStoreName
        ? await encryptText(resolvedStoreName, secret)
        : null;
      const encStoreAddress = resolvedStoreAddress
        ? await encryptText(resolvedStoreAddress, secret)
        : null;

      let candidateRows: Array<Record<string, unknown>> = await Promise.all(
        newItems.map(async (label) => ({
          household_id: activeHouseholdId,
          label: await encryptText(label, secret),
          store_name: encStoreName,
          store_address: encStoreAddress,
          department: departmentOverride ?? categorizeShoppingItem(label),
          checked: false,
          ...(effectivePlannedDate ? { planned_date: effectivePlannedDate } : {}),
          is_encrypted: true,
          created_by: activeEmail,
        }))
      );

      let { data, error } = await supabase
        .from('household_shopping_items')
        .insert(candidateRows)
        .select();

      // Compatibility retries for legacy/variant schema columns (title, added_by, created_by, planned_date)
      for (let attempt = 0; attempt < 4 && error; attempt += 1) {
        const msg = error.message || '';
        let adjusted = false;

        if (/planned_date/i.test(msg) && 'planned_date' in candidateRows[0]) {
          candidateRows = candidateRows.map(({ planned_date: _omit, ...rest }) => rest);
          adjusted = true;
        }
        if (/title/i.test(msg) && !('title' in candidateRows[0])) {
          candidateRows = candidateRows.map((row) => ({ ...row, title: row.label }));
          adjusted = true;
        }
        if (/added_by/i.test(msg) && !('added_by' in candidateRows[0])) {
          candidateRows = candidateRows.map((row) => ({ ...row, added_by: activeEmail }));
          adjusted = true;
        }
        if (/created_by/i.test(msg) && 'created_by' in candidateRows[0]) {
          candidateRows = candidateRows.map(({ created_by: _omit, ...rest }) => ({
            ...rest,
            added_by: activeEmail,
          }));
          adjusted = true;
        }

        if (!adjusted) break;

        const retry = await supabase
          .from('household_shopping_items')
          .insert(candidateRows)
          .select();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      if (data && data.length > 0) {
        const created = data as RawShoppingItem[];
        setRawShoppingItems((prev) => {
          const existingIds = new Set(prev.map((i) => i.id));
          return [...prev, ...created.filter((c) => !existingIds.has(c.id))];
        });

        const existingStoreUnchecked = shoppingItemsRef.current.filter(
          (i) => !i.checked && i.store_name.trim().toLowerCase() === storeKey
        ).length;
        const totalStoreUnchecked = existingStoreUnchecked + created.length;

        const existingCalEv = findShoppingCalendarEvent(
          resolvedStoreName,
          householdEventsRef.current
        );
        const dateToSync =
          effectivePlannedDate ||
          (existingCalEv && !existingCalEv.title.trim().startsWith('✅')
            ? existingCalEv.event_date
            : null);

        if (dateToSync) {
          await syncShoppingCalendarEvent(
            resolvedStoreName,
            dateToSync,
            totalStoreUnchecked,
            false,
            { householdId: activeHouseholdId, userEmail: activeEmail }
          );
        }

        return created.length;
      }
      return 0;
    },
    [
      resolveShoppingContext,
      knownStoreNames,
      shoppingPresets,
      localStoreDates,
      findShoppingCalendarEvent,
      syncShoppingCalendarEvent,
    ]
  );

  const handleSendChatMessage = useCallback(
    async (payload: OutgoingChatPayload) => {
      if (!userEmail || !household?.id) return;
      const secret = resolveHouseholdSecret(household);

      let attachmentUrl: string | null = null;
      let attachmentType: 'image' | 'file' | 'audio' | null = null;
      let encryptedAttachmentName: string | null = null;

      if (payload.file) {
        const encryptedBlob = await encryptBlob(payload.file, secret);
        const storagePath = `${household.id}/${Date.now()}.enc`;
        const { error: uploadError } = await supabase.storage
          .from('household-media')
          .upload(storagePath, encryptedBlob, {
            contentType: 'application/octet-stream',
            upsert: false,
          });
        if (uploadError) {
          throw uploadError;
        }
        attachmentUrl = storagePath;
        attachmentType = payload.attachmentType ?? 'file';
        encryptedAttachmentName = await encryptText(
          payload.originalName || 'bilaga',
          secret
        );
      }

      const cleanText = payload.text.trim();
      const encryptedBody = cleanText ? await encryptText(cleanText, secret) : '';

      const { data, error } = await supabase
        .from('household_messages')
        .insert({
          household_id: household.id,
          sender_email: userEmail,
          body: encryptedBody,
          is_encrypted: true,
          attachment_url: attachmentUrl,
          attachment_type: attachmentType,
          attachment_name: encryptedAttachmentName,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        const created = data as HouseholdMessage;
        setHouseholdMessages((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [...prev, created]
        );
      }

      if (cleanText && hasShoppingPrefix(cleanText)) {
        await handleAddShoppingItems(cleanText);
      }
    },
    [userEmail, household, handleAddShoppingItems]
  );

  const handleToggleShoppingItem = useCallback(
    async (item: ShoppingItem) => {
      if (!userEmail || !household?.id) return;
      const currentList = shoppingItemsRef.current;
      const uncheckedBefore = currentList.filter((i) => !i.checked).length;
      const nextChecked = !item.checked;
      const willFinishList =
        nextChecked &&
        !item.checked &&
        currentList.length >= 1 &&
        uncheckedBefore === 1;

      const storeKey = item.store_name.trim().toLowerCase();
      const storeItems = currentList.filter(
        (i) => i.store_name.trim().toLowerCase() === storeKey
      );
      const storeUncheckedAfter = storeItems.filter((i) =>
        i.id === item.id ? !nextChecked : !i.checked
      ).length;
      const willFinishStore =
        nextChecked && !item.checked && storeItems.length >= 1 && storeUncheckedAfter === 0;

      setShoppingItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: nextChecked } : i))
      );
      setRawShoppingItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, checked: nextChecked } : i))
      );

      const { error } = await supabase
        .from('household_shopping_items')
        .update({ checked: nextChecked })
        .eq('id', item.id);

      if (error) {
        setShoppingItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i))
        );
        setRawShoppingItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, checked: item.checked } : i))
        );
        throw error;
      }

      if (willFinishStore) {
        await syncShoppingCalendarEvent(item.store_name, null, 0, true);
      } else {
        const existingCalEv = findShoppingCalendarEvent(
          item.store_name,
          householdEventsRef.current
        );
        if (existingCalEv && storeUncheckedAfter > 0) {
          await syncShoppingCalendarEvent(
            item.store_name,
            existingCalEv.event_date,
            storeUncheckedAfter,
            false
          );
        }
      }

      if (willFinishList) {
        const actorName = userEmail.split('@')[0];
        setShoppingDoneBanner({ actorName, at: new Date().toISOString() });
        await handleSendChatMessage({
          text: `✅ Inköpslistan är klar! (Utfört av ${actorName})`,
        });
      }
    },
    [
      userEmail,
      household,
      handleSendChatMessage,
      findShoppingCalendarEvent,
      syncShoppingCalendarEvent,
    ]
  );

  const handleUpdateShoppingDepartment = useCallback(
    async (item: ShoppingItem, department: ShoppingDepartment) => {
      setShoppingItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, department } : i))
      );
      setRawShoppingItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, department } : i))
      );

      const { error } = await supabase
        .from('household_shopping_items')
        .update({ department })
        .eq('id', item.id);

      if (error) {
        setShoppingItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, department: item.department } : i
          )
        );
        setRawShoppingItems((prev) =>
          prev.map((i) =>
            i.id === item.id ? { ...i, department: item.department } : i
          )
        );
        throw error;
      }
    },
    []
  );

  const handleDeleteShoppingItem = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('household_shopping_items')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setShoppingItems((prev) => prev.filter((item) => item.id !== id));
    setRawShoppingItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleClearCheckedShoppingItems = useCallback(
    async (storeNameFilter?: string) => {
      if (!household?.id) return;
      const normalizedFilter = storeNameFilter?.trim().toLowerCase();
      const toClearIds = shoppingItemsRef.current
        .filter((item) => {
          if (!item.checked) return false;
          if (!normalizedFilter) return true;
          return item.store_name.trim().toLowerCase() === normalizedFilter;
        })
        .map((item) => item.id);

      if (toClearIds.length === 0) return;

      const { error } = await supabase
        .from('household_shopping_items')
        .delete()
        .in('id', toClearIds);
      if (error) throw error;

      const idSet = new Set(toClearIds);
      setShoppingItems((prev) => prev.filter((item) => !idSet.has(item.id)));
      setRawShoppingItems((prev) => prev.filter((item) => !idSet.has(item.id)));
    },
    [household]
  );

  const handleSaveShoppingPreset = useCallback(
    async (
      draft: {
        presetType: 'store' | 'staple';
        label: string;
        storeName?: string;
        storeAddress?: string;
        department?: ShoppingDepartment;
        lat?: number | null;
        lng?: number | null;
      },
      context?: ShoppingWriteContext
    ) => {
      const {
        householdId: activeHouseholdId,
        userEmail: activeEmail,
        secret,
      } = await resolveShoppingContext(context);

      const cleanLabel = draft.label.trim();
      if (!cleanLabel) return;

      const cleanStoreName = (
        draft.storeName ?? (draft.presetType === 'store' ? cleanLabel : '')
      ).trim();
      const cleanStoreAddress = (draft.storeAddress ?? '').trim();
      const department = draft.department ?? categorizeShoppingItem(cleanLabel);
      const validLat =
        typeof draft.lat === 'number' && Number.isFinite(draft.lat) ? draft.lat : null;
      const validLng =
        typeof draft.lng === 'number' && Number.isFinite(draft.lng) ? draft.lng : null;

      if (draft.presetType === 'store' && validLat !== null && validLng !== null) {
        saveLocalStoreCoords(cleanStoreName || cleanLabel, validLat, validLng);
      }

      const encLabel = await encryptText(cleanLabel, secret);
      const encStoreName = cleanStoreName
        ? await encryptText(cleanStoreName, secret)
        : null;
      const encStoreAddress = cleanStoreAddress
        ? await encryptText(cleanStoreAddress, secret)
        : null;

      // If updating an existing store or staple preset with the same name
      const existing = shoppingPresets.find(
        (p) =>
          p.preset_type === draft.presetType &&
          p.label.trim().toLowerCase() === cleanLabel.toLowerCase()
      );

      if (existing) {
        let updatePayload: Record<string, unknown> = {
          label: encLabel,
          store_name: encStoreName,
          store_address: encStoreAddress,
          department,
          is_encrypted: true,
          ...(validLat !== null && validLng !== null
            ? { lat: validLat, lng: validLng }
            : {}),
        };

        let { data, error } = await supabase
          .from('household_shopping_presets')
          .update(updatePayload)
          .eq('id', existing.id)
          .select()
          .single();

        if (error && (/\blat\b/i.test(error.message) || /\blng\b/i.test(error.message))) {
          const { lat: _l1, lng: _l2, ...restUpdate } = updatePayload;
          updatePayload = restUpdate;
          const retryUpdate = await supabase
            .from('household_shopping_presets')
            .update(updatePayload)
            .eq('id', existing.id)
            .select()
            .single();
          data = retryUpdate.data;
          error = retryUpdate.error;
        }

        if (error) throw error;
        if (data) {
          const updated = data as RawShoppingPreset;
          setRawShoppingPresets((prev) =>
            prev.map((p) => (p.id === updated.id ? updated : p))
          );
        }
        return;
      }

      let candidatePreset: Record<string, unknown> = {
        household_id: activeHouseholdId,
        preset_type: draft.presetType,
        label: encLabel,
        store_name: encStoreName,
        store_address: encStoreAddress,
        department,
        is_encrypted: true,
        created_by: activeEmail,
        ...(validLat !== null && validLng !== null
          ? { lat: validLat, lng: validLng }
          : {}),
      };

      let { data, error } = await supabase
        .from('household_shopping_presets')
        .insert(candidatePreset)
        .select()
        .single();

      for (let attempt = 0; attempt < 3 && error; attempt += 1) {
        const msg = error.message || '';
        let adjusted = false;

        if (/\blat\b/i.test(msg) || /\blng\b/i.test(msg)) {
          const { lat: _l1, lng: _l2, ...rest } = candidatePreset;
          candidatePreset = rest;
          adjusted = true;
        }
        if (/added_by/i.test(msg) && !('added_by' in candidatePreset)) {
          candidatePreset = { ...candidatePreset, added_by: activeEmail };
          adjusted = true;
        }
        if (/created_by/i.test(msg) && 'created_by' in candidatePreset) {
          const { created_by: _omit, ...rest } = candidatePreset;
          candidatePreset = { ...rest, added_by: activeEmail };
          adjusted = true;
        }

        if (!adjusted) break;

        const retry = await supabase
          .from('household_shopping_presets')
          .insert(candidatePreset)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      if (data) {
        const created = data as RawShoppingPreset;
        setRawShoppingPresets((prev) =>
          prev.some((p) => p.id === created.id) ? prev : [...prev, created]
        );
      }
    },
    [resolveShoppingContext, shoppingPresets]
  );

  const handleDeleteShoppingPreset = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('household_shopping_presets')
      .delete()
      .eq('id', id);
    if (error) throw error;
    setShoppingPresets((prev) => prev.filter((p) => p.id !== id));
    setRawShoppingPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleAddCalendarEvent = useCallback(
    async (draft: {
      title: string;
      notes: string;
      event_date: string;
      event_time: string;
      remind_before_minutes: number;
      is_private: boolean;
    }): Promise<HouseholdEvent | null> => {
      if (!userEmail || !household?.id) return null;
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
          is_private: draft.is_private,
        })
        .select()
        .single();

      if (!error && data) {
        const created = data as HouseholdEvent;
        setHouseholdEvents((prev) =>
          prev.some((e) => e.id === created.id) ? prev : [...prev, created]
        );
        await scheduleCalendarEventNotifications(created, false, userEmail);
        return created;
      }
      return null;
    },
    [userEmail, household]
  );

  const handleSaveMailItem = useCallback(
    async (draft: ParsedMailDraft) => {
      if (!userEmail || !household?.id) return;
      const secret = resolveHouseholdSecret(household);
      const encrypted = await encryptMailDraft(draft, secret);

      let calendarEventId: string | null = null;
      if (draft.due_date) {
        const senderLabel = draft.sender.trim() || draft.carrier.trim() || 'Post';
        const locPart = draft.pickup_location.trim()
          ? ` (${draft.pickup_location.trim()})`
          : '';
        const amtPart = draft.amount.trim() ? ` (${draft.amount.trim()})` : '';
        const title =
          draft.item_category === 'package'
            ? `📦 Sista hämtningsdag: ${senderLabel}${locPart}`
            : draft.item_category === 'invoice'
              ? `💳 Förfallodatum: ${senderLabel}${amtPart}`
              : `✉️ Viktigt brev: ${senderLabel}`;
        const safeNoteParts = [
          draft.carrier.trim(),
          draft.pickup_location.trim(),
          'Se krypterad detaljvy under fliken Post',
        ].filter(Boolean);

        const createdEv = await handleAddCalendarEvent({
          title,
          notes: safeNoteParts.join(' · '),
          event_date: draft.due_date,
          event_time: '09:00',
          remind_before_minutes: 0,
          is_private: draft.is_private,
        });
        calendarEventId = createdEv?.id ?? null;
      }

      const payloadToInsert: Record<string, unknown> = {
        household_id: household.id,
        created_by: userEmail,
        ...encrypted,
        completed: false,
      };
      if (calendarEventId) {
        payloadToInsert.calendar_event_id = calendarEventId;
      }

      let { data, error } = await supabase
        .from('household_mail_items')
        .insert(payloadToInsert)
        .select()
        .single();

      if (error && /calendar_event_id/i.test(error.message)) {
        delete payloadToInsert.calendar_event_id;
        const retry = await supabase
          .from('household_mail_items')
          .insert(payloadToInsert)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;
      if (data) {
        const created = data as RawMailItem;
        if (calendarEventId) {
          writeJsonMapEntry(MAIL_CAL_EVENTS_KEY, created.id, calendarEventId);
        }
        setRawMailItems((prev) =>
          prev.some((m) => m.id === created.id) ? prev : [created, ...prev]
        );
      }
    },
    [userEmail, household, handleAddCalendarEvent]
  );

  const handleToggleMailCompleted = useCallback(
    async (item: MailItem) => {
      if (!userEmail || !household?.id) return;
      const nextCompleted = !item.completed;

      setMailItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, completed: nextCompleted } : m))
      );
      setRawMailItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, completed: nextCompleted } : m))
      );

      const { error } = await supabase
        .from('household_mail_items')
        .update({ completed: nextCompleted })
        .eq('id', item.id);

      if (error) {
        setMailItems((prev) =>
          prev.map((m) =>
            m.id === item.id ? { ...m, completed: item.completed } : m
          )
        );
        setRawMailItems((prev) =>
          prev.map((m) =>
            m.id === item.id ? { ...m, completed: item.completed } : m
          )
        );
        return;
      }

      // Two-way sync: update linked calendar event and cancel/restore 08:00 reminder
      const mailCalMap = readJsonMap(MAIL_CAL_EVENTS_KEY);
      const linkedEventId = item.calendar_event_id || mailCalMap[item.id] || null;
      const senderText = item.sender.trim() || item.carrier.trim() || 'Post';
      const linkedEv = linkedEventId
        ? householdEventsRef.current.find((e) => e.id === linkedEventId)
        : householdEventsRef.current.find(
            (e) =>
              item.due_date &&
              e.event_date === item.due_date &&
              e.title.toLowerCase().includes(senderText.toLowerCase())
          );

      if (linkedEv) {
        const locPart = item.pickup_location.trim()
          ? ` (${item.pickup_location.trim()})`
          : '';
        const amtPart = item.amount.trim() ? ` (${item.amount.trim()})` : '';
        const activeTitle =
          item.item_category === 'package'
            ? `📦 Sista hämtningsdag: ${senderText}${locPart}`
            : item.item_category === 'invoice'
              ? `💳 Förfallodatum: ${senderText}${amtPart}`
              : `✉️ Viktigt brev: ${senderText}`;
        const nextTitle = nextCompleted
          ? `✅ Hämtat / Betald: ${senderText}`
          : activeTitle;

        const { data: evData, error: evError } = await supabase
          .from('household_events')
          .update({ title: nextTitle })
          .eq('id', linkedEv.id)
          .select()
          .single();

        if (!evError && evData) {
          const updatedEv = evData as HouseholdEvent;
          setHouseholdEvents((prev) =>
            prev.map((e) => (e.id === updatedEv.id ? updatedEv : e))
          );
          if (nextCompleted) {
            await cancelCalendarEventNotifications(updatedEv.id);
          } else {
            await scheduleCalendarEventNotifications(updatedEv, false, userEmail);
          }
        }
      }

      if (nextCompleted && !item.is_private) {
        const actorName = userEmail.split('@')[0];
        const actionLabel =
          item.item_category === 'package'
            ? 'Paket hämtat'
            : item.item_category === 'invoice'
              ? 'Räkning betald'
              : 'Post hanterad';
        await handleSendChatMessage({
          text: `✅ ${actionLabel}: ${senderText} (Utfört av ${actorName})`,
        });
      }
    },
    [userEmail, household, handleSendChatMessage]
  );

  const handleDeleteMailItem = useCallback(async (id: string) => {
    setMailItems((prev) => prev.filter((item) => item.id !== id));
    setRawMailItems((prev) => prev.filter((item) => item.id !== id));
    await supabase.from('household_mail_items').delete().eq('id', id);
  }, []);

  const handleClearArchivedMail = useCallback(
    async (filter: MailShareFilter) => {
      const toClearIds = mailItemsRef.current
        .filter((item) => {
          if (!item.completed) return false;
          if (filter === 'private') return item.is_private;
          if (filter === 'shared') return !item.is_private;
          return true;
        })
        .map((item) => item.id);

      if (toClearIds.length === 0) return;

      const idSet = new Set(toClearIds);
      setMailItems((prev) => prev.filter((item) => !idSet.has(item.id)));
      setRawMailItems((prev) => prev.filter((item) => !idSet.has(item.id)));

      await supabase.from('household_mail_items').delete().in('id', toClearIds);
    },
    []
  );

  const handleDeleteCalendarEvent = useCallback(async (id: string) => {
    setHouseholdEvents((prev) => prev.filter((e) => e.id !== id));
    await supabase.from('household_events').delete().eq('id', id);
    await cancelCalendarEventNotifications(id);
  }, []);

  const handleNavigateToShoppingFromCalendar = useCallback((storeName: string) => {
    setShoppingNavRequest({ storeName, nonce: Date.now() });
    setActiveTab('shopping');
  }, []);

  const handleNavigateToMailFromCalendar = useCallback((ev: HouseholdEvent) => {
    const mailCalMap = readJsonMap(MAIL_CAL_EVENTS_KEY);
    const matched = mailItemsRef.current.find((m) => {
      if (m.calendar_event_id === ev.id) return true;
      if (mailCalMap[m.id] === ev.id) return true;
      const sender = (m.sender || m.carrier || '').trim().toLowerCase();
      if (
        m.due_date &&
        m.due_date === ev.event_date &&
        sender &&
        ev.title.toLowerCase().includes(sender)
      ) {
        return true;
      }
      return false;
    });

    if (matched) {
      setHighlightedMailRequest({ mailId: matched.id, nonce: Date.now() });
    }
    setActiveTab('mail');
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
      const nextIsShared = !sharedNoteIds.has(note.id);
      const nextHouseholdId = nextIsShared ? household.id : null;
      const updated: Note = {
        ...note,
        isPrivate: !nextIsShared,
        updatedAt: new Date().toISOString(),
      };
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
      isPrivate: boolean;
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
            isPrivate: draft.isPrivate,
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
            isPrivate: draft.isPrivate,
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

      const targetHhId = draft.isPrivate ? null : (household?.id ?? null);

      await persistNoteEverywhere(updatedNote, targetHhId);
      if (updatedNote.reminder && !updatedNote.reminder.completed) {
        await ensureHighPriorityNotificationChannel();
      }
      await syncNoteReminderNotification(updatedNote);
    },
    [notes, household, persistNoteEverywhere]
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
        !target.isPrivate && sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
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
    await persistNoteEverywhere(
      restored,
      restored.isPrivate ? null : (household?.id ?? null)
    );
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
        !target.isPrivate && sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
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
        !target.isPrivate && sharedNoteIds.has(noteId) ? (household?.id ?? null) : null
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

  const isNotePrivate = useCallback(
    (note: Note): boolean => {
      if (note.isPrivate) return true;
      if (userEmail && household && !sharedNoteIds.has(note.id)) return true;
      return false;
    },
    [userEmail, household, sharedNoteIds]
  );

  const filteredNotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return notes
      .filter((note) => {
        if (noteShareFilter === 'private' && !isNotePrivate(note)) return false;
        if (noteShareFilter === 'shared' && isNotePrivate(note)) return false;
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
  }, [notes, activeCategory, noteShareFilter, isNotePrivate, onlyReminders, searchQuery]);

  const pinnedNotes = useMemo(() => filteredNotes.filter((n) => n.pinned), [filteredNotes]);
  const otherNotes = useMemo(() => filteredNotes.filter((n) => !n.pinned), [filteredNotes]);
  const defaultNewCategory: NoteCategory = activeCategory === 'Alla' ? 'Arbete' : activeCategory;

  const renderNoteItem = (note: Note) => {
    const noteIsPrivate = isNotePrivate(note);
    const isShared = !noteIsPrivate && sharedNoteIds.has(note.id);
    return (
      <div key={note.id} className="flex flex-col gap-1.5">
        <NoteCard
          note={note}
          isPrivate={noteIsPrivate}
          onEdit={(n) => {
            setEditingNote({ ...n, isPrivate: noteIsPrivate });
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
        effectiveTheme={effectiveTheme}
        onToggleTheme={() => setTheme(effectiveTheme === 'dark' ? 'light' : 'dark')}
        onOpenSettings={() => setSettingsModalOpen(true)}
        onOpenNewNote={() => {
          setEditingNote(null);
          setEditorOpen(true);
        }}
        onOpenEmailImport={() => setEmailModalOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4 pb-24 sm:py-6 flex flex-col gap-5">
        <UpdateBanner
          externalRelease={latestRelease}
          onReleaseChecked={setLatestRelease}
        />

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

        {/* Huvudväxlare: Anteckningar / Inköp / Kalender / Chatt */}
        <div className="flex items-center gap-1.5 bg-[#ECEFE9] dark:bg-[#212723] p-1 rounded-2xl self-start flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTab('notes')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
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
            onClick={() => setActiveTab('shopping')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'shopping'
                ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                : 'text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>Inköp</span>
            {uncheckedShoppingCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono-tabular bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]">
                {uncheckedShoppingCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mail')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'mail'
                ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                : 'text-[#525E56] dark:text-[#9BA79F]'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Post</span>
            {activeMailCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono-tabular bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]">
                {activeMailCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('calendar')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
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
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition cursor-pointer whitespace-nowrap ${
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

        {shoppingDoneBanner && (
          <div
            role="status"
            className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] border border-[#2E6B4E]/30 dark:border-[#8FD4AE]/30 text-[#0D3824] dark:text-[#CBEED9] p-4 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-[#2E6B4E] dark:text-[#8FD4AE]" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  Inköpslistan är klar!
                </p>
                <p className="text-xs opacity-85 truncate">
                  {shoppingDoneBanner.actorName} har handlat klart alla varor på listan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('shopping');
                  setShoppingDoneBanner(null);
                }}
                className="min-h-[34px] px-3 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold cursor-pointer"
              >
                Visa Inköp
              </button>
              <button
                type="button"
                onClick={() => setShoppingDoneBanner(null)}
                aria-label="Stäng"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

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
            shoppingItems={shoppingItems}
            knownStoreNames={knownStoreNames}
            householdName={household?.name}
            encryptionSecret={encryptionSecret}
            userEmail={userEmail}
            onSendMessage={handleSendChatMessage}
            onSaveAsNote={handleSaveChatAsNote}
            onToggleShoppingItem={handleToggleShoppingItem}
            onCreateShoppingFromText={handleAddShoppingItems}
            onOpenShoppingTab={() => setActiveTab('shopping')}
            onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
          />
        ) : activeTab === 'shopping' ? (
          <ShoppingList
            items={shoppingItems}
            presets={shoppingPresets}
            householdId={household?.id}
            householdName={household?.name}
            encryptionSecret={encryptionSecret}
            userEmail={userEmail}
            storePlannedDates={storePlannedDates}
            navigationRequest={shoppingNavRequest}
            onAddItems={handleAddShoppingItems}
            onScheduleShoppingDate={handleScheduleShoppingDate}
            onToggleItem={handleToggleShoppingItem}
            onUpdateDepartment={handleUpdateShoppingDepartment}
            onDeleteItem={handleDeleteShoppingItem}
            onClearChecked={handleClearCheckedShoppingItems}
            onSavePreset={handleSaveShoppingPreset}
            onDeletePreset={handleDeleteShoppingPreset}
            onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
          />
        ) : activeTab === 'mail' ? (
          <MailManager
            items={mailItems}
            householdName={household?.name}
            userEmail={userEmail}
            pendingSharedContent={pendingSharedContent}
            highlightedMailRequest={highlightedMailRequest}
            onConsumeSharedContent={() => setPendingSharedContent(null)}
            onSaveMailItem={handleSaveMailItem}
            onToggleCompleted={handleToggleMailCompleted}
            onDeleteItem={handleDeleteMailItem}
            onClearArchived={handleClearArchivedMail}
            onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
          />
        ) : activeTab === 'calendar' ? (
          <HouseholdCalendar
            events={householdEvents}
            householdName={household?.name}
            userEmail={userEmail}
            onAddEvent={handleAddCalendarEvent}
            onDeleteEvent={handleDeleteCalendarEvent}
            onNavigateToShopping={handleNavigateToShoppingFromCalendar}
            onNavigateToMail={handleNavigateToMailFromCalendar}
            onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
          />
        ) : (
          <>
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

            {/* Filterväxlare: Alla / Delade / Privata */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div
                role="tablist"
                aria-label="Filtrera privata eller delade anteckningar"
                className="inline-flex items-center gap-1 p-1 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723]"
              >
                {(
                  [
                    { id: 'all', label: 'Alla' },
                    { id: 'shared', label: 'Delade' },
                    { id: 'private', label: 'Privata' },
                  ] as const
                ).map((tab) => {
                  const active = noteShareFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={active}
                      type="button"
                      onClick={() => setNoteShareFilter(tab.id)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                          : 'text-[#525E56] dark:text-[#9BA79F]'
                      }`}
                    >
                      {tab.id === 'private' && <Lock className="w-3 h-3" aria-hidden="true" />}
                      {tab.id === 'shared' && <Users className="w-3 h-3" aria-hidden="true" />}
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <CategoryTabs
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              counts={categoryCounts}
              onlyReminders={onlyReminders}
              onToggleOnlyReminders={() => setOnlyReminders((prev) => !prev)}
              activeRemindersCount={activeRemindersCount}
            />

            <button
              type="button"
              onClick={() => {
                setEditingNote(null);
                setEditorOpen(true);
              }}
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
                  {searchQuery || onlyReminders || activeCategory !== 'Alla' || noteShareFilter !== 'all'
                    ? 'Inga matchande anteckningar'
                    : 'Inga anteckningar ännu'}
                </h2>
                <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
                  {searchQuery || onlyReminders || activeCategory !== 'Alla' || noteShareFilter !== 'all'
                    ? 'Prova att ändra sökord eller välj ett annat filter.'
                    : 'Skapa din första anteckning med påminnelse eller importera ett mejl från Gmail eller Outlook.'}
                </p>
                <div className="flex items-center gap-2.5 pt-2 flex-wrap justify-center">
                  {(searchQuery || onlyReminders || activeCategory !== 'Alla' || noteShareFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setOnlyReminders(false);
                        setActiveCategory(FILTER_TABS[0]);
                        setNoteShareFilter('all');
                      }}
                      className="min-h-[40px] px-4 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-medium cursor-pointer"
                    >
                      Visa alla
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNote(null);
                      setEditorOpen(true);
                    }}
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
                      {pinnedNotes.map((note) => renderNoteItem(note))}
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
                      {otherNotes.map((note) => renderNoteItem(note))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {activeTab === 'notes' && (
        <button
          type="button"
          onClick={() => {
            setEditingNote(null);
            setEditorOpen(true);
          }}
          aria-label="Ny anteckning"
          className="sm:hidden fixed bottom-5 right-5 z-30 inline-flex items-center justify-center gap-2 h-14 px-5 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] shadow-lg font-semibold text-sm active:scale-95 transition-transform cursor-pointer"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          <span>Ny anteckning</span>
        </button>
      )}

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

      <EmailImportModal
        isOpen={emailModalOpen}
        configs={emailConfigs}
        onClose={() => setEmailModalOpen(false)}
        onImportNote={handleImportEmailNote}
        onSaveConfig={handleSaveEmailConfig}
      />

      <HouseholdModal
        open={householdModalOpen}
        onClose={() => setHouseholdModalOpen(false)}
        userEmail={userEmail}
        household={household}
        onHouseholdUpdated={async () => {
          setPassphraseVersion((v) => v + 1);
          if (userEmail) {
            await syncFromCloud(userEmail);
          }
        }}
        onUpdateChecked={setLatestRelease}
      />

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        theme={theme}
        onChangeTheme={setTheme}
        userEmail={userEmail}
        household={household}
        onOpenHouseholdModal={() => setHouseholdModalOpen(true)}
        onPassphraseChanged={() => setPassphraseVersion((v) => v + 1)}
        initialUpdateResult={latestRelease}
        onUpdateChecked={setLatestRelease}
      />
    </div>
  );
}
