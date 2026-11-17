const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PASSPHRASE_PREFIX = 'betterkeep_hh_passphrase_';

export function getHouseholdPassphrase(householdId: string): string {
  try {
    return localStorage.getItem(`${PASSPHRASE_PREFIX}${householdId}`) ?? '';
  } catch {
    return '';
  }
}

export function setHouseholdPassphrase(householdId: string, passphrase: string): void {
  try {
    const trimmed = passphrase.trim();
    if (trimmed) {
      localStorage.setItem(`${PASSPHRASE_PREFIX}${householdId}`, trimmed);
    } else {
      localStorage.removeItem(`${PASSPHRASE_PREFIX}${householdId}`);
    }
  } catch {
    // Ignore storage errors
  }
}

export function resolveHouseholdSecret(household: {
  id: string;
  encryption_secret?: string | null;
}): string {
  const baseSecret = household.encryption_secret?.trim() || household.id;
  const personalPassphrase = getHouseholdPassphrase(household.id).trim();
  if (personalPassphrase) {
    return `${baseSecret}::${personalPassphrase}`;
  }
  return baseSecret;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const secretBytes = encoder.encode(secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', secretBytes);
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptText(plainText: string, secret: string): Promise<string> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = encoder.encode(plainText);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const cipherBytes = new Uint8Array(cipherBuffer);
  return `${bytesToBase64(iv)}:${bytesToBase64(cipherBytes)}`;
}

export async function decryptText(payload: string, secret: string): Promise<string> {
  if (!payload || !payload.includes(':')) {
    return payload;
  }

  const colonIdx = payload.indexOf(':');
  const ivPart = payload.slice(0, colonIdx);
  const cipherPart = payload.slice(colonIdx + 1);

  if (!ivPart || !cipherPart) {
    return payload;
  }

  const key = await deriveAesKey(secret);
  const iv = base64ToBytes(ivPart);
  const cipherBytes = base64ToBytes(cipherPart);

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(cipherBytes)
  );
  return decoder.decode(decryptedBuffer);
}

export async function encryptBlob(blob: Blob, secret: string): Promise<Blob> {
  const key = await deriveAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBuffer = await blob.arrayBuffer();
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBuffer
  );
  const combined = new Uint8Array(iv.byteLength + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), iv.byteLength);
  return new Blob([combined], { type: 'application/octet-stream' });
}

export async function decryptBlob(
  encryptedBlob: Blob,
  secret: string,
  mimeType = 'application/octet-stream'
): Promise<Blob> {
  const key = await deriveAesKey(secret);
  const fullBuffer = await encryptedBlob.arrayBuffer();
  if (fullBuffer.byteLength <= 12) {
    throw new Error('Ogiltig krypterad fil');
  }
  const iv = new Uint8Array(fullBuffer.slice(0, 12));
  const cipherBytes = new Uint8Array(fullBuffer.slice(12));
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipherBytes
  );
  return new Blob([decryptedBuffer], { type: mimeType });
}

export function inferMimeTypeFromFilename(filename: string, fallbackType?: string | null): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (fallbackType === 'image') return 'image/jpeg';
  if (fallbackType === 'audio') return 'audio/webm';
  return 'application/octet-stream';
}
