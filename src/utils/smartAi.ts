import type { ShoppingDepartment } from '../services/shoppingParser';

export type SmartIntentType = 'shopping' | 'calendar' | 'mail_or_bill' | 'chat';

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

export interface SmartAiResult {
  intent: SmartIntentType;
  summary: string;
  confidence?: string;
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
          : 'chat';

  const summary = String(raw.summary || '').trim();
  const confidence = typeof raw.confidence === 'string' ? raw.confidence : undefined;

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
