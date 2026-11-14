import { EmailProvider, EmailProviderConfig, Note } from '../types/note';

export interface ParsedEmailResult {
  title: string;
  body: string;
  sender: string;
  receivedAt: string;
  suggestedReminderAt: string | null;
}

/**
 * Generates a PKCE-ready OAuth 2.0 authorization URL for Gmail or Outlook
 * using the configured Capacitor deep link or web origin redirect URI.
 */
export function buildOAuthPreviewUrl(config: EmailProviderConfig): string {
  const params = new URLSearchParams({
    client_id: config.clientId.trim() || 'YOUR_CLIENT_ID',
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    code_challenge_method: 'S256',
    access_type: 'offline',
  });

  if (config.provider === 'Gmail') {
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  const tenant = config.tenantId?.trim() || 'common';
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

/**
 * Parses a pasted email or .eml file into a structured BetterKeep note.
 */
export function parseRawEmailContent(raw: string): ParsedEmailResult {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');

  let subject = '';
  let sender = '';
  let dateHeader = '';
  let bodyStartIndex = 0;

  // Detect RFC-822 / EML style headers at top
  let foundHeader = false;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (line.trim() === '') {
      if (foundHeader) {
        bodyStartIndex = i + 1;
        break;
      }
      continue;
    }

    const headerMatch = line.match(/^(Subject|Ämne|From|Från|Date|Datum)\s*:\s*(.+)$/i);
    if (headerMatch) {
      foundHeader = true;
      const key = headerMatch[1].toLowerCase();
      const val = headerMatch[2].trim();
      if (key === 'subject' || key === 'ämne') subject = val;
      if (key === 'from' || key === 'från') sender = val;
      if (key === 'date' || key === 'datum') dateHeader = val;
      bodyStartIndex = i + 1;
    } else if (foundHeader) {
      // Stop header scan once non-header line appears
      bodyStartIndex = i;
      break;
    }
  }

  const bodyLines = foundHeader ? lines.slice(bodyStartIndex) : lines;
  const cleanBody = bodyLines.join('\n').trim();

  // Fallback title from first non-empty line if no Subject header
  if (!subject) {
    const firstLine = cleanBody.split('\n').find((l) => l.trim().length > 0) ?? '';
    subject = firstLine.slice(0, 72) || 'Importerat mejl';
  }

  if (!sender) {
    sender = 'Okänd avsändare';
  }

  let receivedAt = new Date().toISOString();
  if (dateHeader) {
    const parsedDate = new Date(dateHeader);
    if (!Number.isNaN(parsedDate.getTime())) {
      receivedAt = parsedDate.toISOString();
    }
  }

  // Suggest tomorrow 09:00 reminder if body mentions deadline-like Swedish/English words
  let suggestedReminderAt: string | null = null;
  if (/\b(imorgon|deadline|senast|påminnelse|boka|svara|tomorrow|due)\b/i.test(normalized)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    suggestedReminderAt = tomorrow.toISOString();
  }

  return {
    title: subject,
    body: cleanBody || 'Inget textinnehåll i mejlet.',
    sender,
    receivedAt,
    suggestedReminderAt,
  };
}

export function createNoteFromParsedEmail(
  parsed: ParsedEmailResult,
  provider: EmailProvider,
  includeReminder: boolean
): Note {
  const now = new Date().toISOString();
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const formattedBody = `Från: ${parsed.sender}\n\n${parsed.body}`;

  return {
    id,
    title: parsed.title,
    body: formattedBody,
    category: provider,
    color: provider === 'Gmail' ? 'sky' : 'lavender',
    pinned: false,
    reminder:
      includeReminder && parsed.suggestedReminderAt
        ? { at: parsed.suggestedReminderAt, completed: false }
        : null,
    sourceMeta: {
      provider,
      sender: parsed.sender,
      subject: parsed.title,
      receivedAt: parsed.receivedAt,
    },
    createdAt: now,
    updatedAt: now,
  };
}
