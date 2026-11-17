import type React from 'react';
import { useEffect, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import {
  getHouseholdPassphrase,
  setHouseholdPassphrase,
} from '../services/crypto';
import { sendTestNotification } from '../services/notifications';
import { ThemeMode } from '../services/storage';
import { HouseholdInfo } from '../services/supabase';
import {
  CURRENT_APP_VERSION,
  UpdateCheckResult,
  checkForAppUpdate,
  downloadAndInstallApk,
  formatVersionLabel,
} from '../services/updater';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeMode;
  onChangeTheme: (mode: ThemeMode) => void;
  userEmail: string | null;
  household: HouseholdInfo | null;
  onOpenHouseholdModal: () => void;
  onPassphraseChanged: () => void;
  initialUpdateResult?: UpdateCheckResult | null;
  onUpdateChecked?: (result: UpdateCheckResult) => void;
}

const GITHUB_RELEASES_URL = 'https://github.com/ferrelicious/Better-keep/releases';

export function SettingsModal({
  open,
  onClose,
  theme,
  onChangeTheme,
  userEmail,
  household,
  onOpenHouseholdModal,
  onPassphraseChanged,
  initialUpdateResult,
  onUpdateChecked,
}: SettingsModalProps) {
  const [testingNotif, setTestingNotif] = useState(false);
  const [notifFeedback, setNotifFeedback] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseSaved, setPassphraseSaved] = useState(false);

  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(
    initialUpdateResult ?? null
  );
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [downloadingUpdate, setDownloadingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setNotifFeedback(null);
    setCopiedKey(false);
    setPassphraseSaved(false);
    setUpdateError(null);
    if (initialUpdateResult) {
      setUpdateResult(initialUpdateResult);
    }
    if (household?.id) {
      setPassphrase(getHouseholdPassphrase(household.id));
    } else {
      setPassphrase('');
    }
  }, [open, household?.id, initialUpdateResult]);

  if (!open) return null;

  const householdKey = household?.encryption_secret?.trim() || household?.id || '';

  const handleSendTest = async () => {
    setTestingNotif(true);
    setNotifFeedback(null);
    try {
      const res = await sendTestNotification();
      setNotifFeedback(res);
    } finally {
      setTestingNotif(false);
    }
  };

  const handleCopyKey = async () => {
    if (!householdKey) return;
    try {
      await navigator.clipboard.writeText(householdKey);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 2500);
    } catch {
      // Clipboard fallback unavailable
    }
  };

  const handleSavePassphrase = (e: React.FormEvent) => {
    e.preventDefault();
    if (!household?.id) return;
    setHouseholdPassphrase(household.id, passphrase);
    setPassphraseSaved(true);
    onPassphraseChanged();
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateError(null);
    try {
      const res = await checkForAppUpdate();
      setUpdateResult(res);
      onUpdateChecked?.(res);
    } catch {
      setUpdateError('Kunde inte nå GitHub för att söka efter uppdatering.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallApk = async () => {
    if (!updateResult) return;
    const url = updateResult.downloadUrl || updateResult.releaseUrl;
    if (!url || downloadingUpdate) return;
    setUpdateError(null);
    setDownloadingUpdate(true);
    setDownloadProgress(0);
    try {
      await downloadAndInstallApk(url, updateResult.assetName, (pct) =>
        setDownloadProgress(pct)
      );
    } catch (err: unknown) {
      setUpdateError(
        err instanceof Error ? err.message : 'Kunde inte öppna installationsfilen.'
      );
    } finally {
      setDownloadingUpdate(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 shadow-2xl p-5 sm:p-6 flex flex-col gap-6"
      >
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-current opacity-20 mx-auto -mt-1" />

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="font-display text-lg font-bold">
                Inställningar
              </h2>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                Utseende, notiser, säkerhet och appversion
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng inställningar"
            className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-[#ECEFE9] dark:hover:bg-[#212723] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* 1. Utseende */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
            Utseende
          </h3>
          <div
            role="radiogroup"
            aria-label="Välj färgtema"
            className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723]"
          >
            {(
              [
                { id: 'light', label: 'Ljust', Icon: Sun },
                { id: 'dark', label: 'Mörkt', Icon: Moon },
                { id: 'system', label: 'Systemet', Icon: Monitor },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChangeTheme(id)}
                  className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                      : 'text-[#525E56] dark:text-[#9BA79F] hover:text-[#171D19] dark:hover:text-[#E4EBE6]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <hr className="border-[#18221C]/10 dark:border-[#E3EAE5]/10" />

        {/* 2. Notiser & Ljud */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                Notiser & Ljud
              </h3>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                Testa högprioriterade popup-notiser (kanal betterkeep-urgent)
              </p>
            </div>
            <button
              type="button"
              onClick={handleSendTest}
              disabled={testingNotif}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold shrink-0 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {testingNotif ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <BellRing className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Skicka testnotis</span>
            </button>
          </div>

          {notifFeedback && (
            <p
              className={`text-xs font-medium px-3.5 py-2.5 rounded-xl ${
                notifFeedback.ok
                  ? 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]'
                  : 'bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              {notifFeedback.message}
            </p>
          )}

          <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] p-3.5 text-xs text-[#525E56] dark:text-[#9BA79F] space-y-1.5 leading-relaxed">
            <p className="font-semibold text-[#171D19] dark:text-[#E4EBE6]">
              Snabbguide: Tillåt bakgrundsaktivitet på Android
            </p>
            <p>
              1. Öppna telefonens <strong className="font-medium text-[#171D19] dark:text-[#E4EBE6]">Inställningar → Appar → BetterKeep</strong>.
            </p>
            <p>
              2. Under <strong className="font-medium text-[#171D19] dark:text-[#E4EBE6]">Batteri</strong>: välj <strong className="font-medium text-[#171D19] dark:text-[#E4EBE6]">Obegränsad</strong> så att påminnelser och chatt inte pausas i viloläge.
            </p>
            <p>
              3. Under <strong className="font-medium text-[#171D19] dark:text-[#E4EBE6]">Aviseringar</strong>: kontrollera att kanalen <span className="font-mono-tabular">Hushåll, Chatt & Kalender</span> har ljud och popup aktiverat.
            </p>
          </div>
        </section>

        <hr className="border-[#18221C]/10 dark:border-[#E3EAE5]/10" />

        {/* 3. Säkerhet & Kryptering */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
              Säkerhet & Kryptering
            </h3>
            {household ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2E6B4E] dark:text-[#8FD4AE]">
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                <span>E2E Aktiv (AES-GCM 256-bit)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ej kopplat hushåll</span>
              </span>
            )}
          </div>

          {!userEmail || !household ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] p-3.5">
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                Logga in och koppla ett hushåll för att visa och hantera hushållets krypteringsnyckel.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenHouseholdModal();
                }}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold shrink-0 cursor-pointer whitespace-nowrap"
              >
                Konto & Hushåll
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                  Hushållets delade krypteringsnyckel ({household.name})
                </span>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type={showKey ? 'text' : 'password'}
                      readOnly
                      value={householdKey}
                      aria-label="Hushållets krypteringsnyckel"
                      className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-xs font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      aria-label={showKey ? 'Dölj nyckel' : 'Visa nyckel'}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-[#171D19] dark:hover:text-[#E4EBE6] cursor-pointer"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-xs font-semibold shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    {copiedKey ? (
                      <>
                        <Check className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                        <span>Kopierad</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" aria-hidden="true" />
                        <span>Kopiera</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <form onSubmit={handleSavePassphrase} className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F] flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                  <span>Valfri personlig lösenfras (sparas lokalt)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(e) => {
                      setPassphrase(e.target.value);
                      setPassphraseSaved(false);
                    }}
                    placeholder="Skriv egen lösenfras eller lämna tomt"
                    className="flex-1 min-w-0 h-11 px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-xs text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    {passphraseSaved ? 'Sparad' : 'Spara'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

        <hr className="border-[#18221C]/10 dark:border-[#E3EAE5]/10" />

        {/* 4. Om appen & Uppdateringar */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                  Om appen & Uppdateringar
                </h3>
                <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                  Nuvarande version:{' '}
                  <span className="font-mono-tabular font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                    {formatVersionLabel(CURRENT_APP_VERSION)}
                  </span>
                  {' · '}
                  <a
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#2E6B4E] dark:text-[#8FD4AE] hover:underline"
                  >
                    <span>GitHub Releases</span>
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={checkingUpdate || downloadingUpdate}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6] disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {checkingUpdate ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
              )}
              <span>{checkingUpdate ? 'Söker...' : 'Sök efter uppdatering'}</span>
            </button>
          </div>

          {updateError && (
            <p className="text-xs text-red-600 dark:text-red-400">{updateError}</p>
          )}

          {updateResult && !updateError && (
            updateResult.updateAvailable ? (
              <div className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9] p-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">
                    Ny uppdatering tillgänglig ({formatVersionLabel(updateResult.latestVersion)})
                  </p>
                  {downloadingUpdate && downloadProgress !== null && (
                    <p className="text-[11px] font-mono-tabular opacity-85">
                      Laddar ner APK... {downloadProgress}%
                    </p>
                  )}
                </div>
                {(updateResult.downloadUrl || updateResult.releaseUrl) && (
                  <button
                    type="button"
                    onClick={handleInstallApk}
                    disabled={downloadingUpdate}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold shrink-0 disabled:opacity-60 cursor-pointer whitespace-nowrap"
                  >
                    {downloadingUpdate ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>{downloadingUpdate ? 'Hämtar...' : 'Ladda ner & installera'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-[#2E6B4E] dark:text-[#8FD4AE] font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  Du kör den senaste versionen ({formatVersionLabel(updateResult.currentVersion)})
                </span>
              </div>
            )
          )}
        </section>
      </div>
    </div>
  );
}
