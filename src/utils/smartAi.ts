import type { ShoppingDepartment } from '../services/shoppingParser';

export type SmartIntentType = 'shopping' | 'calendar' | 'mail_or_bill' | 'reminder' | 'chat';

export interface SmartAiShoppingItem {
  label: string;
  department?: ShoppingDepartment;
}

export interface SmartAiEvent {
  title: string;
  event_date: string;
  event_time?: string;
  notes?: string;
}

export interface ActionData {
  action_type: 'reminder' | 'shopping' | 'calendar';
  title?: string;
  store_or_location?: string;
  candidate_stores?: string[];
  resolved_date?: string;
  resolved_time?: string;
  notes?: string;
  shopping_items?: SmartAiShoppingItem[];
}

export interface DuplicateMatchInfo {
  id: string;
  type: 'reminder' | 'shopping' | 'calendar';
  title: string;
  details?: string;
}

export interface SmartAiResult {
  intent: SmartIntentType;
  summary: string;
  confidence?: string;
  action_data?: ActionData;
  duplicate_match?: DuplicateMatchInfo | null;
  shopping?: {
    matched_store?: string;
    resolved_date?: string | null;
    items: SmartAiShoppingItem[];
  };
  calendar?: SmartAiEvent;
}

export interface ReceiptScanResult {
  store_name: string;
  purchase_date: string;
  total_amount: string;
  purchased_items: string[];
  matched_item_ids: string[];
  matched_details: Array<{
    itemId: string;
    itemLabel: string;
    receiptLine: string;
  }>;
}

export interface AnalyzeIntentOptions {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  knownStores?: string[];
  memberNames?: string[];
  existingItems?: Array<{ id: string; label: string; store_name?: string }>;
  existingNotes?: Array<{ id: string; title: string; notes?: string }>;
  existingEvents?: Array<{ id: string; title: string; event_date?: string }>;
  signal?: AbortSignal;
}

export async function analyzeSmartIntent(
  options: AnalyzeIntentOptions
): Promise<SmartAiResult> {
  const now = new Date();
  const currentDate = now.toISOString().slice(0, 10);
  const currentWeekday = now.toLocaleDateString('sv-SE', { weekday: 'long' });

  const response = await fetch('/api/ai/intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      text: options.text || '',
      imageBase64: options.imageBase64 || '',
      mimeType: options.mimeType || 'image/jpeg',
      currentDate,
      currentWeekday,
      knownStores: options.knownStores || [],
      memberNames: options.memberNames || [],
      existingItems: options.existingItems || [],
      existingNotes: options.existingNotes || [],
      existingEvents: options.existingEvents || [],
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      errBody.error || `AI-analys misslyckades (HTTP ${response.status}).`
    );
  }

  const raw = (await response.json()) as Record<string, unknown>;

  const intentRaw = String(raw.intent || 'chat').toLowerCase();
  const intent: SmartIntentType =
    intentRaw === 'shopping'
      ? 'shopping'
      : intentRaw === 'calendar'
        ? 'calendar'
        : intentRaw === 'mail_or_bill'
          ? 'mail_or_bill'
          : intentRaw === 'reminder'
            ? 'reminder'
            : 'chat';

  const summary = String(raw.summary || '').trim();
  const confidence = typeof raw.confidence === 'string' ? raw.confidence : undefined;

  let action_data: ActionData | undefined = undefined;
  if (raw.action_data && typeof raw.action_data === 'object') {
    const ad = raw.action_data as Record<string, unknown>;
    const action_type = String(ad.action_type || 'reminder') as 'reminder' | 'shopping' | 'calendar';
    const items: SmartAiShoppingItem[] = [];
    if (Array.isArray(ad.shopping_items)) {
      for (const it of ad.shopping_items) {
        if (it && typeof it === 'object' && 'label' in it) {
          const lbl = String((it as { label: unknown }).label || '').trim();
          if (lbl) {
            const dep = (it as { department?: unknown }).department;
            items.push({
              label: lbl,
              department: typeof dep === 'string' ? (dep as ShoppingDepartment) : undefined,
            });
          }
        }
      }
    }
    const candidateStores: string[] = [];
    if (Array.isArray(ad.candidate_stores)) {
      for (const cs of ad.candidate_stores) {
        const s = String(cs || '').trim();
        if (s) candidateStores.push(s);
      }
    }
    action_data = {
      action_type,
      title: String(ad.title || '').trim(),
      store_or_location: String(ad.store_or_location || '').trim(),
      candidate_stores: candidateStores,
      resolved_date: String(ad.resolved_date || '').trim(),
      resolved_time: String(ad.resolved_time || '').trim(),
      notes: String(ad.notes || '').trim(),
      shopping_items: items,
    };
  }

  let duplicate_match: DuplicateMatchInfo | null | undefined = undefined;
  if (raw.duplicate_match && typeof raw.duplicate_match === 'object') {
    const dm = raw.duplicate_match as Record<string, unknown>;
    const id = String(dm.id || '').trim();
    const title = String(dm.title || '').trim();
    if (id && title) {
      duplicate_match = {
        id,
        type: (String(dm.type || 'reminder') as 'reminder' | 'shopping' | 'calendar'),
        title,
        details: String(dm.details || '').trim(),
      };
    } else {
      duplicate_match = null;
    }
  } else {
    duplicate_match = null;
  }

  // Fallback for older shapes
  let shopping: SmartAiResult['shopping'] = undefined;
  if (raw.shopping && typeof raw.shopping === 'object') {
    const rawShop = raw.shopping as Record<string, unknown>;
    const matched_store = String(rawShop.matched_store || '').trim();
    const resolved_date =
      typeof rawShop.resolved_date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(rawShop.resolved_date)
        ? rawShop.resolved_date
        : null;

    const items: SmartAiShoppingItem[] = [];
    if (Array.isArray(rawShop.items)) {
      for (const it of rawShop.items) {
        if (typeof it === 'object' && it && 'label' in it) {
          const lbl = String((it as { label: unknown }).label || '').trim();
          if (lbl) {
            const dep = (it as { department?: unknown }).department;
            items.push({
              label: lbl,
              department: typeof dep === 'string' ? (dep as ShoppingDepartment) : undefined,
            });
          }
        }
      }
    }

    if (items.length > 0 || matched_store) {
      shopping = {
        matched_store,
        resolved_date,
        items,
      };
    }
  }

  let calendar: SmartAiResult['calendar'] = undefined;
  if (raw.calendar && typeof raw.calendar === 'object') {
    const rawCal = raw.calendar as Record<string, unknown>;
    const title = String(rawCal.title || '').trim();
    const event_date = String(rawCal.event_date || '').trim();
    if (title && /^\d{4}-\d{2}-\d{2}$/.test(event_date)) {
      calendar = {
        title,
        event_date,
        event_time: String(rawCal.event_time || '').trim(),
        notes: String(rawCal.notes || '').trim(),
      };
    }
  }

  return {
    intent,
    summary,
    confidence,
    action_data,
    duplicate_match,
    shopping,
    calendar,
  };
}

export interface ScanReceiptOptions {
  imageBase64: string;
  mimeType?: string;
  activeItems?: Array<{
    id: string;
    label: string;
    department?: string;
    store_name?: string;
  }>;
  signal?: AbortSignal;
}

export async function scanReceiptWithAi(
  options: ScanReceiptOptions
): Promise<ReceiptScanResult> {
  const response = await fetch('/api/shopping/receipt-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      imageBase64: options.imageBase64,
      mimeType: options.mimeType || 'image/jpeg',
      activeItems: options.activeItems || [],
    }),
  });

  if (!response.ok) {
    const errBody = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      errBody.error || `Kvittoskanning misslyckades (HTTP ${response.status}).`
    );
  }

  const data = (await response.json()) as ReceiptScanResult;
  return data;
}

export function formatSwedishRelativeDate(dateStr: string): string {
  if (!dateStr) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const target = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(target.getTime())) return dateStr;

  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return 'idag';
  if (diffDays === 1) return 'imorgon';
  if (diffDays === 2) return 'i övermorgon';
  if (diffDays === -1) return 'igår';
  if (diffDays > 2 && diffDays <= 6) {
    const dayName = target.toLocaleDateString('sv-SE', { weekday: 'long' });
    return `på ${dayName}`;
  }

  return target.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
  });
}
