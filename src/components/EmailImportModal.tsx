import { useState } from 'react';
import { CheckCircle2, FileUp, Mail, Settings2, X } from 'lucide-react';
import {
  buildOAuthPreviewUrl,
  createNoteFromParsedEmail,
  parseRawEmailContent,
} from '../services/emailConnector';
import { EmailProvider, EmailProviderConfig, Note } from '../types/note';

interface EmailImportModalProps {
  isOpen: boolean;
  configs: Record<EmailProvider, EmailProviderConfig>;
  onClose: () => void;
  onImportNote: (note: Note) => void;
  onSaveConfig: (config: EmailProviderConfig) => void;
}

const SAMPLE_EMAILS: Record<EmailProvider, string> = {
  Gmail: `From: ekonomi@leverantor.se
Subject: Faktura #2049 & årssammanställning
Date: ${new Date().toUTCString()}

Hej!
Bifogat finner du faktura #2049 för årets licenser.
Vänligen attestera senast imorgon kl. 16:00 så att utbetalningen går iväg i tid.`,
  Outlook: `From: projektledning@kundab.se
Subject: Uppföljning: Granskning av designleverans
Date: ${new Date().toUTCString()}

Hej teamet,
Kan ni återkomma med era synpunkter på de nya vyerna inför morgondagens avstämning?
Påminnelse: Deadline för kommentarerna är imorgon förmiddag.`,
};

export function EmailImportModal({
  isOpen,
  configs,
  onClose,
  onImportNote,
  onSaveConfig,
}: EmailImportModalProps) {
  const [provider, setProvider] = useState<EmailProvider>('Gmail');
  const [activeTab, setActiveTab] = useState<'import' | 'setup'>('import');
  const [rawEmail, setRawEmail] = useState('');
  const [autoReminder, setAutoReminder] = useState(true);
  const [savedNotice, setSavedNotice] = useState(false);

  const activeConfig = configs[provider];
  const [clientId, setClientId] = useState(activeConfig.clientId);
  const [tenantId, setTenantId] = useState(activeConfig.tenantId ?? 'common');

  if (!isOpen) return null;

  const switchProvider = (next: EmailProvider) => {
    setProvider(next);
    setClientId(configs[next].clientId);
    setTenantId(configs[next].tenantId ?? 'common');
    setSavedNotice(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawEmail(text);
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawEmail.trim()) return;
    const parsed = parseRawEmailContent(rawEmail);
    const note = createNoteFromParsedEmail(parsed, provider, autoReminder);
    onImportNote(note);
    setRawEmail('');
    onClose();
  };

  const handleSaveProviderConfig = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig({
      ...activeConfig,
      clientId: clientId.trim(),
      tenantId: provider === 'Outlook' ? tenantId.trim() || 'common' : undefined,
      prepared: true,
      updatedAt: new Date().toISOString(),
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const oauthPreview = buildOAuthPreviewUrl({
    ...activeConfig,
    clientId,
    tenantId,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="email-import-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 text-[#171D19] dark:text-[#E4EBE6] shadow-2xl p-5 sm:p-6 flex flex-col gap-5"
      >
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-current opacity-20 mx-auto -mt-1" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="email-import-title" className="font-display text-lg font-semibold">
              Importera mejl
            </h2>
            <p className="text-xs text-[#525E56] dark:text-[#9BA79F] mt-0.5">
              Skapa anteckningar från mejl direkt eller förbered OAuth-koppling för Gmail och Outlook.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Provider Selector */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723]">
          {(['Gmail', 'Outlook'] as EmailProvider[]).map((p) => {
            const active = provider === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => switchProvider(p)}
                className={`min-h-[40px] rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-sm'
                    : 'text-[#525E56] dark:text-[#9BA79F] hover:text-[#171D19] dark:hover:text-[#E4EBE6]'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-2 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'import'
                ? 'bg-[#D3EBD9] text-[#0D3824] dark:bg-[#1C4A34] dark:text-[#CBEED9]'
                : 'text-[#525E56] dark:text-[#9BA79F] hover:bg-[#ECEFE9] dark:hover:bg-[#212723]'
            }`}
          >
            <Mail className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Importera mejltext / .eml</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'setup'
                ? 'bg-[#D3EBD9] text-[#0D3824] dark:bg-[#1C4A34] dark:text-[#CBEED9]'
                : 'text-[#525E56] dark:text-[#9BA79F] hover:bg-[#ECEFE9] dark:hover:bg-[#212723]'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>API & OAuth-inställningar</span>
          </button>
        </div>

        {activeTab === 'import' ? (
          <form onSubmit={handleImportSubmit} className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="inline-flex items-center gap-2 min-h-[38px] px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-xs font-medium cursor-pointer transition-colors">
                <FileUp className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                <span>Ladda upp .eml / .txt</span>
                <input
                  type="file"
                  accept=".eml,.txt,message/rfc822"
                  onChange={handleFileUpload}
                  className="sr-only"
                />
              </label>

              <button
                type="button"
                onClick={() => setRawEmail(SAMPLE_EMAILS[provider])}
                className="text-xs font-medium text-[#2E6B4E] dark:text-[#8FD4AE] hover:underline cursor-pointer"
              >
                Fyll i exempelmejl ({provider})
              </button>
            </div>

            <textarea
              value={rawEmail}
              onChange={(e) => setRawEmail(e.target.value)}
              rows={7}
              placeholder={`Klistra in mejl här (t.ex. Från:, Ämne: och innehåll)...`}
              className="w-full rounded-2xl bg-[#F6F7F4] dark:bg-[#111412] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-3.5 text-sm leading-relaxed focus:outline-none focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE]"
            />

            <label className="flex items-center gap-2.5 text-xs sm:text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoReminder}
                onChange={(e) => setAutoReminder(e.target.checked)}
                className="w-4 h-4 rounded accent-[#2E6B4E]"
              />
              <span>Föreslå påminnelse automatiskt om deadline nämns i mejlet</span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-4 rounded-xl text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                Avbryt
              </button>
              <button
                type="submit"
                disabled={!rawEmail.trim()}
                className="min-h-[44px] px-5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-sm font-semibold disabled:opacity-40 cursor-pointer"
              >
                Importera till {provider}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSaveProviderConfig} className="flex flex-col gap-4">
            <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#111412] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 p-3.5 text-xs space-y-1.5">
              <div className="font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                Förberedd Capacitor Deep Link-konfiguration ({provider})
              </div>
              <p className="text-[#525E56] dark:text-[#9BA79F]">
                Omdirigerings-URI: <span className="font-mono-tabular">{activeConfig.redirectUri}</span>
              </p>
              <p className="text-[#525E56] dark:text-[#9BA79F]">
                Behörigheter: <span className="font-mono-tabular">{activeConfig.scopes.join(', ')}</span>
              </p>
            </div>

            <label className="flex flex-col gap-1.5 text-xs font-medium">
              <span>{provider === 'Gmail' ? 'Google OAuth Client ID' : 'Microsoft Entra Application (Client) ID'}</span>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={
                  provider === 'Gmail'
                    ? '1234567890-abc.apps.googleusercontent.com'
                    : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                }
                className="w-full h-10 px-3 rounded-xl bg-[#F6F7F4] dark:bg-[#111412] border border-[#18221C]/15 dark:border-[#E3EAE5]/15 text-sm font-mono-tabular focus:outline-none focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE]"
              />
            </label>

            {provider === 'Outlook' && (
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                <span>Tenant ID</span>
                <input
                  type="text"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  placeholder="common"
                  className="w-full h-10 px-3 rounded-xl bg-[#F6F7F4] dark:bg-[#111412] border border-[#18221C]/15 dark:border-[#E3EAE5]/15 text-sm font-mono-tabular focus:outline-none focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE]"
                />
              </label>
            )}

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                Förberedd OAuth 2.0 PKCE-slutpunkt
              </span>
              <div className="rounded-xl bg-[#F6F7F4] dark:bg-[#111412] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 p-2.5 text-[11px] font-mono-tabular break-all text-[#525E56] dark:text-[#9BA79F]">
                {oauthPreview}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              {savedNotice ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2E6B4E] dark:text-[#8FD4AE]">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>Sparat lokalt i IndexedDB</span>
                </span>
              ) : (
                <span className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                  Sparad konfiguration sparas offline.
                </span>
              )}

              <button
                type="submit"
                className="min-h-[44px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-sm font-semibold cursor-pointer"
              >
                Spara koppling
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
