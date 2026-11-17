import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Calendar as CalendarIcon,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  ImageIcon,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Maximize2,
  Package,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  MailItem,
  MailItemCategory,
  MailShareFilter,
  ParsedMailDraft,
  ParsedMailItemResult,
  SharedContentPayload,
  compressScreenshotImage,
  imageFileToBase64,
  parseMailWithAI,
} from '../services/mailService';
import { buildGoogleMapsUrl } from '../services/shoppingParser';
import { getMemberAvatarUrl, getMemberDisplayName } from '../services/profiles';
import { HouseholdMember } from '../services/supabase';
import { MemberAvatar } from './MemberAvatar';

interface MailManagerProps {
  items: MailItem[];
  householdName?: string;
  members?: HouseholdMember[];
  userEmail: string | null;
  pendingSharedContent: SharedContentPayload | null;
  highlightedMailRequest?: { mailId: string; nonce: number } | null;
  onConsumeSharedContent: () => void;
  onSaveMailItem: (draft: ParsedMailDraft) => Promise<void>;
  onToggleCompleted: (item: MailItem) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onClearArchived: (filter: MailShareFilter) => Promise<void>;
  onOpenHouseholdModal: () => void;
}

export type MailCategoryFilter = 'all' | 'package' | 'invoice' | 'urgent';

export interface DetectedDraftItem extends ParsedMailDraft {
  id: string;
  selected: boolean;
  expanded?: boolean;
}

export interface FullscreenImageState {
  url: string;
  title: string;
  category?: MailItemCategory;
  pickupCode?: string;
  trackingId?: string;
  ocrNumber?: string;
  pickupLocation?: string;
}

const EMPTY_DRAFT: ParsedMailDraft = {
  item_category: 'package',
  carrier: '',
  sender: '',
  pickup_code: '',
  tracking_id: '',
  pickup_location: '',
  pickup_address: '',
  ocr_number: '',
  payment_recipient: '',
  amount: '',
  due_date: '',
  raw_note: '',
  attachment_image: null,
  is_private: false,
};

export function isUrgent(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return false;
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return diffDays <= 3;
}

export function getDueBadgeInfo(dueDate: string | null | undefined): {
  isWithin48h: boolean;
  label: string;
  className: string;
} | null {
  if (!dueDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      isWithin48h: true,
      label: `🚨 Förfallen (${Math.abs(diffDays)} d sedan)`,
      className:
        'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 font-bold',
    };
  }
  if (diffDays === 0) {
    return {
      isWithin48h: true,
      label: '⚠️ Förfaller idag!',
      className:
        'bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300 font-bold',
    };
  }
  if (diffDays === 1) {
    return {
      isWithin48h: true,
      label: '⚠️ Sista dag imorgon (inom 24h)',
      className:
        'bg-orange-500/15 border-orange-500/30 text-orange-800 dark:text-orange-300 font-semibold',
    };
  }
  if (diffDays === 2) {
    return {
      isWithin48h: true,
      label: '⚠️ Förfaller om 2 dagar (inom 48h)',
      className:
        'bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300 font-semibold',
    };
  }
  if (diffDays === 3) {
    return {
      isWithin48h: false,
      label: '⏰ Förfaller om 3 dagar',
      className:
        'bg-yellow-500/15 border-yellow-500/30 text-yellow-800 dark:text-yellow-300',
    };
  }
  return null;
}

function getDueUrgency(dueDate: string): 'overdue' | 'soon' | 'normal' | 'none' {
  if (!dueDate) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return 'none';
  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 2) return 'soon';
  return 'normal';
}

export function MailManager({
  items,
  householdName,
  members = [],
  userEmail,
  pendingSharedContent,
  highlightedMailRequest,
  onConsumeSharedContent,
  onSaveMailItem,
  onToggleCompleted,
  onDeleteItem,
  onClearArchived,
  onOpenHouseholdModal,
}: MailManagerProps) {
  const [shareFilter, setShareFilter] = useState<MailShareFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<MailCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [pastedText, setPastedText] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ParsedMailDraft | null>(null);
  const [detectedDrafts, setDetectedDrafts] = useState<DetectedDraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [fullscreenImage, setFullscreenImage] = useState<FullscreenImageState | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [clearingArchive, setClearingArchive] = useState(false);
  const [highlightedMailId, setHighlightedMailId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullscreenImage) {
        setFullscreenImage(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreenImage]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Scroll to & highlight target card when jumped to from Calendar
  useEffect(() => {
    if (!highlightedMailRequest?.mailId) return;
    const targetId = highlightedMailRequest.mailId;
    setShareFilter('all');
    const targetItem = items.find((m) => m.id === targetId);
    if (targetItem?.completed) {
      setArchivedExpanded(true);
    }
    setHighlightedMailId(targetId);

    const scrollTimer = window.setTimeout(() => {
      const escaped =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(targetId)
          : targetId.replace(/"/g, '\\"');
      const el = document.querySelector(`[data-mail-id="${escaped}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedMailId((curr) => (curr === targetId ? null : curr));
    }, 3000);

    return () => window.clearTimeout(scrollTimer);
  }, [highlightedMailRequest, items]);

  // Automatically process Android Share Target payloads (ACTION_SEND image/text)
  useEffect(() => {
    if (!pendingSharedContent) return;
    const shared = pendingSharedContent;
    onConsumeSharedContent();

    let active = true;
    (async () => {
      setParseError(null);
      setSaveError(null);
      setParsing(true);

      try {
        if (shared.type === 'image' && shared.base64) {
          const mime = shared.mimeType || 'image/jpeg';
          const rawDataUrl = shared.base64.startsWith('data:')
            ? shared.base64
            : `data:${mime};base64,${shared.base64}`;

          const compressed = await compressScreenshotImage(rawDataUrl, 1200, 0.78);
          if (!active) return;
          setPreviewImageUrl(compressed.dataUrl);

          const result = await parseMailWithAI({
            imageBase64: compressed.base64,
            mimeType: 'image/jpeg',
            text: shared.text,
          });

          if (active) {
            if (result.items && result.items.length > 1) {
              setDetectedDrafts(
                result.items.map((item, idx) => ({
                  ...item,
                  id: `detected-${Date.now()}-${idx}`,
                  raw_note: shared.text?.trim() || '',
                  attachment_image: compressed.dataUrl,
                  is_private: isPrivate,
                  selected: true,
                  expanded: false,
                }))
              );
              setDraft(null);
            } else {
              setDetectedDrafts([]);
              setDraft({
                ...result,
                raw_note: shared.text?.trim() || '',
                attachment_image: compressed.dataUrl,
                is_private: isPrivate,
              });
            }
          }
        } else if (shared.type === 'text' && shared.text) {
          setPreviewImageUrl(null);
          setPastedText(shared.text);
          const result = await parseMailWithAI({ text: shared.text });
          if (active) {
            if (result.items && result.items.length > 1) {
              setDetectedDrafts(
                result.items.map((item, idx) => ({
                  ...item,
                  id: `detected-${Date.now()}-${idx}`,
                  raw_note: shared.text?.trim() || '',
                  attachment_image: null,
                  is_private: isPrivate,
                  selected: true,
                  expanded: false,
                }))
              );
              setDraft(null);
            } else {
              setDetectedDrafts([]);
              setDraft({
                ...result,
                raw_note: shared.text.trim(),
                attachment_image: null,
                is_private: isPrivate,
              });
            }
          }
        }
      } catch (err) {
        if (active) {
          setParseError(
            err instanceof Error
              ? err.message
              : 'Kunde inte tolka det delade innehållet med AI.'
          );
          setDetectedDrafts([]);
          setDraft({
            ...EMPTY_DRAFT,
            raw_note: shared.text?.trim() || '',
            attachment_image: previewImageUrl || null,
            is_private: isPrivate,
          });
        }
      } finally {
        if (active) setParsing(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [pendingSharedContent, onConsumeSharedContent, isPrivate]);

  const handleCopy = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || parsing) return;

    setParseError(null);
    setSaveError(null);
    setParsing(true);

    try {
      const { base64, mimeType, dataUrl } = await imageFileToBase64(file);
      setPreviewImageUrl(dataUrl);

      const result = await parseMailWithAI({
        imageBase64: base64,
        mimeType,
        text: pastedText.trim() || undefined,
      });

      if (result.items && result.items.length > 1) {
        setDetectedDrafts(
          result.items.map((item, idx) => ({
            ...item,
            id: `detected-${Date.now()}-${idx}`,
            raw_note: pastedText.trim(),
            attachment_image: dataUrl,
            is_private: isPrivate,
            selected: true,
            expanded: false,
          }))
        );
        setDraft(null);
      } else {
        setDetectedDrafts([]);
        setDraft({
          ...result,
          raw_note: pastedText.trim(),
          attachment_image: dataUrl,
          is_private: isPrivate,
        });
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Kunde inte tolka bilden med AI. Du kan fylla i fälten manuellt.'
      );
      setDetectedDrafts([]);
      setDraft({
        ...EMPTY_DRAFT,
        raw_note: pastedText.trim(),
        attachment_image: previewImageUrl || null,
        is_private: isPrivate,
      });
    } finally {
      setParsing(false);
    }
  };

  const handleAnalyzeText = async () => {
    const clean = pastedText.trim();
    if (!clean || parsing) return;
    setParseError(null);
    setSaveError(null);
    setParsing(true);
    setPreviewImageUrl(null);

    try {
      const result = await parseMailWithAI({ text: clean });
      if (result.items && result.items.length > 1) {
        setDetectedDrafts(
          result.items.map((item, idx) => ({
            ...item,
            id: `detected-${Date.now()}-${idx}`,
            raw_note: clean,
            attachment_image: null,
            is_private: isPrivate,
            selected: true,
            expanded: false,
          }))
        );
        setDraft(null);
      } else {
        setDetectedDrafts([]);
        setDraft({
          ...result,
          raw_note: clean,
          attachment_image: null,
          is_private: isPrivate,
        });
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Kunde inte tolka texten med AI. Du kan redigera manuellt nedan.'
      );
      setDetectedDrafts([]);
      setDraft({
        ...EMPTY_DRAFT,
        raw_note: clean,
        attachment_image: null,
        is_private: isPrivate,
      });
    } finally {
      setParsing(false);
    }
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await onSaveMailItem(draft);
      setDraft(null);
      setPastedText('');
      setPreviewImageUrl(null);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : 'Kunde inte spara posten.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDetectedDrafts = async () => {
    const selected = detectedDrafts.filter((d) => d.selected);
    if (selected.length === 0 || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      for (const item of selected) {
        const { id: _id, selected: _s, expanded: _e, ...cleanDraft } = item;
        await onSaveMailItem(cleanDraft);
      }
      setDetectedDrafts([]);
      setDraft(null);
      setPastedText('');
      setPreviewImageUrl(null);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Ett fel uppstod när de valda posterna sparades.'
      );
    } finally {
      setSaving(false);
    }
  };

  const shareFilteredItems = useMemo(() => {
    return items.filter((item) => {
      if (shareFilter === 'private' && !item.is_private) return false;
      if (shareFilter === 'shared' && item.is_private) return false;
      return true;
    });
  }, [items, shareFilter]);

  const shareFilteredActiveItems = useMemo(
    () => shareFilteredItems.filter((i) => !i.completed),
    [shareFilteredItems]
  );

  const packageCount = useMemo(
    () => shareFilteredActiveItems.filter((i) => i.item_category === 'package').length,
    [shareFilteredActiveItems]
  );

  const invoiceCount = useMemo(
    () => shareFilteredActiveItems.filter((i) => i.item_category === 'invoice').length,
    [shareFilteredActiveItems]
  );

  const urgentCount = useMemo(
    () => shareFilteredActiveItems.filter((i) => isUrgent(i.due_date)).length,
    [shareFilteredActiveItems]
  );

  const matchesSearch = (item: MailItem, q: string): boolean => {
    if (!q) return true;
    const haystacks = [
      item.sender,
      item.carrier,
      item.tracking_id,
      item.pickup_code,
      item.pickup_location,
      item.pickup_address,
      item.ocr_number,
      item.payment_recipient,
      item.amount,
      item.due_date,
      item.raw_note,
    ];
    return haystacks.some((val) => val && val.toLowerCase().includes(q));
  };

  const activeItems = useMemo(() => {
    const cleanQ = searchQuery.trim().toLowerCase();
    return shareFilteredActiveItems
      .filter((item) => {
        if (categoryFilter === 'package' && item.item_category !== 'package') return false;
        if (categoryFilter === 'invoice' && item.item_category !== 'invoice') return false;
        if (categoryFilter === 'urgent' && !isUrgent(item.due_date)) return false;
        if (cleanQ && !matchesSearch(item, cleanQ)) return false;
        return true;
      })
      .sort((a, b) => {
        // Items with due_date sorted ascending (nearest & overdue first!)
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });
  }, [shareFilteredActiveItems, categoryFilter, searchQuery]);

  const archivedItems = useMemo(() => {
    const cleanQ = searchQuery.trim().toLowerCase();
    return shareFilteredItems
      .filter((i) => i.completed)
      .filter((item) => {
        if (categoryFilter === 'package' && item.item_category !== 'package') return false;
        if (categoryFilter === 'invoice' && item.item_category !== 'invoice') return false;
        if (categoryFilter === 'urgent' && !isUrgent(item.due_date)) return false;
        if (cleanQ && !matchesSearch(item, cleanQ)) return false;
        return true;
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [shareFilteredItems, categoryFilter, searchQuery]);

  const handleClearArchiveClick = async () => {
    if (archivedItems.length === 0 || clearingArchive) return;
    setClearingArchive(true);
    try {
      await onClearArchived(shareFilter);
    } finally {
      setClearingArchive(false);
    }
  };

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" aria-hidden="true" />
        </div>
        <h2 className="font-display text-lg font-bold">Post & Räkningar</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Koppla ihop ert hushåll för att samla paketavier, Kivra-skärmdumpar och räkningar med AI-tolkning, E2E-kryptering och automatiska kalenderpåminnelser.
        </p>
        <button
          type="button"
          onClick={onOpenHouseholdModal}
          className="min-h-[42px] px-5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-sm font-semibold cursor-pointer"
        >
          Koppla hushåll nu
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl w-full mx-auto flex flex-col gap-5">
      {/* Header & Filter Switcher */}
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <Package className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base sm:text-lg font-bold truncate">
                {householdName} · Post & Räkningar
              </h2>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F] flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[#2E6B4E] dark:text-[#8FD4AE] font-medium">
                  <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>E2E-krypterad</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {activeItems.length} aktiva · {archivedItems.length} klara
                </span>
              </p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Filtrera delad eller privat post"
            className="inline-flex items-center gap-1 p-1 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723]"
          >
            {(
              [
                { id: 'all', label: 'Alla' },
                { id: 'shared', label: 'Delad' },
                { id: 'private', label: 'Privat' },
              ] as const
            ).map((tab) => {
              const active = shareFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setShareFilter(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                      : 'text-[#525E56] dark:text-[#9BA79F]'
                  }`}
                >
                  {tab.id === 'private' && <Lock className="w-3 h-3" aria-hidden="true" />}
                  {tab.id === 'shared' && <Users className="w-3 h-3" aria-hidden="true" />}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upload Screenshot / Paste Text / Privacy Toggle */}
        <div className="flex flex-col gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="sr-only"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="flex-1 min-w-[230px] min-h-[48px] px-4 py-2.5 rounded-2xl border-2 border-dashed border-[#2E6B4E]/40 dark:border-[#8FD4AE]/40 bg-[#F6F7F4] dark:bg-[#212723] hover:border-[#2E6B4E] dark:hover:border-[#8FD4AE] text-xs sm:text-sm font-semibold text-[#2E6B4E] dark:text-[#8FD4AE] inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 transition-colors"
            >
              {parsing ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              ) : (
                <Upload className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span>
                Ladda upp skärmdump (SMS / Kivra / Mejl) eller fota avi/räkning
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setParseError(null);
                setPreviewImageUrl(null);
                setDraft({
                  ...EMPTY_DRAFT,
                  raw_note: pastedText.trim(),
                  is_private: isPrivate,
                });
              }}
              className="min-h-[48px] px-3.5 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E1E6DE] dark:hover:bg-[#2B322E] text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6] inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <Camera className="w-4 h-4 hidden" aria-hidden="true" />
              <FileText className="w-4 h-4" aria-hidden="true" />
              <span>Fyll i manuellt</span>
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              rows={2}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Eller klistra in SMS/mejl här (t.ex. PostNord-avi eller Kivra-räkning)..."
              aria-label="Klistra in text från SMS eller mejl"
              disabled={parsing}
              className="flex-1 min-w-0 p-3 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] placeholder:text-[#525E56] dark:placeholder:text-[#9BA79F] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E] resize-none"
            />
            <button
              type="button"
              onClick={handleAnalyzeText}
              disabled={!pastedText.trim() || parsing}
              className="min-h-[44px] px-4 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {parsing ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{parsing ? 'Tolkar med AI...' : 'Tolka med AI'}</span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-0.5">
            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none min-h-[36px]">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => {
                  const next = e.target.checked;
                  setIsPrivate(next);
                  setDraft((prev) => (prev ? { ...prev, is_private: next } : prev));
                }}
                className="w-4 h-4 accent-[#2E6B4E] rounded cursor-pointer"
              />
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                <Lock
                  className={`w-3.5 h-3.5 ${
                    isPrivate
                      ? 'text-[#2E6B4E] dark:text-[#8FD4AE]'
                      : 'text-[#525E56] dark:text-[#9BA79F]'
                  }`}
                  aria-hidden="true"
                />
                <span>Privat (syns bara för mig)</span>
              </span>
            </label>

            <span className="text-[11px] text-[#525E56] dark:text-[#9BA79F]">
              Dela skärmdumpar direkt från mobilen till BetterKeep via Dela-menyn.
            </span>
          </div>
        </div>

        {parsing && (
          <div className="rounded-2xl bg-[#D3EBD9]/70 dark:bg-[#1C4A34]/70 px-4 py-3 flex items-center gap-2.5 text-xs sm:text-sm font-medium text-[#0D3824] dark:text-[#CBEED9]">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            <span>
              Gemini AI läser av transportör, hämtningskod, OCR, belopp och datum...
            </span>
          </div>
        )}

        {parseError && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
            <span>{parseError}</span>
            <button
              type="button"
              onClick={() => setParseError(null)}
              aria-label="Stäng felmeddelande"
              className="p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Multi-Item AI Review Card */}
      {detectedDrafts.length > 0 && (
        <div className="rounded-3xl bg-white dark:bg-[#191D1A] border-2 border-[#2E6B4E] dark:border-[#8FD4AE] p-4 sm:p-5 flex flex-col gap-4 shadow-md">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-display text-sm sm:text-base font-bold text-[#171D19] dark:text-[#E4EBE6]">
                  Hittade {detectedDrafts.length} försändelser / räkningar i underlaget
                </h3>
                <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                  Bocka för de du vill spara i hushållet, eller redigera detaljer direkt.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allSelected = detectedDrafts.every((d) => d.selected);
                  setDetectedDrafts((prev) =>
                    prev.map((d) => ({ ...d, selected: !allSelected }))
                  );
                }}
                className="px-3 py-1.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E1E6DE] text-xs font-semibold cursor-pointer"
              >
                {detectedDrafts.every((d) => d.selected) ? 'Avmarkera alla' : 'Välj alla'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDetectedDrafts([]);
                  setPreviewImageUrl(null);
                }}
                aria-label="Avbryt"
                className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-[#525E56]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {previewImageUrl && (
            <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] border border-[#18221C]/8 dark:border-[#E3EAE5]/8">
              <button
                type="button"
                onClick={() =>
                  setFullscreenImage({
                    url: previewImageUrl,
                    title: 'Uppladdad skärmdump',
                  })
                }
                title="Klicka för att förstora"
                className="w-12 h-12 rounded-xl overflow-hidden border border-[#18221C]/10 shrink-0 cursor-pointer relative group"
              >
                <img
                  src={previewImageUrl}
                  alt="Förhandsgranskning"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                  Skärmdump kopplas till alla valda poster
                </p>
                <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F]">
                  Kompakt komprimerad (1200px, JPEG 0.78) och E2E-krypterad.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {detectedDrafts.map((d, index) => (
              <div
                key={d.id}
                className={`rounded-2xl p-3 sm:p-4 border transition-colors ${
                  d.selected
                    ? 'bg-[#F6F7F4] dark:bg-[#212723] border-[#2E6B4E]/30 dark:border-[#8FD4AE]/30'
                    : 'bg-white/40 dark:bg-[#191D1A]/40 border-[#18221C]/10 dark:border-[#E3EAE5]/10 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex items-start gap-3 min-w-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={d.selected}
                      onChange={() =>
                        setDetectedDrafts((prev) =>
                          prev.map((item) =>
                            item.id === d.id ? { ...item, selected: !item.selected } : item
                          )
                        )
                      }
                      className="w-5 h-5 mt-0.5 accent-[#2E6B4E] rounded cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider ${
                            d.item_category === 'package'
                              ? 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]'
                              : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                          }`}
                        >
                          {d.item_category === 'package' ? '📦 Paket' : '💳 Räkning'}
                        </span>
                        <h4 className="text-sm font-bold text-[#171D19] dark:text-[#E4EBE6] truncate">
                          {d.sender || d.carrier || `Post #${index + 1}`}
                        </h4>
                        {d.carrier && d.sender && (
                          <span className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                            via {d.carrier}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mt-1 text-xs text-[#525E56] dark:text-[#9BA79F]">
                        {d.pickup_code && (
                          <span className="font-mono-tabular font-bold text-[#171D19] dark:text-[#E4EBE6]">
                            Kod: {d.pickup_code}
                          </span>
                        )}
                        {d.tracking_id && (
                          <span className="font-mono-tabular">Kolli: {d.tracking_id}</span>
                        )}
                        {d.pickup_location && (
                          <span>Ombud: {d.pickup_location}</span>
                        )}
                        {d.amount && (
                          <span className="font-bold text-[#171D19] dark:text-[#E4EBE6]">
                            {d.amount}
                          </span>
                        )}
                        {d.due_date && (
                          <span className="font-mono-tabular">Datum: {d.due_date}</span>
                        )}
                      </div>
                    </div>
                  </label>

                  <button
                    type="button"
                    onClick={() =>
                      setDetectedDrafts((prev) =>
                        prev.map((item) =>
                          item.id === d.id ? { ...item, expanded: !item.expanded } : item
                        )
                      )
                    }
                    className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#525E56] shrink-0 cursor-pointer text-xs inline-flex items-center gap-1"
                  >
                    <span>{d.expanded ? 'Dölj' : 'Redigera'}</span>
                    {d.expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {d.expanded && (
                  <div className="mt-3 pt-3 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Avsändare</span>
                      <input
                        type="text"
                        value={d.sender}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, sender: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Transportör</span>
                      <input
                        type="text"
                        value={d.carrier}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, carrier: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Hämtningskod</span>
                      <input
                        type="text"
                        value={d.pickup_code}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, pickup_code: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 font-mono-tabular"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Kolli-ID</span>
                      <input
                        type="text"
                        value={d.tracking_id}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, tracking_id: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 font-mono-tabular"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Ombud</span>
                      <input
                        type="text"
                        value={d.pickup_location}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, pickup_location: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="font-semibold text-[#525E56] dark:text-[#9BA79F]">Datum (YYYY-MM-DD)</span>
                      <input
                        type="date"
                        value={d.due_date}
                        onChange={(e) =>
                          setDetectedDrafts((prev) =>
                            prev.map((it) => (it.id === d.id ? { ...it, due_date: e.target.value } : it))
                          )
                        }
                        className="h-8 px-2.5 rounded-lg bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 font-mono-tabular"
                      />
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>

          {saveError && (
            <p className="text-xs text-red-700 dark:text-red-300">{saveError}</p>
          )}

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setDetectedDrafts([]);
                setPreviewImageUrl(null);
              }}
              className="min-h-[40px] px-4 rounded-xl text-xs font-semibold text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={handleSaveDetectedDrafts}
              disabled={saving || detectedDrafts.filter((d) => d.selected).length === 0}
              className="min-h-[42px] px-5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="w-4 h-4" aria-hidden="true" />
              )}
              <span>
                Spara valda ({detectedDrafts.filter((d) => d.selected).length})
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Editable AI Preview Card (Single item) */}
      {draft && detectedDrafts.length === 0 && (
        <form
          onSubmit={handleSaveDraft}
          className="rounded-3xl bg-white dark:bg-[#191D1A] border-2 border-[#2E6B4E]/45 dark:border-[#8FD4AE]/45 p-4 sm:p-5 flex flex-col gap-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles
                className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]"
                aria-hidden="true"
              />
              <h3 className="font-display text-sm sm:text-base font-bold">
                Förhandsgranska & redigera innan du sparar
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setPreviewImageUrl(null);
              }}
              aria-label="Avbryt förhandsgranskning"
              className="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {previewImageUrl && (
            <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] p-2 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setFullscreenImage({
                    url: previewImageUrl,
                    title: draft.sender || draft.carrier || 'Skärmdump',
                    category: draft.item_category,
                    pickupCode: draft.pickup_code,
                    trackingId: draft.tracking_id,
                    ocrNumber: draft.ocr_number,
                    pickupLocation: draft.pickup_location,
                  })
                }
                title="Klicka för att förstora"
                className="cursor-pointer group relative rounded-xl overflow-hidden"
              >
                <img
                  src={previewImageUrl}
                  alt="Uppladdad skärmdump"
                  className="max-h-48 w-auto rounded-xl object-contain group-hover:opacity-90 transition-opacity"
                />
                <span className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/60 text-white text-[10px] font-semibold inline-flex items-center gap-1">
                  <Maximize2 className="w-3 h-3" />
                  <span>Klicka för att förstora</span>
                </span>
              </button>
            </div>
          )}

          {/* Category + Privacy + Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              <span>Typ av post</span>
              <select
                value={draft.item_category}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    item_category: e.target.value as MailItemCategory,
                  })
                }
                className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-medium text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
              >
                <option value="package">📦 Paket</option>
                <option value="invoice">💳 Räkning / Faktura</option>
                <option value="letter">✉️ Brev / Meddelande</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              <span>
                {draft.item_category === 'invoice'
                  ? 'Förfallodatum'
                  : 'Sista dag / Datum'}
              </span>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-medium text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              <span>Synlighet</span>
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, is_private: !draft.is_private })
                }
                className={`h-10 px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  draft.is_private
                    ? 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]'
                    : 'bg-[#ECEFE9] dark:bg-[#212723] text-[#171D19] dark:text-[#E4EBE6]'
                }`}
              >
                {draft.is_private ? (
                  <>
                    <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Privat (bara jag)</span>
                  </>
                ) : (
                  <>
                    <Users className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Delad med {householdName}</span>
                  </>
                )}
              </button>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              <span>Avsändare / Butik / Företag</span>
              <input
                type="text"
                value={draft.sender}
                onChange={(e) => setDraft({ ...draft, sender: e.target.value })}
                placeholder="T.ex. Zalando, Vattenfall, Skatteverket"
                className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              <span>Transportör / Tjänst</span>
              <input
                type="text"
                value={draft.carrier}
                onChange={(e) => setDraft({ ...draft, carrier: e.target.value })}
                placeholder="T.ex. FedEx, PostNord, Instabox, Kivra"
                className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
              />
            </label>
          </div>

          {draft.item_category === 'package' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Hämtningskod / Pinkod</span>
                <input
                  type="text"
                  value={draft.pickup_code}
                  onChange={(e) =>
                    setDraft({ ...draft, pickup_code: e.target.value })
                  }
                  placeholder="T.ex. 482910"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Kolli-ID / Spårningsnummer</span>
                <input
                  type="text"
                  value={draft.tracking_id}
                  onChange={(e) =>
                    setDraft({ ...draft, tracking_id: e.target.value })
                  }
                  placeholder="T.ex. 003732..."
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Ombud / Paketskåp</span>
                <input
                  type="text"
                  value={draft.pickup_location}
                  onChange={(e) =>
                    setDraft({ ...draft, pickup_location: e.target.value })
                  }
                  placeholder="T.ex. ICA Supermarket Stenhagen"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Adress & ort (för karta)</span>
                <input
                  type="text"
                  value={draft.pickup_address}
                  onChange={(e) =>
                    setDraft({ ...draft, pickup_address: e.target.value })
                  }
                  placeholder="T.ex. Herrhagsvägen 10, Uppsala"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>
            </div>
          )}

          {draft.item_category === 'invoice' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Belopp</span>
                <input
                  type="text"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                  placeholder="T.ex. 499,00 kr"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>Bankgiro / Plusgiro</span>
                <input
                  type="text"
                  value={draft.payment_recipient}
                  onChange={(e) =>
                    setDraft({ ...draft, payment_recipient: e.target.value })
                  }
                  placeholder="T.ex. BG 123-4567"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                <span>OCR-nummer / Referens</span>
                <input
                  type="text"
                  value={draft.ocr_number}
                  onChange={(e) =>
                    setDraft({ ...draft, ocr_number: e.target.value })
                  }
                  placeholder="T.ex. 987654321012"
                  className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
            <span>Anteckning / Detaljer</span>
            <textarea
              rows={2}
              value={draft.raw_note}
              onChange={(e) => setDraft({ ...draft, raw_note: e.target.value })}
              placeholder="Valfri anteckning eller sammanfattning..."
              className="p-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E] resize-none"
            />
          </label>

          {draft.due_date && (
            <div className="rounded-xl bg-[#D3EBD9]/60 dark:bg-[#1C4A34]/60 px-3.5 py-2.5 flex items-center gap-2 text-xs text-[#0D3824] dark:text-[#CBEED9]">
              <CalendarIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                Skapar automatiskt en {draft.is_private ? 'privat' : 'delad'} kalenderhändelse den{' '}
                <strong className="font-mono-tabular">{draft.due_date}</strong>.
              </span>
            </div>
          )}

          {saveError && (
            <p className="text-xs text-red-700 dark:text-red-300">{saveError}</p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setPreviewImageUrl(null);
              }}
              className="min-h-[40px] px-4 rounded-xl text-xs font-semibold text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] px-5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="w-4 h-4" aria-hidden="true" />
              )}
              <span>Spara i Post & Räkningar</span>
            </button>
          </div>
        </form>
      )}

      {/* Search Bar & Smart Filter Pills */}
      <div className="flex flex-col gap-2.5">
        <div className="relative">
          <Search
            className="w-4 h-4 text-[#525E56] dark:text-[#9BA79F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Sök avsändare, kolli-ID, ombud, OCR..."
            aria-label="Sök i post och räkningar"
            className="w-full h-10 pl-10 pr-9 rounded-2xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 text-xs sm:text-sm text-[#171D19] dark:text-[#E4EBE6] placeholder:text-[#525E56] dark:placeholder:text-[#9BA79F] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Rensa sökning"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#525E56] hover:text-[#171D19] dark:hover:text-[#E4EBE6] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            className={`min-h-[34px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              categoryFilter === 'all'
                ? 'bg-[#171D19] dark:bg-[#E4EBE6] text-white dark:text-[#171D19] shadow-xs'
                : 'bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span>Alla ({shareFilteredActiveItems.length})</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setCategoryFilter((curr) => (curr === 'package' ? 'all' : 'package'))
            }
            className={`min-h-[34px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              categoryFilter === 'package'
                ? 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] shadow-xs'
                : 'bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span>📦 Paket</span>
            <span className="font-mono-tabular opacity-90">({packageCount})</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setCategoryFilter((curr) => (curr === 'invoice' ? 'all' : 'invoice'))
            }
            className={`min-h-[34px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              categoryFilter === 'invoice'
                ? 'bg-amber-600 dark:bg-amber-400 text-white dark:text-[#2E1A04] shadow-xs'
                : 'bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span>💳 Räkningar</span>
            <span className="font-mono-tabular opacity-90">({invoiceCount})</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setCategoryFilter((curr) => (curr === 'urgent' ? 'all' : 'urgent'))
            }
            className={`min-h-[34px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              categoryFilter === 'urgent'
                ? 'bg-red-600 dark:bg-red-400 text-white dark:text-[#380905] shadow-xs'
                : 'bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5'
            }`}
          >
            <span>⏰ Brådskande</span>
            <span className="font-mono-tabular opacity-90">({urgentCount})</span>
          </button>
        </div>
      </div>

      {/* Active Cards */}
      {activeItems.length === 0 && archivedItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#18221C]/15 dark:border-[#E3EAE5]/15 py-12 px-6 text-center flex flex-col items-center gap-2">
          <Mail
            className="w-8 h-8 text-[#525E56] dark:text-[#9BA79F] opacity-60"
            aria-hidden="true"
          />
          <h3 className="font-display text-base font-semibold">
            {searchQuery
              ? 'Inga poster matchar din sökning'
              : categoryFilter !== 'all'
                ? 'Inga poster i denna kategori'
                : shareFilter === 'private'
                  ? 'Inga privata poster ännu'
                  : shareFilter === 'shared'
                    ? 'Inga delade poster ännu'
                    : 'Rent i brevlådan!'}
          </h3>
          <p className="text-xs sm:text-sm text-[#525E56] dark:text-[#9BA79F] max-w-md">
            {searchQuery
              ? 'Prova en annan sökterm eller rensa filtret.'
              : 'Ladda upp en skärmdump av en paketavi eller Kivra-räkning ovan så tolkar AI den och lägger in datum i kalendern automatiskt.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {activeItems.map((item) => {
            const urgency = getDueUrgency(item.due_date);
            const dueBadge = getDueBadgeInfo(item.due_date);
            const mapQuery = [item.pickup_location, item.pickup_address]
              .filter(Boolean)
              .join(', ');

            return (
              <article
                key={item.id}
                data-mail-id={item.id}
                className={`rounded-3xl bg-white dark:bg-[#191D1A] border p-4 sm:p-5 flex flex-col gap-3.5 transition-all ${
                  highlightedMailId === item.id
                    ? 'border-[#2E6B4E] dark:border-[#8FD4AE] ring-2 ring-[#2E6B4E] dark:ring-[#8FD4AE] shadow-md'
                    : dueBadge?.isWithin48h
                      ? 'border-amber-500/50 dark:border-amber-400/40 shadow-xs'
                      : 'border-[#18221C]/12 dark:border-[#E3EAE5]/12'
                }`}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                        item.item_category === 'package'
                          ? 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE]'
                          : item.item_category === 'invoice'
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'bg-[#ECEFE9] dark:bg-[#212723] text-[#525E56] dark:text-[#9BA79F]'
                      }`}
                    >
                      {item.item_category === 'package' ? (
                        <Package className="w-5 h-5" aria-hidden="true" />
                      ) : item.item_category === 'invoice' ? (
                        <CreditCard className="w-5 h-5" aria-hidden="true" />
                      ) : (
                        <Mail className="w-5 h-5" aria-hidden="true" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-base font-bold text-[#171D19] dark:text-[#E4EBE6] break-words">
                          {item.sender ||
                            item.carrier ||
                            (item.item_category === 'package'
                              ? 'Paket'
                              : item.item_category === 'invoice'
                                ? 'Räkning'
                                : 'Brev')}
                        </h3>
                        {item.carrier && item.sender && (
                          <span className="px-2 py-0.5 rounded-lg bg-[#ECEFE9] dark:bg-[#212723] text-[11px] font-semibold text-[#525E56] dark:text-[#9BA79F]">
                            {item.carrier}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold ${
                            item.is_private
                              ? 'bg-[#ECEFE9] dark:bg-[#212723] text-[#525E56] dark:text-[#9BA79F]'
                              : 'bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9]'
                          }`}
                        >
                          {item.is_private ? (
                            <Lock className="w-3 h-3" aria-hidden="true" />
                          ) : (
                            <Users className="w-3 h-3" aria-hidden="true" />
                          )}
                          <span>{item.is_private ? 'Privat' : 'Delad'}</span>
                        </span>

                        {/* 48h / Overdue Warning Badge */}
                        {dueBadge && (
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] border ${dueBadge.className}`}
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span>{dueBadge.label}</span>
                          </span>
                        )}
                      </div>

                      {item.due_date && (
                        <p
                          className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold font-mono-tabular ${
                            urgency === 'overdue'
                              ? 'text-red-700 dark:text-red-300'
                              : urgency === 'soon'
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-[#525E56] dark:text-[#9BA79F]'
                          }`}
                        >
                          <CalendarIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {item.item_category === 'invoice'
                              ? `Förfaller: ${item.due_date}`
                              : `Sista dag: ${item.due_date}`}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteItem(item.id)}
                    aria-label={`Ta bort ${item.sender || 'post'}`}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Package Details */}
                {item.item_category === 'package' && (
                  <div className="flex flex-col gap-2.5">
                    {item.pickup_code && (
                      <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#212723] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#525E56] dark:text-[#9BA79F]">
                            Hämtningskod
                          </p>
                          <p className="text-xl sm:text-2xl font-bold font-mono-tabular tracking-wider text-[#171D19] dark:text-[#E4EBE6] break-all">
                            {item.pickup_code}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(`${item.id}-code`, item.pickup_code)}
                          className="min-h-[40px] px-3.5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          {copiedKey === `${item.id}-code` ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Kopierad!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Kopiera</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {(item.pickup_location || item.pickup_address) && (
                      <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#212723] px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          {item.pickup_location && (
                            <p className="text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                              {item.pickup_location}
                            </p>
                          )}
                          {item.pickup_address && (
                            <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                              {item.pickup_address}
                            </p>
                          )}
                        </div>
                        <a
                          href={buildGoogleMapsUrl(mapQuery || item.carrier)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[36px] px-3 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                        >
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Öppna karta</span>
                          <ExternalLink className="w-3 h-3 opacity-75" aria-hidden="true" />
                        </a>
                      </div>
                    )}

                    {item.tracking_id && (
                      <div className="flex items-center justify-between gap-2 px-1 text-xs text-[#525E56] dark:text-[#9BA79F]">
                        <span className="truncate font-mono-tabular">
                          Kolli-ID: {item.tracking_id}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(`${item.id}-track`, item.tracking_id)
                          }
                          className="inline-flex items-center gap-1 font-semibold text-[#2E6B4E] dark:text-[#8FD4AE] hover:underline shrink-0 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>
                            {copiedKey === `${item.id}-track` ? 'Kopierad!' : 'Kopiera'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Invoice Details */}
                {item.item_category === 'invoice' && (
                  <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#212723] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 p-3.5 flex flex-col gap-2.5">
                    {item.amount && (
                      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10">
                        <span className="text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                          Att betala
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold font-mono-tabular text-[#171D19] dark:text-[#E4EBE6]">
                            {item.amount}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(`${item.id}-amt`, item.amount)}
                            aria-label="Kopiera belopp"
                            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-[#2E6B4E] dark:text-[#8FD4AE] cursor-pointer"
                          >
                            {copiedKey === `${item.id}-amt` ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {item.payment_recipient && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-[#525E56] dark:text-[#9BA79F]">
                            Bankgiro / Plusgiro
                          </p>
                          <p className="text-sm font-bold font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] break-all">
                            {item.payment_recipient}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(`${item.id}-bg`, item.payment_recipient)
                          }
                          className="min-h-[36px] px-3 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-xs font-semibold text-[#2E6B4E] dark:text-[#8FD4AE] inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          {copiedKey === `${item.id}-bg` ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Kopierad!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Kopiera</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {item.ocr_number && (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-[#525E56] dark:text-[#9BA79F]">
                            OCR-nummer / Referens
                          </p>
                          <p className="text-sm font-bold font-mono-tabular text-[#171D19] dark:text-[#E4EBE6] break-all">
                            {item.ocr_number}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(`${item.id}-ocr`, item.ocr_number)
                          }
                          className="min-h-[36px] px-3 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                        >
                          {copiedKey === `${item.id}-ocr` ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Kopierad!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Kopiera OCR</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {item.raw_note && (
                  <p className="text-xs text-[#525E56] dark:text-[#9BA79F] whitespace-pre-wrap break-words bg-[#F6F7F4]/60 dark:bg-[#141816]/60 rounded-xl px-3 py-2">
                    {item.raw_note}
                  </p>
                )}

                {/* Screenshot / Barcode thumbnail & Fullscreen Button */}
                {item.attachment_image && (
                  <div className="rounded-2xl bg-[#F6F7F4] dark:bg-[#212723] p-3 flex items-center justify-between gap-3 border border-[#18221C]/8 dark:border-[#E3EAE5]/8">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          setFullscreenImage({
                            url: item.attachment_image!,
                            title: item.sender || item.carrier || 'Skärmdump',
                            category: item.item_category,
                            pickupCode: item.pickup_code,
                            trackingId: item.tracking_id,
                            ocrNumber: item.ocr_number,
                            pickupLocation: item.pickup_location,
                          })
                        }
                        title="Klicka för att förstora skärmdumpen"
                        className="relative group w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shrink-0 border border-[#18221C]/15 dark:border-[#E3EAE5]/15 bg-black/5 dark:bg-white/5 cursor-pointer"
                      >
                        <img
                          src={item.attachment_image}
                          alt={`Skärmdump för ${item.sender || item.carrier || 'post'}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                          <Eye className="w-4 h-4" />
                        </div>
                      </button>

                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6] truncate">
                          Sparad skärmdump / avi
                        </p>
                        <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                          Visa hos ombudet för QR-kod, streckkod eller OCR
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setFullscreenImage({
                          url: item.attachment_image!,
                          title: item.sender || item.carrier || 'Skärmdump',
                          category: item.item_category,
                          pickupCode: item.pickup_code,
                          trackingId: item.tracking_id,
                          ocrNumber: item.ocr_number,
                          pickupLocation: item.pickup_location,
                        })
                      }
                      className="min-h-[38px] px-3.5 rounded-xl bg-white dark:bg-[#191D1A] hover:bg-[#ECEFE9] dark:hover:bg-[#262D28] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6] inline-flex items-center gap-1.5 shrink-0 cursor-pointer shadow-xs transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                      <span>🖼️ Visa bild / streckkod</span>
                    </button>
                  </div>
                )}

                {/* Card Footer Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-[#525E56] dark:text-[#9BA79F]">
                    <MemberAvatar
                      size="xs"
                      name={getMemberDisplayName(item.created_by, members)}
                      avatarUrl={getMemberAvatarUrl(item.created_by, members)}
                    />
                    <span>
                      Tillagd av {getMemberDisplayName(item.created_by, members)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleCompleted(item)}
                    className="min-h-[40px] px-4 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] hover:bg-[#C2E2CA] dark:hover:bg-[#235B40] text-[#0D3824] dark:text-[#CBEED9] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
                    <span>
                      {item.item_category === 'package'
                        ? 'Markera som hämtat'
                        : item.item_category === 'invoice'
                          ? 'Markera som betald'
                          : 'Markera som klar'}
                    </span>
                  </button>
                </div>
              </article>
            );
          })}

          {/* Archived / Completed Section */}
          {archivedItems.length > 0 && (
            <section className="rounded-3xl bg-[#F6F7F4]/80 dark:bg-[#141816] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 overflow-hidden">
              <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setArchivedExpanded((v) => !v)}
                  aria-expanded={archivedExpanded}
                  className="inline-flex items-center gap-2 text-xs font-semibold text-[#525E56] dark:text-[#9BA79F] cursor-pointer"
                >
                  <Archive className="w-4 h-4" aria-hidden="true" />
                  <span>Klart & Arkiverat ({archivedItems.length})</span>
                  {archivedExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {archivedExpanded && (
                  <button
                    type="button"
                    onClick={handleClearArchiveClick}
                    disabled={clearingArchive}
                    className="inline-flex items-center gap-1.5 min-h-[32px] px-3 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer"
                  >
                    {clearingArchive ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    <span>Rensa arkiverade</span>
                  </button>
                )}
              </div>

              {archivedExpanded && (
                <ul className="divide-y divide-[#18221C]/8 dark:divide-[#E3EAE5]/8 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10">
                  {archivedItems.map((item) => (
                    <li
                      key={item.id}
                      data-mail-id={item.id}
                      className={`px-4 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                        highlightedMailId === item.id
                          ? 'bg-[#D3EBD9]/50 dark:bg-[#1C4A34]/50 opacity-100'
                          : 'opacity-75'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-through text-[#525E56] dark:text-[#9BA79F] truncate">
                          {item.sender || item.carrier || 'Post'}
                          {item.amount ? ` · ${item.amount}` : ''}
                        </p>
                        <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                          {[
                            item.carrier,
                            item.is_private ? 'Privat' : 'Delad',
                            item.due_date,
                            item.created_by
                              ? `Av ${getMemberDisplayName(item.created_by, members)}`
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {item.attachment_image && (
                          <button
                            type="button"
                            onClick={() =>
                              setFullscreenImage({
                                url: item.attachment_image!,
                                title: item.sender || item.carrier || 'Arkiverad avi',
                                category: item.item_category,
                                pickupCode: item.pickup_code,
                                trackingId: item.tracking_id,
                                ocrNumber: item.ocr_number,
                                pickupLocation: item.pickup_location,
                              })
                            }
                            title="Visa bild"
                            aria-label="Visa sparad bild"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                          >
                            <ImageIcon className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleCompleted(item)}
                          title="Återställ till aktiv"
                          aria-label={`Återställ ${item.sender || 'post'}`}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          aria-label={`Ta bort ${item.sender || 'post'}`}
                          className="w-9 h-9 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}

      {/* Fullscreen Image / Barcode Modal */}
      {fullscreenImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Förstorad skärmdump"
          className="fixed inset-0 z-50 bg-black/92 backdrop-blur-md flex flex-col justify-between p-3 sm:p-5 animate-in fade-in duration-150"
          onClick={() => setFullscreenImage(null)}
        >
          {/* Top Bar */}
          <div
            className="flex items-center justify-between gap-3 text-white max-w-4xl w-full mx-auto pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-bold truncate">
                {fullscreenImage.title}
              </h3>
              <p className="text-xs text-white/70 truncate">
                {fullscreenImage.pickupLocation
                  ? `Ombud: ${fullscreenImage.pickupLocation}`
                  : 'Skärmdump / avisering med streckkod / QR-kod'}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setFullscreenImage(null)}
                aria-label="Stäng fullskärmsläge"
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Center Image */}
          <div
            className="flex-1 min-h-0 flex items-center justify-center p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={fullscreenImage.url}
              alt={fullscreenImage.title}
              className="max-h-[75vh] w-auto max-w-full object-contain rounded-2xl shadow-2xl select-none"
            />
          </div>

          {/* Bottom info pills for quick pickup desk reading */}
          <div
            className="max-w-2xl w-full mx-auto pt-2 flex flex-wrap items-center justify-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {fullscreenImage.pickupCode && (
              <div className="rounded-xl bg-white/15 text-white px-3.5 py-2 flex items-center gap-2.5 text-xs font-medium backdrop-blur-sm shadow-md">
                <span>
                  Hämtkod:{' '}
                  <strong className="font-mono-tabular tracking-wider text-emerald-300 text-sm">
                    {fullscreenImage.pickupCode}
                  </strong>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('fs-code', fullscreenImage.pickupCode!)}
                  className="hover:underline text-emerald-300 inline-flex items-center gap-1 cursor-pointer font-semibold ml-1"
                >
                  {copiedKey === 'fs-code' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'fs-code' ? 'Kopierad!' : 'Kopiera'}</span>
                </button>
              </div>
            )}

            {fullscreenImage.trackingId && (
              <div className="rounded-xl bg-white/15 text-white px-3.5 py-2 flex items-center gap-2.5 text-xs font-medium backdrop-blur-sm shadow-md">
                <span className="truncate max-w-[240px]">
                  Kolli:{' '}
                  <span className="font-mono-tabular text-emerald-300">
                    {fullscreenImage.trackingId}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('fs-track', fullscreenImage.trackingId!)}
                  className="hover:underline text-emerald-300 inline-flex items-center gap-1 cursor-pointer font-semibold ml-1"
                >
                  {copiedKey === 'fs-track' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'fs-track' ? 'Kopierad!' : 'Kopiera'}</span>
                </button>
              </div>
            )}

            {fullscreenImage.ocrNumber && (
              <div className="rounded-xl bg-white/15 text-white px-3.5 py-2 flex items-center gap-2.5 text-xs font-medium backdrop-blur-sm shadow-md">
                <span className="truncate max-w-[240px]">
                  OCR:{' '}
                  <span className="font-mono-tabular text-emerald-300">
                    {fullscreenImage.ocrNumber}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy('fs-ocr', fullscreenImage.ocrNumber!)}
                  className="hover:underline text-emerald-300 inline-flex items-center gap-1 cursor-pointer font-semibold ml-1"
                >
                  {copiedKey === 'fs-ocr' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedKey === 'fs-ocr' ? 'Kopierad!' : 'Kopiera'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
