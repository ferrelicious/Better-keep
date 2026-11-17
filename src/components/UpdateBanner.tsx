import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Sparkles, X } from 'lucide-react';
import {
  UpdateCheckResult,
  checkForAppUpdate,
  downloadAndInstallApk,
  formatVersionLabel,
} from '../services/updater';

interface UpdateBannerProps {
  externalRelease?: UpdateCheckResult | null;
  manualCheckSignal?: number;
  onReleaseChecked?: (result: UpdateCheckResult) => void;
}

export function UpdateBanner({
  externalRelease,
  manualCheckSignal = 0,
  onReleaseChecked,
}: UpdateBannerProps) {
  const [release, setRelease] = useState<UpdateCheckResult | null>(null);
  const [dismissedTag, setDismissedTag] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    try {
      const result = await checkForAppUpdate();
      setRelease(result);
      setDismissedTag(null);
      onReleaseChecked?.(result);
    } catch {
      // Silent on startup if offline
    }
  }, [onReleaseChecked]);

  // Automatic check on app startup
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  // Re-check when manually triggered
  useEffect(() => {
    if (manualCheckSignal > 0) {
      runCheck();
    }
  }, [manualCheckSignal, runCheck]);

  // Sync if HouseholdModal ran a manual check directly
  useEffect(() => {
    if (externalRelease) {
      setRelease(externalRelease);
      if (externalRelease.updateAvailable) {
        setDismissedTag(null);
      }
    }
  }, [externalRelease]);

  if (!release || !release.updateAvailable || dismissedTag === release.tagName) {
    return null;
  }

  const targetUrl = release.downloadUrl || release.releaseUrl;

  const handleUpdateClick = async () => {
    if (!targetUrl || downloading) return;
    setErrorMsg(null);
    setDownloading(true);
    setProgress(0);
    try {
      await downloadAndInstallApk(targetUrl, release.assetName, (pct) => setProgress(pct));
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : 'Kunde inte öppna installationspaketet. Kontrollera behörigheten att installera appar.';
      setErrorMsg(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="region"
      aria-label="Appuppdatering"
      className="rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] border border-[#2E6B4E]/25 dark:border-[#8FD4AE]/25 text-[#0D3824] dark:text-[#CBEED9] px-4 py-3 flex flex-col gap-2"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              Ny uppdatering tillgänglig ({formatVersionLabel(release.latestVersion)})
            </p>
            <p className="text-xs opacity-85 font-mono-tabular">
              {downloading
                ? progress !== null && progress > 0
                  ? `Laddar ner uppdatering... ${progress}%`
                  : 'Laddar ner APK...'
                : `Nuvarande version: ${formatVersionLabel(release.currentVersion)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {targetUrl && (
            <button
              type="button"
              onClick={handleUpdateClick}
              disabled={downloading}
              className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-xs font-semibold disabled:opacity-60 transition-colors cursor-pointer whitespace-nowrap"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  <span>Laddar ner...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Uppdatera nu</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissedTag(release.tagName)}
            aria-label="Stäng uppdateringsbanner"
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {downloading && progress !== null && progress > 0 && (
        <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/15 overflow-hidden">
          <div
            className="h-full bg-[#2E6B4E] dark:bg-[#8FD4AE] transition-all duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {errorMsg && (
        <p className="text-xs text-red-700 dark:text-red-300 font-medium">{errorMsg}</p>
      )}
    </div>
  );
}
