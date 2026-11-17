import { Capacitor } from '@capacitor/core';
import { decryptText, encryptText } from './crypto';

export type MailItemCategory = 'package' | 'invoice' | 'letter';
export type MailShareFilter = 'all' | 'shared' | 'private';

export interface RawMailItem {
  id: string;
  household_id: string;
  created_by: string;
  item_category: MailItemCategory;
  carrier?: string | null;
  sender?: string | null;
  pickup_code?: string | null;
  tracking_id?: string | null;
  pickup_location?: string | null;
  pickup_address?: string | null;
  ocr_number?: string | null;
  payment_recipient?: string | null;
  amount?: string | null;
  due_date?: string | null;
  raw_note?: string | null;
  is_private: boolean;
  completed: boolean;
  is_encrypted?: boolean;
  calendar_event_id?: string | null;
  created_at?: string;
}

export interface MailItem {
  id: string;
  household_id: string;
  created_by: string;
  item_category: MailItemCategory;
  carrier: string;
  sender: string;
  pickup_code: string;
  tracking_id: string;
  pickup_location: string;
  pickup_address: string;
  ocr_number: string;
  payment_recipient: string;
  amount: string;
  due_date: string;
  raw_note: string;
  is_private: boolean;
  completed: boolean;
  is_encrypted?: boolean;
  calendar_event_id?: string | null;
  created_at?: string;
}

export interface ParsedMailDraft {
  item_category: MailItemCategory;
  carrier: string;
  sender: string;
  pickup_code: string;
  tracking_id: string;
  pickup_location: string;
  pickup_address: string;
  ocr_number: string;
  payment_recipient: string;
  amount: string;
  due_date: string;
  raw_note: string;
  is_private: boolean;
}

export interface SharedContentPayload {
  shareId?: number | string;
  type: 'image' | 'text';
  mimeType?: string;
  base64?: string;
  text?: string;
}

const DEFAULT_NATIVE_API_BASE =
  'https://ais-pre-foseevlikbd26otglcr2vv-521875751697.europe-west2.run.app';

function getMailParseEndpoint(): string {
  if (Capacitor.isNativePlatform()) {
    const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined;
    const base = (configured || DEFAULT_NATIVE_API_BASE).replace(/\/+$/, '');
    return `${base}/api/mail/parse`;
  }
  return '/api/mail/parse';
}

export async function parseMailWithAI(params: {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<Omit<ParsedMailDraft, 'raw_note' | 'is_private'>> {
  const endpoint = getMailParseEndpoint();
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: params.text || '',
      imageBase64: params.imageBase64 || '',
      mimeType: params.mimeType || 'image/jpeg',
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    result?: Partial<ParsedMailDraft>;
    error?: string;
  };

  if (!res.ok || !payload.result) {
    throw new Error(
      payload.error || 'AI-tolkningen misslyckades. Försök igen eller fyll i manuellt.'
    );
  }

  const r = payload.result;
  const cat: MailItemCategory =
    r.item_category === 'package' ||
    r.item_category === 'invoice' ||
    r.item_category === 'letter'
      ? r.item_category
      : 'letter';

  return {
    item_category: cat,
    carrier: (r.carrier ?? '').trim(),
    sender: (r.sender ?? '').trim(),
    pickup_code: (r.pickup_code ?? '').trim(),
    tracking_id: (r.tracking_id ?? '').trim(),
    pickup_location: (r.pickup_location ?? '').trim(),
    pickup_address: (r.pickup_address ?? '').trim(),
    ocr_number: (r.ocr_number ?? '').trim(),
    payment_recipient: (r.payment_recipient ?? '').trim(),
    amount: (r.amount ?? '').trim(),
    due_date: (r.due_date ?? '').trim(),
  };
}

export async function imageFileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Kunde inte läsa bildfilen.'));
      reader.readAsDataURL(file);
    });

  const dataUrl = await readAsDataUrl();
  if (file.size <= 1_800_000) {
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
    return {
      base64,
      mimeType: file.type || 'image/jpeg',
    };
  }

  // Downscale oversized camera photos while keeping text/OCR legible
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const fallbackBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        resolve({ base64: fallbackBase64, mimeType: file.type || 'image/jpeg' });
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', 0.88);
      const base64 = compressed.includes(',') ? compressed.split(',')[1] : compressed;
      resolve({ base64, mimeType: 'image/jpeg' });
    };
    img.onerror = () => {
      const fallbackBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      resolve({ base64: fallbackBase64, mimeType: file.type || 'image/jpeg' });
    };
    img.src = dataUrl;
  });
}

async function safeDecryptMailField(
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

export async function decryptMailItem(
  raw: RawMailItem,
  secret: string | null
): Promise<MailItem> {
  const [
    sender,
    pickup_code,
    tracking_id,
    pickup_location,
    pickup_address,
    ocr_number,
    payment_recipient,
    amount,
    raw_note,
  ] = await Promise.all([
    safeDecryptMailField(raw.sender, raw.is_encrypted, secret),
    safeDecryptMailField(raw.pickup_code, raw.is_encrypted, secret),
    safeDecryptMailField(raw.tracking_id, raw.is_encrypted, secret),
    safeDecryptMailField(raw.pickup_location, raw.is_encrypted, secret),
    safeDecryptMailField(raw.pickup_address, raw.is_encrypted, secret),
    safeDecryptMailField(raw.ocr_number, raw.is_encrypted, secret),
    safeDecryptMailField(raw.payment_recipient, raw.is_encrypted, secret),
    safeDecryptMailField(raw.amount, raw.is_encrypted, secret),
    safeDecryptMailField(raw.raw_note, raw.is_encrypted, secret),
  ]);

  return {
    id: raw.id,
    household_id: raw.household_id,
    created_by: raw.created_by,
    item_category: raw.item_category || 'letter',
    carrier: (raw.carrier ?? '').trim(),
    sender,
    pickup_code,
    tracking_id,
    pickup_location,
    pickup_address,
    ocr_number,
    payment_recipient,
    amount,
    due_date: (raw.due_date ?? '').trim(),
    raw_note,
    is_private: Boolean(raw.is_private),
    completed: Boolean(raw.completed),
    is_encrypted: raw.is_encrypted,
    calendar_event_id: raw.calendar_event_id ?? null,
    created_at: raw.created_at,
  };
}

export async function encryptMailDraft(
  draft: ParsedMailDraft,
  secret: string
): Promise<{
  item_category: MailItemCategory;
  carrier: string;
  sender: string;
  pickup_code: string;
  tracking_id: string;
  pickup_location: string;
  pickup_address: string;
  ocr_number: string;
  payment_recipient: string;
  amount: string;
  due_date: string | null;
  raw_note: string;
  is_private: boolean;
  is_encrypted: boolean;
}> {
  const [
    sender,
    pickup_code,
    tracking_id,
    pickup_location,
    pickup_address,
    ocr_number,
    payment_recipient,
    amount,
    raw_note,
  ] = await Promise.all([
    encryptText(draft.sender.trim(), secret),
    encryptText(draft.pickup_code.trim(), secret),
    encryptText(draft.tracking_id.trim(), secret),
    encryptText(draft.pickup_location.trim(), secret),
    encryptText(draft.pickup_address.trim(), secret),
    encryptText(draft.ocr_number.trim(), secret),
    encryptText(draft.payment_recipient.trim(), secret),
    encryptText(draft.amount.trim(), secret),
    encryptText(draft.raw_note.trim(), secret),
  ]);

  return {
    item_category: draft.item_category,
    carrier: draft.carrier.trim(),
    sender,
    pickup_code,
    tracking_id,
    pickup_location,
    pickup_address,
    ocr_number,
    payment_recipient,
    amount,
    due_date: draft.due_date.trim() || null,
    raw_note,
    is_private: draft.is_private,
    is_encrypted: true,
  };
}
