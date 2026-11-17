import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import pkg from '../../package.json';

export const CURRENT_APP_VERSION: string = pkg.version;
export const GITHUB_LATEST_RELEASE_URL =
  'https://api.github.com/repos/ferrelicious/Better-keep/releases/latest';

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
}

export interface GitHubLatestRelease {
  tag_name: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  tagName: string;
  downloadUrl: string | null;
  assetName: string;
  releaseUrl: string | null;
  checkedAt: string;
}

function normalizeVersionParts(version: string): number[] {
  const cleaned = version.trim().replace(/^[vV]/, '').split('-')[0];
  return cleaned.split('.').map((part) => {
    const num = Number.parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });
}

/**
 * Returns 1 if remoteVersion > localVersion, -1 if older, 0 if equal.
 */
export function compareVersions(remoteVersion: string, localVersion: string): number {
  const remoteParts = normalizeVersionParts(remoteVersion);
  const localParts = normalizeVersionParts(localVersion);
  const maxLen = Math.max(remoteParts.length, localParts.length);

  for (let i = 0; i < maxLen; i++) {
    const r = remoteParts[i] ?? 0;
    const l = localParts[i] ?? 0;
    if (r > l) return 1;
    if (r < l) return -1;
  }
  return 0;
}

export function formatVersionLabel(version: string): string {
  const clean = version.trim().replace(/^[vV]/, '');
  return `v${clean}`;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        updateAvailable: false,
        currentVersion: CURRENT_APP_VERSION,
        latestVersion: CURRENT_APP_VERSION,
        tagName: formatVersionLabel(CURRENT_APP_VERSION),
        downloadUrl: null,
        assetName: 'BetterKeep.apk',
        releaseUrl: null,
        checkedAt: new Date().toISOString(),
      };
    }
    throw new Error(`GitHub svarade med status ${response.status}`);
  }

  const data = (await response.json()) as GitHubLatestRelease;
  const tagName = data.tag_name || formatVersionLabel(CURRENT_APP_VERSION);
  const latestVersion = tagName.replace(/^[vV]/, '');

  const primaryAsset =
    data.assets?.find((a) => a.name.toLowerCase().endsWith('.apk')) ?? data.assets?.[0];

  const updateAvailable = compareVersions(tagName, CURRENT_APP_VERSION) > 0;

  return {
    updateAvailable,
    currentVersion: CURRENT_APP_VERSION,
    latestVersion,
    tagName,
    downloadUrl: primaryAsset?.browser_download_url ?? null,
    assetName: primaryAsset?.name ?? `BetterKeep-${tagName}.apk`,
    releaseUrl: data.html_url ?? null,
    checkedAt: new Date().toISOString(),
  };
}

export async function downloadAndInstallApk(
  downloadUrl: string,
  assetName: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = assetName || 'BetterKeep.apk';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  const safeName = (assetName || 'BetterKeep-update.apk').replace(/[^a-zA-Z0-9._-]/g, '_');
  let progressHandle: PluginListenerHandle | null = null;

  try {
    if (onProgress) {
      progressHandle = await Filesystem.addListener('progress', (status) => {
        if (status.contentLength > 0) {
          const pct = Math.min(100, Math.round((status.bytes / status.contentLength) * 100));
          onProgress(pct);
        }
      });
    }

    const downloadResult = await Filesystem.downloadFile({
      url: downloadUrl,
      path: safeName,
      directory: Directory.Cache,
      progress: Boolean(onProgress),
    });

    const uriResult = await Filesystem.getUri({
      path: safeName,
      directory: Directory.Cache,
    });

    const filePath = uriResult.uri || downloadResult.path;
    if (!filePath) {
      throw new Error('Kunde inte hitta den nedladdade APK-filen.');
    }

    await FileOpener.open({
      filePath,
      contentType: 'application/vnd.android.package-archive',
      openWithDefault: true,
    });
  } finally {
    if (progressHandle) {
      await progressHandle.remove();
    }
  }
}
