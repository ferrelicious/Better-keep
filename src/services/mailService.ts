import { Capacitor } from '@capacitor/core';
import { decryptText, encryptText } from './crypto';

export type MailItemCategory = 'package' | 'invoice' | 'letter' | 'receipt';
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
  attachment_image?: string | null;
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
  attachment_image?: string | null;
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
  attachment_image?: string | null;
  is_private: boolean;
}

export interface ParsedMailItemResult {
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
}

export interface CalendarEventSuggestion {
  title: string;
  event_date: string;
  event_time?: string;
  notes?: string;
}

export interface ParseMailResultWithItems extends ParsedMailItemResult {
  items: ParsedMailItemResult[];
  calendar_event?: CalendarEventSuggestion | null;
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

const ATTACHMENT_CACHE_KEY_PREFIX = 'betterkeep_mail_attachment_v1_';

export function saveLocalMailAttachment(mailId: string, dataUrl: string): void {
  if (!mailId || !dataUrl) return;
  try {
    localStorage.setItem(`${ATTACHMENT_CACHE_KEY_PREFIX}${mailId}`, dataUrl);
  } catch {
    // Non-fatal if storage quota is full
  }
}

export function getLocalMailAttachment(mailId: string): string | null {
  if (!mailId) return null;
  try {
    return localStorage.getItem(`${ATTACHMENT_CACHE_KEY_PREFIX}${mailId}`);
  } catch {
    return null;
  }
}

export function deleteLocalMailAttachment(mailId: string): void {
  if (!mailId) return;
  try {
    localStorage.removeItem(`${ATTACHMENT_CACHE_KEY_PREFIX}${mailId}`);
  } catch {
    // Non-fatal
  }
}

function getMailParseEndpoint(): string {
  if (Capacitor.isNativePlatform()) {
    const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined;
    const base = (configured || DEFAULT_NATIVE_API_BASE).replace(/\/+$/, '');
    return `${base}/api/mail/parse`;
  }
  return '/api/mail/parse';
}

function normalizeRawItem(r: Partial<ParsedMailItemResult>): ParsedMailItemResult {
  const catRaw = String(r.item_category || '').trim().toLowerCase();
  const cat: MailItemCategory =
    catRaw === 'package'
      ? 'package'
      : catRaw === 'invoice' || catRaw === 'bill'
        ? 'invoice'
        : catRaw === 'receipt' || catRaw === 'kvitto'
          ? 'receipt'
          : catRaw === 'letter'
            ? 'letter'
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

export async function parseMailWithAI(params: {
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}): Promise<ParseMailResultWithItems> {
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
    items?: Array<Partial<ParsedMailItemResult>>;
    result?: Partial<ParsedMailItemResult>;
    calendar_event?: CalendarEventSuggestion | null;
    error?: string;
  };

  if (!res.ok || (!payload.result && (!payload.items || payload.items.length === 0))) {
    throw new Error(
      payload.error || 'AI-tolkningen misslyckades. Försök igen eller fyll i manuellt.'
    );
  }

  let items: ParsedMailItemResult[] = [];
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    items = payload.items.map(normalizeRawItem);
  } else if (payload.result) {
    items = [normalizeRawItem(payload.result)];
  }

  const primary = items[0] || normalizeRawItem({});

  return {
    ...primary,
    items,
    calendar_event: payload.calendar_event || null,
  };
}

/**
 * Compresses screenshot or camera photos to max 1200px width/height and JPEG 0.78 quality
 * as requested, maintaining barcode / QR code / OCR clarity while staying lightweight.
 */
export async function compressScreenshotImage(
  fileOrDataUrl: File | string,
  maxDimension = 1200,
  quality = 0.78
): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  let sourceDataUrl = '';
  if (typeof fileOrDataUrl === 'string') {
    sourceDataUrl = fileOrDataUrl;
  } else {
    sourceDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Kunde inte läsa bildfilen.'));
      reader.readAsDataURL(fileOrDataUrl);
    });
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const fallbackBase64 = sourceDataUrl.includes(',')
          ? sourceDataUrl.split(',').pop() || ''
          : sourceDataUrl;
        resolve({
          base64: fallbackBase64,
          mimeType: 'image/jpeg',
          dataUrl: sourceDataUrl,
        });
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      const cleanBase64 = compressedDataUrl.includes(',')
        ? compressedDataUrl.split(',').pop() || ''
        : compressedDataUrl;

      resolve({
        base64: cleanBase64,
        mimeType: 'image/jpeg',
        dataUrl: compressedDataUrl,
      });
    };

    img.onerror = () => {
      const fallbackBase64 = sourceDataUrl.includes(',')
        ? sourceDataUrl.split(',').pop() || ''
        : sourceDataUrl;
      resolve({
        base64: fallbackBase64,
        mimeType: 'image/jpeg',
        dataUrl: sourceDataUrl,
      });
    };

    img.src = sourceDataUrl;
  });
}

export async function imageFileToBase64(
  file: File
): Promise<{ base64: string; mimeType: string; dataUrl: string }> {
  return compressScreenshotImage(file, 1200, 0.78);
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
    attachment_image_decrypted,
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
    safeDecryptMailField(raw.attachment_image, raw.is_encrypted, secret),
  ]);

  let finalAttachmentImage = attachment_image_decrypted || null;
  if (!finalAttachmentImage && raw.id) {
    finalAttachmentImage = getLocalMailAttachment(raw.id);
  } else if (finalAttachmentImage && raw.id) {
    saveLocalMailAttachment(raw.id, finalAttachmentImage);
  }

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
    attachment_image: finalAttachmentImage,
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
  attachment_image: string | null;
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
    attachment_image,
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
    draft.attachment_image ? encryptText(draft.attachment_image, secret) : Promise.resolve(null),
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
    attachment_image,
    is_private: draft.is_private,
    is_encrypted: true,
  };
}
