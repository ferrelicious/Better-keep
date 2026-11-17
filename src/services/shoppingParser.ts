export const SHOPPING_DEPARTMENTS = [
  'Frukt & Grönt',
  'Mejeri & Kyl',
  'Bröd & Bageri',
  'Kött, Fisk & Chark',
  'Skafferi',
  'Frys',
  'Hygien & Övrigt',
] as const;

export type ShoppingDepartment = (typeof SHOPPING_DEPARTMENTS)[number];

export const DEFAULT_STORES = [
  'ICA Maxi',
  'Willys',
  'Lidl',
  'Coop',
  'Hemköp',
] as const;

export const STORE_CHAINS = [
  'ICA',
  'Willys',
  'Lidl',
  'Coop',
  'Hemköp',
  'City Gross',
  'Tempo',
] as const;

export const DEFAULT_STAPLES: Array<{ label: string; department: ShoppingDepartment }> = [
  { label: 'Mjölk', department: 'Mejeri & Kyl' },
  { label: 'Ägg', department: 'Mejeri & Kyl' },
  { label: 'Smör', department: 'Mejeri & Kyl' },
  { label: 'Bröd', department: 'Bröd & Bageri' },
  { label: 'Ost', department: 'Mejeri & Kyl' },
  { label: 'Kaffe', department: 'Skafferi' },
  { label: 'Bananer', department: 'Frukt & Grönt' },
  { label: 'Toalettpapper', department: 'Hygien & Övrigt' },
];

export interface RawShoppingItem {
  id: string;
  household_id: string;
  label?: string | null;
  title?: string | null;
  store_name?: string | null;
  store_address?: string | null;
  department?: string | null;
  planned_date?: string | null;
  checked: boolean;
  is_encrypted?: boolean;
  created_by?: string | null;
  added_by?: string | null;
  created_at?: string;
}

export interface ShoppingItem {
  id: string;
  household_id: string;
  label: string;
  store_name: string;
  store_address: string;
  department: ShoppingDepartment;
  planned_date?: string | null;
  checked: boolean;
  is_encrypted?: boolean;
  created_by: string;
  created_at?: string;
}

export type ShoppingPresetType = 'store' | 'staple';

export interface RawShoppingPreset {
  id: string;
  household_id: string;
  preset_type: ShoppingPresetType;
  label?: string | null;
  store_name?: string | null;
  store_address?: string | null;
  department?: string | null;
  lat?: number | null;
  lng?: number | null;
  is_encrypted?: boolean;
  created_by?: string | null;
  added_by?: string | null;
  created_at?: string;
}

export interface ShoppingPreset {
  id: string;
  household_id: string;
  preset_type: ShoppingPresetType;
  label: string;
  store_name: string;
  store_address: string;
  department: ShoppingDepartment;
  lat?: number | null;
  lng?: number | null;
  is_encrypted?: boolean;
  created_by?: string;
  created_at?: string;
}

const SHOPPING_PREFIX_REGEX = /^(handla|inköp|lista)(?:\s+([^:\r\n]+))?\s*:\s*/i;

const GENERIC_NON_STORE_WORDS = new Set([
  'idag',
  'imorgon',
  'övermorgon',
  'nu',
  'snabbt',
  'hem',
  'hemma',
  'sen',
  'senare',
  'veckan',
  'helgen',
  'mat',
  'varor',
]);

const SWEDISH_WEEKDAY_MAP: Record<string, number> = {
  söndag: 0,
  måndag: 1,
  tisdag: 2,
  onsdag: 3,
  torsdag: 4,
  fredag: 5,
  lördag: 6,
};

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysYmd(base: Date, days: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
  return formatLocalYmd(d);
}

function extractPlannedDateAndStore(
  rawHeader: string,
  knownStores: string[]
): { storeName: string; plannedDate: string | null } {
  let working = rawHeader.trim();
  let plannedDate: string | null = null;
  const now = new Date();

  const isoMatch = working.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    plannedDate = isoMatch[1];
    working = working.replace(isoMatch[0], ' ');
  }

  if (!plannedDate) {
    const relOverMatch = working.match(/\b(?:i\s+)?övermorgon\b/i);
    if (relOverMatch) {
      plannedDate = addDaysYmd(now, 2);
      working = working.replace(relOverMatch[0], ' ');
    }
  }

  if (!plannedDate) {
    const relTomorrowMatch = working.match(/\b(?:i\s*morgon|imorgon)\b/i);
    if (relTomorrowMatch) {
      plannedDate = addDaysYmd(now, 1);
      working = working.replace(relTomorrowMatch[0], ' ');
    }
  }

  if (!plannedDate) {
    const relTodayMatch = working.match(/\b(?:i\s*dag|idag)\b/i);
    if (relTodayMatch) {
      plannedDate = addDaysYmd(now, 0);
      working = working.replace(relTodayMatch[0], ' ');
    }
  }

  if (!plannedDate) {
    const wdMatch = working.match(
      /(?:^|\s)(?:på\s+|nästa\s+)?(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)\b/i
    );
    if (wdMatch) {
      const targetDay = SWEDISH_WEEKDAY_MAP[wdMatch[1].toLowerCase()];
      if (targetDay !== undefined) {
        const diff = (targetDay - now.getDay() + 7) % 7 || 7;
        plannedDate = addDaysYmd(now, diff);
        working = working.replace(wdMatch[0], ' ');
      }
    }
  }

  // Strip leftover leading prepositions like "på Willys" / "i" / "hos"
  const storeCleaned = working
    .replace(/^\s*(?:på|i|hos)\s+/i, '')
    .replace(/\s+(?:på|i|hos)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  let storeName = '';
  if (storeCleaned && !GENERIC_NON_STORE_WORDS.has(storeCleaned.toLowerCase())) {
    storeName = resolveMatchedStoreName(storeCleaned, knownStores);
  }

  return { storeName, plannedDate };
}

export function normalizeDepartment(dept?: string | null): ShoppingDepartment {
  if (!dept) return 'Hygien & Övrigt';
  const match = SHOPPING_DEPARTMENTS.find(
    (d) => d.toLowerCase() === dept.trim().toLowerCase()
  );
  return match ?? 'Hygien & Övrigt';
}

const DEPARTMENT_KEYWORDS: Array<{
  department: ShoppingDepartment;
  keywords: string[];
}> = [
  {
    department: 'Frys',
    keywords: [
      'fryst',
      'frysta',
      'fryspizza',
      'frysvaror',
      'glass',
      'isglass',
      'pommes',
      'klyftpotatis',
      'pyttipanna',
      'wokgrönsaker',
      'fiskpinnar',
      'ärtor',
      'edamame',
    ],
  },
  {
    department: 'Frukt & Grönt',
    keywords: [
      'frukt',
      'grönt',
      'grönsaker',
      'äpple',
      'äpplen',
      'banan',
      'bananer',
      'päron',
      'apelsin',
      'clementin',
      'mandarin',
      'citron',
      'lime',
      'avokado',
      'tomat',
      'tomater',
      'körsbärstomat',
      'gurka',
      'paprika',
      'sallad',
      'isbergssallad',
      'spenat',
      'rucola',
      'lök',
      'rödlök',
      'gul lök',
      'vitlök',
      'purjolök',
      'potatis',
      'sötpotatis',
      'morot',
      'morötter',
      'broccoli',
      'blomkål',
      'vitkål',
      'rödkål',
      'zucchini',
      'aubergine',
      'champinjon',
      'svamp',
      'jordgubb',
      'blåbär',
      'hallon',
      'vindruv',
      'melon',
      'vattenmelon',
      'mango',
      'kiwi',
      'ananas',
      'ingefära',
      'persilja',
      'dill',
      'basilika',
      'koriander',
      'selleri',
      'rädis',
      'palsternacka',
      'rödbet',
      'majskolv',
      'bär',
    ],
  },
  {
    department: 'Mejeri & Kyl',
    keywords: [
      'mjölk',
      'havremjölk',
      'havredryck',
      'sojamjölk',
      'mandelmjölk',
      'laktosfri',
      'filmjölk',
      'fil',
      'yoghurt',
      'kvarg',
      'keso',
      'grädde',
      'vispgrädde',
      'matlagningsgrädde',
      'creme fraiche',
      'crème fraîche',
      'gräddfil',
      'smör',
      'bregott',
      'margarin',
      'ost',
      'hårdost',
      'mozzarella',
      'fetaost',
      'halloumi',
      'parmesan',
      'färskost',
      'philadelphia',
      'ägg',
      'juice',
      'apelsinjuice',
      'äppeljuice',
      'smoothie',
      'jäst',
      'hummus',
      'pesto',
      'tofu',
    ],
  },
  {
    department: 'Bröd & Bageri',
    keywords: [
      'bröd',
      'limpa',
      'formfranska',
      'toast',
      'rostbröd',
      'baguette',
      'ciabatta',
      'knäckebröd',
      'fralla',
      'frallor',
      'bulle',
      'bullar',
      'kanelbulle',
      'croissant',
      'tortilla',
      'tunnbröd',
      'korvbröd',
      'hamburgerbröd',
      'pitabröd',
      'naan',
      'skorpor',
      'kex',
      'pepparkak',
      'tårta',
      'surdeg',
    ],
  },
  {
    department: 'Kött, Fisk & Chark',
    keywords: [
      'kött',
      'köttfärs',
      'nötfärs',
      'blandfärs',
      'fläskfärs',
      'kyckling',
      'kalkon',
      'fläskfilé',
      'fläskkotlett',
      'karré',
      'entrecote',
      'biff',
      'rostbiff',
      'bacon',
      'skinka',
      'pålägg',
      'korv',
      'falukorv',
      'grillkorv',
      'prinskorv',
      'salami',
      'leverpastej',
      'köttbullar',
      'lax',
      'torsk',
      'sej',
      'räkor',
      'sill',
      'tonfisk',
      'makrill',
      'fisk',
      'skaldjur',
      'musslor',
      'kräftor',
      'chark',
    ],
  },
  {
    department: 'Skafferi',
    keywords: [
      'kaffe',
      'te',
      'kakao',
      'socker',
      'mjöl',
      'havregryn',
      'gryn',
      'müsli',
      'granola',
      'flingor',
      'cornflakes',
      'pasta',
      'spaghetti',
      'makaroner',
      'penne',
      'lasagne',
      'ris',
      'bulgur',
      'couscous',
      'quinoa',
      'linser',
      'bönor',
      'kikärtor',
      'krossade tomater',
      'passerade tomater',
      'tomatpuré',
      'kokosmjölk',
      'olivolja',
      'rapsolja',
      'matolja',
      'olja',
      'vinäger',
      'balsamico',
      'sojasås',
      'soja',
      'ketchup',
      'senap',
      'majonnäs',
      'krydd',
      'salt',
      'peppar',
      'oregano',
      'kanel',
      'kardemumma',
      'bakpulver',
      'vaniljsocker',
      'buljong',
      'fond',
      'nudlar',
      'ramen',
      'taco',
      'salsa',
      'jordnötssmör',
      'sylt',
      'marmelad',
      'honung',
      'sirap',
      'nötter',
      'mandel',
      'mandlar',
      'cashew',
      'russin',
      'chips',
      'popcorn',
      'godis',
      'choklad',
      'läsk',
      'cola',
      'saft',
      'vatten',
      'öl',
      'konserv',
    ],
  },
  {
    department: 'Hygien & Övrigt',
    keywords: [
      'toalettpapper',
      'toapapper',
      'hushållspapper',
      'tvål',
      'schampo',
      'balsam',
      'duschkräm',
      'tandkräm',
      'tandborste',
      'tandtråd',
      'deodorant',
      'deo',
      'rakhyvel',
      'raklödder',
      'bindor',
      'tampong',
      'blöjor',
      'våtservett',
      'näsduk',
      'diskmedel',
      'maskindisk',
      'tvättmedel',
      'sköljmedel',
      'rengöring',
      'soppåsar',
      'avfallspåsar',
      'plastpåsar',
      'fryspåsar',
      'bakplåtspapper',
      'folie',
      'diskborste',
      'värmeljus',
      'batteri',
      'glödlamp',
      'plåster',
      'alvedon',
      'ipren',
      'hundmat',
      'kattmat',
      'kattsand',
    ],
  },
];

export function categorizeShoppingItem(label: string): ShoppingDepartment {
  const lower = label.trim().toLowerCase();
  if (!lower) return 'Hygien & Övrigt';

  for (const entry of DEPARTMENT_KEYWORDS) {
    for (const kw of entry.keywords) {
      if (lower.includes(kw)) {
        return entry.department;
      }
    }
  }
  return 'Hygien & Övrigt';
}

export function hasShoppingPrefix(text: string): boolean {
  return SHOPPING_PREFIX_REGEX.test(text.trim());
}

export function resolveMatchedStoreName(
  candidate: string,
  knownStores: string[] = [...DEFAULT_STORES]
): string {
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  const allStores = Array.from(new Set([...knownStores, ...DEFAULT_STORES]));
  const exact = allStores.find((s) => s.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function parseShoppingCommand(
  rawText: string,
  knownStores: string[] = [...DEFAULT_STORES]
): { storeName: string; plannedDate: string | null; items: string[] } {
  const trimmed = rawText.trim();
  const match = trimmed.match(SHOPPING_PREFIX_REGEX);

  let storeName = '';
  let plannedDate: string | null = null;
  let body = trimmed;

  if (match) {
    body = trimmed.slice(match[0].length);
    const rawHeader = match[2]?.trim() ?? '';
    if (rawHeader) {
      const parsedHeader = extractPlannedDateAndStore(rawHeader, knownStores);
      storeName = parsedHeader.storeName;
      plannedDate = parsedHeader.plannedDate;
    }
  }

  if (!body) {
    return { storeName, plannedDate, items: [] };
  }

  const tokens = body.split(/[\r\n,;]+/);
  const seen = new Set<string>();
  const items: string[] = [];

  for (const token of tokens) {
    const cleaned = token
      .trim()
      .replace(/^[-•*☐☑✅✓]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();

    if (!cleaned) continue;
    const normalizedKey = cleaned.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);

    const formatted = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    items.push(formatted);
  }

  return { storeName, plannedDate, items };
}

export function extractShoppingItems(rawText: string): string[] {
  return parseShoppingCommand(rawText).items;
}

export function buildStoreNavigationQuery(
  storeName: string,
  storeAddress?: string
): string {
  const cleanName = storeName.trim();
  const cleanAddress = (storeAddress ?? '').trim();

  if (cleanName && cleanAddress) {
    return cleanAddress.toLowerCase().includes(cleanName.toLowerCase())
      ? cleanAddress
      : `${cleanName}, ${cleanAddress}`;
  }
  return cleanAddress || cleanName || 'Matbutik';
}

export function buildGoogleMapsUrl(storeName: string, storeAddress?: string): string {
  const query = buildStoreNavigationQuery(storeName, storeAddress);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function getStoreNavigationHref(
  storeName: string,
  storeAddress: string | undefined,
  isNativePlatform: boolean
): string {
  const fullQuery = buildStoreNavigationQuery(storeName, storeAddress);
  if (isNativePlatform) {
    return `geo:0,0?q=${encodeURIComponent(fullQuery)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullQuery)}`;
}

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const earthRadiusMeters = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

export interface NominatimStoreSuggestion {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface NominatimRawResult {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: {
    shop?: string;
    supermarket?: string;
    convenience?: string;
    amenity?: string;
    road?: string;
    pedestrian?: string;
    house_number?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
  };
}

export async function searchNominatimStores(
  query: string,
  signal?: AbortSignal
): Promise<NominatimStoreSuggestion[]> {
  const clean = query.trim();
  if (!clean) return [];

  const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=se&addressdetails=1&limit=5&q=${encodeURIComponent(
    clean
  )}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'sv',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Butikssökning misslyckades (HTTP ${response.status}).`);
  }

  const rawList = (await response.json()) as NominatimRawResult[];
  if (!Array.isArray(rawList)) return [];

  const suggestions: NominatimStoreSuggestion[] = [];

  for (const item of rawList) {
    const lat = Number.parseFloat(String(item.lat ?? ''));
    const lng = Number.parseFloat(String(item.lon ?? ''));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const addr = item.address ?? {};
    const displayParts = (item.display_name ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const storeName =
      (
        item.name ||
        addr.supermarket ||
        addr.shop ||
        addr.convenience ||
        addr.amenity ||
        displayParts[0] ||
        ''
      ).trim();

    if (!storeName) continue;

    const road = (addr.road || addr.pedestrian || '').trim();
    const street = [road, (addr.house_number || '').trim()]
      .filter(Boolean)
      .join(' ')
      .trim();

    const locality = (
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.suburb ||
      ''
    )
      .replace(/\s+kommun$/i, '')
      .trim();

    let formattedAddress = '';
    if (street && locality) {
      formattedAddress = `${street}, ${locality}`;
    } else if (street || locality) {
      formattedAddress = street || locality;
    } else {
      formattedAddress = displayParts.slice(1, 3).join(', ');
    }

    suggestions.push({
      placeId: String(item.place_id ?? `${lat}_${lng}_${storeName}`),
      name: storeName,
      address: formattedAddress,
      lat,
      lng,
    });
  }

  return suggestions;
}
