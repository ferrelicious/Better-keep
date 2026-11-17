import type { HouseholdMember } from './supabase';

const AVATAR_SIZE_PX = 160;

export function getFallbackDisplayName(email: string | null | undefined): string {
  const clean = (email || '').trim();
  if (!clean) return 'Okänd';
  const local = clean.split('@')[0] || clean;
  return local;
}

export function getMemberByEmail(
  email: string | null | undefined,
  members?: HouseholdMember[] | null
): HouseholdMember | undefined {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !members || members.length === 0) return undefined;
  return members.find((m) => m.member_email.trim().toLowerCase() === clean);
}

export function getMemberDisplayName(
  email: string | null | undefined,
  members?: HouseholdMember[] | null
): string {
  const member = getMemberByEmail(email, members);
  const customName = member?.display_name?.trim();
  if (customName) return customName;
  return getFallbackDisplayName(email);
}

export function getMemberAvatarUrl(
  email: string | null | undefined,
  members?: HouseholdMember[] | null
): string | null {
  const member = getMemberByEmail(email, members);
  const url = member?.avatar_url?.trim();
  return url ? url : null;
}

export function getInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

/**
 * Center-crops and scales any uploaded photo to a 160x160 px JPEG data URL (~10-20 KB)
 * suitable for storing directly in household_members.avatar_url.
 */
export async function compressAvatarImage(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Kunde inte läsa bildfilen.'));
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE_PX;
    canvas.height = AVATAR_SIZE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Kunde inte initiera bildkonvertering.');
    }

    const srcWidth = img.naturalWidth || img.width;
    const srcHeight = img.naturalHeight || img.height;
    const side = Math.min(srcWidth, srcHeight);
    const sx = Math.max(0, Math.floor((srcWidth - side) / 2));
    const sy = Math.max(0, Math.floor((srcHeight - side) / 2));

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    // Keep compact (~15 KB) even for busy images
    if (dataUrl.length > 26000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface MentionSegment {
  text: string;
  isMention: boolean;
  isCurrentUser: boolean;
  matchedEmail?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMentionTargets(
  members: HouseholdMember[],
  currentUserEmail?: string | null
): Array<{ token: string; email: string; isCurrentUser: boolean }> {
  const me = (currentUserEmail || '').trim().toLowerCase();
  const entries: Array<{ token: string; email: string; isCurrentUser: boolean }> = [];
  const seen = new Set<string>();

  for (const m of members) {
    const email = m.member_email.trim().toLowerCase();
    const isMe = Boolean(me && email === me);
    const display = m.display_name?.trim();
    const fallback = getFallbackDisplayName(email);

    for (const candidate of [display, fallback]) {
      if (!candidate) continue;
      const key = `${email}::${candidate.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ token: candidate, email, isCurrentUser: isMe });
    }
  }

  // Sort longest first so multi-word names match before shorter prefixes
  entries.sort((a, b) => b.token.length - a.token.length);
  return entries;
}

export function segmentTextWithMentions(
  body: string,
  members: HouseholdMember[],
  currentUserEmail?: string | null
): MentionSegment[] {
  if (!body) return [];

  const targets = buildMentionTargets(members, currentUserEmail);
  const patternParts: string[] = [];

  for (const t of targets) {
    const escaped = escapeRegex(t.token);
    patternParts.push(`@\\[${escaped}\\]`);
    patternParts.push(`@${escaped}(?=$|[\\s,.:;!?()\\[\\]])`);
  }
  // Fallback for any generic @namn
  patternParts.push(`@\\[[^\\]]+\\]`);
  patternParts.push(`@[\\p{L}\\p{N}._-]+`);

  const regex = new RegExp(`(${patternParts.join('|')})`, 'giu');
  const segments: MentionSegment[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    const idx = match.index;
    const prevChar = idx > 0 ? body[idx - 1] : '';
    // Do not match inside email addresses like name@gmail.com
    if (prevChar && /[\p{L}\p{N}._-]/u.test(prevChar)) {
      continue;
    }

    if (idx > lastIndex) {
      segments.push({
        text: body.slice(lastIndex, idx),
        isMention: false,
        isCurrentUser: false,
      });
    }

    const rawMention = match[0];
    const cleanName = rawMention
      .replace(/^@\[/, '')
      .replace(/\]$/, '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();

    const matchedTarget = targets.find((t) => t.token.toLowerCase() === cleanName);

    segments.push({
      text: rawMention.startsWith('@[') && rawMention.endsWith(']')
        ? `@${rawMention.slice(2, -1)}`
        : rawMention,
      isMention: true,
      isCurrentUser: Boolean(matchedTarget?.isCurrentUser),
      matchedEmail: matchedTarget?.email,
    });

    lastIndex = idx + rawMention.length;
  }

  if (lastIndex < body.length) {
    segments.push({
      text: body.slice(lastIndex),
      isMention: false,
      isCurrentUser: false,
    });
  }

  return segments.length > 0
    ? segments
    : [{ text: body, isMention: false, isCurrentUser: false }];
}

export function doesTextMentionUser(
  body: string,
  members: HouseholdMember[],
  userEmail: string | null | undefined
): boolean {
  if (!body || !userEmail) return false;
  const segments = segmentTextWithMentions(body, members, userEmail);
  return segments.some((s) => s.isMention && s.isCurrentUser);
}
