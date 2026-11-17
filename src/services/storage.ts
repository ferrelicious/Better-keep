import { EmailProvider, EmailProviderConfig, Note } from '../types/note';

const DB_NAME = 'betterkeep_db';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const EMAIL_CONFIG_STORE = 'email_configs';

const LS_NOTES_KEY = 'betterkeep_notes_fallback_v1';
const LS_EMAIL_KEY = 'betterkeep_email_configs_v1';
const LS_SEEDED_KEY = 'betterkeep_seeded_v1';
const LS_THEME_KEY = 'betterkeep_theme';

export type ThemeMode = 'light' | 'dark' | 'system';

export function getSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(LS_THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved;
    }
  } catch {
    // Ignore storage access errors
  }
  return 'system';
}

export function resolveEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore
  }
  return 'light';
}

export function saveTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(LS_THEME_KEY, theme);
  } catch {
    // Ignore
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
        notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        notesStore.createIndex('category', 'category', { unique: false });
      }
      if (!db.objectStoreNames.contains(EMAIL_CONFIG_STORE)) {
        db.createObjectStore(EMAIL_CONFIG_STORE, { keyPath: 'provider' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

function createInitialNotes(): Note[] {
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);

  const yesterday = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  return [
    {
      id: 'seed-note-1',
      title: 'Kvartalsgenomgång & produktplan',
      body: 'Förbered slides för Q4-leveransen:\n• Sammanfatta användarfeedback från Android-betan\n• Bekräfta lanseringsdatum med design och utveckling\n• Skicka möteslänk senast kl. 15:00',
      category: 'Arbete',
      color: 'sage',
      pinned: true,
      reminder: {
        at: inTwoHours.toISOString(),
        completed: false,
      },
      createdAt: yesterday.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'seed-note-2',
      title: 'Handla inför helgen',
      body: 'Kaffe (hela bönor), havremjölk, surdegsbröd, olivolja, citroner och färsk basilika. Hämta även ut paket hos ombudet på vägen hem.',
      category: 'Privat',
      color: 'sand',
      pinned: false,
      reminder: {
        at: tomorrowMorning.toISOString(),
        completed: false,
      },
      createdAt: yesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
    },
    {
      id: 'seed-note-3',
      title: 'Signera leverantörsavtal för molnlagring',
      body: 'Från: ekonomi@nordiccloud.se\n\nHej! Här kommer uppdaterad bilaga för årsavtalet. Vänligen återkom med signerat exemplar före veckans slut.',
      category: 'Gmail',
      color: 'sky',
      pinned: true,
      reminder: {
        at: twoHoursAgo.toISOString(),
        completed: false,
      },
      sourceMeta: {
        provider: 'Gmail',
        sender: 'ekonomi@nordiccloud.se',
        subject: 'Signera leverantörsavtal för molnlagring',
        receivedAt: yesterday.toISOString(),
      },
      createdAt: yesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
    },
    {
      id: 'seed-note-4',
      title: 'Kallelse: Arkitekturmöte Android Capacitor',
      body: 'Från: teamlead@foretaget.se\n\nAgenda för morgondagens synk:\n1. Lokala notiser med @capacitor/local-notifications\n2. Offline-synk & IndexedDB\n3. OAuth-koppling mot Outlook & Gmail',
      category: 'Outlook',
      color: 'lavender',
      pinned: false,
      reminder: null,
      sourceMeta: {
        provider: 'Outlook',
        sender: 'teamlead@foretaget.se',
        subject: 'Kallelse: Arkitekturmöte Android Capacitor',
        receivedAt: yesterday.toISOString(),
      },
      createdAt: yesterday.toISOString(),
      updatedAt: yesterday.toISOString(),
    },
  ];
}

function readLocalFallbackNotes(): Note[] {
  try {
    const raw = localStorage.getItem(LS_NOTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalFallbackNotes(notes: Note[]): void {
  try {
    localStorage.setItem(LS_NOTES_KEY, JSON.stringify(notes));
  } catch {
    // Ignore quota errors
  }
}

export async function loadAllNotes(): Promise<Note[]> {
  try {
    const db = await openDatabase();
    const notes = await new Promise<Note[]>((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readonly');
      const store = tx.objectStore(NOTES_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as Note[]) ?? []);
      req.onerror = () => reject(req.error);
    });

    const alreadySeeded = localStorage.getItem(LS_SEEDED_KEY) === 'true';
    if (notes.length === 0 && !alreadySeeded) {
      const seeded = createInitialNotes();
      await saveAllNotesBulk(seeded);
      localStorage.setItem(LS_SEEDED_KEY, 'true');
      return seeded;
    }

    if (!alreadySeeded && notes.length > 0) {
      localStorage.setItem(LS_SEEDED_KEY, 'true');
    }

    // Mirror to localStorage for fast inspection / backup
    writeLocalFallbackNotes(notes);
    return notes;
  } catch {
    const alreadySeeded = localStorage.getItem(LS_SEEDED_KEY) === 'true';
    const existing = readLocalFallbackNotes();
    if (existing.length === 0 && !alreadySeeded) {
      const seeded = createInitialNotes();
      writeLocalFallbackNotes(seeded);
      try {
        localStorage.setItem(LS_SEEDED_KEY, 'true');
      } catch {
        // Ignore
      }
      return seeded;
    }
    return existing;
  }
}

async function saveAllNotesBulk(notes: Note[]): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      const store = tx.objectStore(NOTES_STORE);
      for (const note of notes) {
        store.put(note);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback handled below
  }
  writeLocalFallbackNotes(notes);
}

export async function saveNoteToStorage(note: Note): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      tx.objectStore(NOTES_STORE).put(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback below
  }

  const fallback = readLocalFallbackNotes();
  const idx = fallback.findIndex((n) => n.id === note.id);
  if (idx >= 0) {
    fallback[idx] = note;
  } else {
    fallback.unshift(note);
  }
  writeLocalFallbackNotes(fallback);
}

export async function deleteNoteFromStorage(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(NOTES_STORE, 'readwrite');
      tx.objectStore(NOTES_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback below
  }

  const fallback = readLocalFallbackNotes().filter((n) => n.id !== id);
  writeLocalFallbackNotes(fallback);
}

export function getDefaultEmailConfigs(): Record<EmailProvider, EmailProviderConfig> {
  const now = new Date().toISOString();
  return {
    Gmail: {
      provider: 'Gmail',
      clientId: '',
      redirectUri: 'com.betterkeep.app://oauth/callback/gmail',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      prepared: true,
      updatedAt: now,
    },
    Outlook: {
      provider: 'Outlook',
      clientId: '',
      tenantId: 'common',
      redirectUri: 'com.betterkeep.app://oauth/callback/outlook',
      scopes: ['offline_access', 'Mail.Read', 'User.Read'],
      prepared: true,
      updatedAt: now,
    },
  };
}

export async function loadEmailConfigs(): Promise<Record<EmailProvider, EmailProviderConfig>> {
  const defaults = getDefaultEmailConfigs();
  try {
    const db = await openDatabase();
    const list = await new Promise<EmailProviderConfig[]>((resolve, reject) => {
      const tx = db.transaction(EMAIL_CONFIG_STORE, 'readonly');
      const req = tx.objectStore(EMAIL_CONFIG_STORE).getAll();
      req.onsuccess = () => resolve((req.result as EmailProviderConfig[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    for (const item of list) {
      defaults[item.provider] = item;
    }
    return defaults;
  } catch {
    try {
      const raw = localStorage.getItem(LS_EMAIL_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record<EmailProvider, EmailProviderConfig>>;
        return { ...defaults, ...parsed };
      }
    } catch {
      // Ignore
    }
    return defaults;
  }
}

export async function saveEmailConfig(config: EmailProviderConfig): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(EMAIL_CONFIG_STORE, 'readwrite');
      tx.objectStore(EMAIL_CONFIG_STORE).put(config);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Fallback
  }

  try {
    const current = await loadEmailConfigs();
    current[config.provider] = config;
    localStorage.setItem(LS_EMAIL_KEY, JSON.stringify(current));
  } catch {
    // Ignore
  }
}
