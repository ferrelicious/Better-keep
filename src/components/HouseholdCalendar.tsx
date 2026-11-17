import type React from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  Calendar as CalendarIcon,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { getMemberAvatarUrl, getMemberDisplayName } from '../services/profiles';
import { HouseholdMember } from '../services/supabase';
import { MemberAvatar } from './MemberAvatar';

export interface HouseholdEvent {
  id: string;
  household_id: string;
  created_by: string;
  title: string;
  notes?: string | null;
  event_date: string; // YYYY-MM-DD
  event_time?: string | null; // HH:mm
  remind_before_minutes?: number | null;
  is_private?: boolean;
  created_at?: string;
}

type CalendarFilter = 'all' | 'shared' | 'private';

interface HouseholdCalendarProps {
  events: HouseholdEvent[];
  householdName?: string;
  members?: HouseholdMember[];
  userEmail: string | null;
  onAddEvent: (draft: {
    title: string;
    notes: string;
    event_date: string;
    event_time: string;
    remind_before_minutes: number;
    is_private: boolean;
  }) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
  onNavigateToShopping?: (storeName: string) => void;
  onNavigateToMail?: (ev: HouseholdEvent) => void;
  onOpenHouseholdModal: () => void;
}

function classifyCalendarEvent(
  ev: HouseholdEvent
): { kind: 'shopping'; storeName: string } | { kind: 'mail' } | null {
  const title = (ev.title || '').trim();
  const activeShopMatch = title.match(
    /^🛒\s*Handla på\s+(.+?)(?:\s*\(\d+\s*varor?\))?$/i
  );
  if (activeShopMatch) {
    return { kind: 'shopping', storeName: activeShopMatch[1].trim() };
  }
  const doneShopMatch = title.match(/^✅\s*Handlat klart på\s+(.+)$/i);
  if (doneShopMatch) {
    return { kind: 'shopping', storeName: doneShopMatch[1].trim() };
  }
  if (/^(?:🛒\s*Handla|✅\s*Handlat klart)\b/i.test(title)) {
    return { kind: 'shopping', storeName: '' };
  }
  if (
    /^(?:📦\s*Sista hämtningsdag:|💳\s*Förfallodatum(?:\s+räkning)?:|✉️\s*Viktigt brev:|✅\s*Hämtat\s*\/\s*Betald:)/i.test(
      title
    )
  ) {
    return { kind: 'mail' };
  }
  return null;
}

const WEEKDAYS = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'];
const MONTHS = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
];

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getISOWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function exportToPhoneCalendar(ev: HouseholdEvent, members: HouseholdMember[] = []) {
  const cleanDate = ev.event_date.replace(/-/g, '');
  const cleanTime = (ev.event_time || '09:00').replace(':', '') + '00';
  const startStamp = `${cleanDate}T${cleanTime}`;

  const [hh, mm] = (ev.event_time || '09:00').split(':').map(Number);
  const endHour = String((hh + 1) % 24).padStart(2, '0');
  const endStamp = `${cleanDate}T${endHour}${String(mm).padStart(2, '0')}00`;

  const creatorName = getMemberDisplayName(ev.created_by, members);

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BetterKeep//Ferrelicious//SV',
    'BEGIN:VEVENT',
    `UID:${ev.id}@betterkeep`,
    `DTSTAMP:${startStamp}`,
    `DTSTART:${startStamp}`,
    `DTEND:${endStamp}`,
    `SUMMARY:${ev.title}`,
    `DESCRIPTION:${(ev.notes || '').replace(/\n/g, '\\n')} (Inlagd av ${creatorName})`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([icsLines], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ev.title.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_')}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function HouseholdCalendar({
  events,
  householdName,
  members = [],
  userEmail,
  onAddEvent,
  onDeleteEvent,
  onNavigateToShopping,
  onNavigateToMail,
  onOpenHouseholdModal,
}: HouseholdCalendarProps) {
  const todayStr = useMemo(() => toYMD(new Date()), []);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [calendarFilter, setCalendarFilter] = useState<CalendarFilter>('all');

  const [title, setTitle] = useState('');
  const [time, setTime] = useState('14:00');
  const [notes, setNotes] = useState('');
  const [remindBefore, setRemindBefore] = useState<number>(60);
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  // Defense-in-depth: never display someone else's private events, then apply filter tab
  const visibleEvents = useMemo(() => {
    const myEmail = (userEmail ?? '').toLowerCase();
    return events.filter((ev) => {
      const isMine = ev.created_by.toLowerCase() === myEmail;
      if (ev.is_private && !isMine) return false;
      if (calendarFilter === 'shared') return !ev.is_private;
      if (calendarFilter === 'private') return Boolean(ev.is_private) && isMine;
      return true;
    });
  }, [events, userEmail, calendarFilter]);

  const weeks = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ dateStr: string | null; dayNum: number | null }> = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ dateStr: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateStr: ds, dayNum: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateStr: null, dayNum: null });
    }

    const rows: Array<{
      weekNum: number;
      days: Array<{ dateStr: string | null; dayNum: number | null }>;
    }> = [];

    for (let i = 0; i < cells.length; i += 7) {
      const slice = cells.slice(i, i + 7);
      const refDate =
        slice.find((c) => c.dateStr)?.dateStr ||
        `${year}-${String(month + 1).padStart(2, '0')}-01`;
      rows.push({
        weekNum: getISOWeek(refDate),
        days: slice,
      });
    }
    return rows;
  }, [year, month]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, HouseholdEvent[]>();
    for (const ev of visibleEvents) {
      const list = map.get(ev.event_date) ?? [];
      list.push(ev);
      map.set(ev.event_date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.event_time || '99:99').localeCompare(b.event_time || '99:99'));
    }
    return map;
  }, [visibleEvents]);

  const selectedDayEvents = eventsByDate.get(selectedDate) ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await onAddEvent({
        title: title.trim(),
        notes: notes.trim(),
        event_date: selectedDate,
        event_time: time,
        remind_before_minutes: remindBefore,
        is_private: isPrivate,
      });
      setTitle('');
      setNotes('');
    } finally {
      setSaving(false);
    }
  };

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold">Gemensam Familjekalender</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Logga in och koppla ihop ert hushåll så synkas alla bokningar (t.ex. veterinär, BVC eller bilservice) direkt mellan era telefoner.
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
    <div className="flex flex-col gap-5">
      {/* Flikväxlare: Alla / Gemensam / Privat */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div
          role="tablist"
          aria-label="Filtrera kalenderhändelser"
          className="inline-flex items-center gap-1 p-1 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723]"
        >
          {(
            [
              { id: 'all', label: 'Alla' },
              { id: 'shared', label: 'Gemensam' },
              { id: 'private', label: 'Privat' },
            ] as const
          ).map((tab) => {
            const active = calendarFilter === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setCalendarFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-white dark:bg-[#191D1A] text-[#171D19] dark:text-[#E4EBE6] shadow-xs'
                    : 'text-[#525E56] dark:text-[#9BA79F]'
                }`}
              >
                {tab.id === 'private' && <Lock className="w-3 h-3" aria-hidden="true" />}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[#525E56] dark:text-[#9BA79F]">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#2E6B4E] dark:bg-[#8FD4AE]" /> Dina
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#264E70] dark:bg-[#9ECAFF]" /> Partner
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#6E4C8E] dark:bg-[#C6A4EA]" /> Privat
          </span>
        </div>
      </div>

      {/* Fullbredds månadskalender i Samsung / Google Kalender-stil */}
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 overflow-hidden shadow-xs">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10">
          <div className="flex items-center gap-2.5">
            <CalendarIcon className="w-5 h-5 text-[#2E6B4E] dark:text-[#8FD4AE]" />
            <h2 className="font-display text-lg sm:text-xl font-bold">
              {MONTHS[month]} {year}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setViewDate(now);
                setSelectedDate(toYMD(now));
              }}
              className="px-3 py-1.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-xs font-semibold cursor-pointer"
            >
              Idag
            </button>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1, 1))}
              aria-label="Föregående månad"
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#ECEFE9] dark:hover:bg-[#212723] cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1, 1))}
              aria-label="Nästa månad"
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#ECEFE9] dark:hover:bg-[#212723] cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Veckodagsrubriker med veckonummer-kolumn */}
        <div className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] sm:grid-cols-[38px_repeat(7,minmax(0,1fr))] bg-[#F6F7F4] dark:bg-[#141816] border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-center">
          <div className="text-[10px] font-semibold text-[#525E56] dark:text-[#9BA79F] py-2">v.</div>
          {WEEKDAYS.map((wd, idx) => (
            <div
              key={wd}
              className={`text-[11px] font-semibold py-2 ${
                idx >= 5
                  ? 'text-[#B3261E] dark:text-[#F2B8B5]'
                  : 'text-[#525E56] dark:text-[#9BA79F]'
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        {/* Rutnät med synliga händelseremsor inuti varje datum */}
        <div className="divide-y divide-[#18221C]/10 dark:divide-[#E3EAE5]/10">
          {weeks.map((week, wIdx) => (
            <div
              key={`week-${wIdx}`}
              className="grid grid-cols-[30px_repeat(7,minmax(0,1fr))] sm:grid-cols-[38px_repeat(7,minmax(0,1fr))]"
            >
              <div className="flex items-start justify-center pt-2 text-[10px] font-mono-tabular text-[#525E56] dark:text-[#9BA79F] bg-[#F6F7F4]/60 dark:bg-[#141816]/60 border-r border-[#18221C]/10 dark:border-[#E3EAE5]/10">
                {week.weekNum}
              </div>

              {week.days.map((cell, dIdx) => {
                if (!cell.dateStr || !cell.dayNum) {
                  return (
                    <div
                      key={`empty-${wIdx}-${dIdx}`}
                      className="min-h-[68px] sm:min-h-[88px] bg-[#F6F7F4]/30 dark:bg-[#111412]/30 border-r last:border-r-0 border-[#18221C]/10 dark:border-[#E3EAE5]/10"
                    />
                  );
                }

                const dayEvents = eventsByDate.get(cell.dateStr) ?? [];
                const isSelected = cell.dateStr === selectedDate;
                const isToday = cell.dateStr === todayStr;
                const isWeekend = dIdx >= 5;

                return (
                  <button
                    key={cell.dateStr}
                    type="button"
                    onClick={() => setSelectedDate(cell.dateStr!)}
                    className={`min-h-[68px] sm:min-h-[88px] p-1 sm:p-1.5 flex flex-col items-stretch text-left border-r last:border-r-0 border-[#18221C]/10 dark:border-[#E3EAE5]/10 transition cursor-pointer overflow-hidden ${
                      isSelected
                        ? 'bg-[#D3EBD9]/55 dark:bg-[#1C4A34]/45 ring-2 ring-inset ring-[#2E6B4E] dark:ring-[#8FD4AE]'
                        : 'hover:bg-[#ECEFE9]/60 dark:hover:bg-[#212723]/60'
                    }`}
                  >
                    <span
                      className={`self-center sm:self-start w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono-tabular mb-1 ${
                        isToday
                          ? 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] font-bold'
                          : isWeekend
                            ? 'text-[#B3261E] dark:text-[#F2B8B5] font-medium'
                            : 'font-medium'
                      }`}
                    >
                      {cell.dayNum}
                    </span>

                    <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                      {dayEvents.slice(0, 2).map((ev) => {
                        const isMine = ev.created_by.toLowerCase() === userEmail.toLowerCase();
                        return (
                          <div
                            key={ev.id}
                            className={`px-1 py-0.5 rounded text-[9px] sm:text-[11px] font-medium truncate leading-tight flex items-center gap-0.5 ${
                              ev.is_private
                                ? 'bg-[#6E4C8E] dark:bg-[#C6A4EA] text-white dark:text-[#2B1245]'
                                : isMine
                                  ? 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822]'
                                  : 'bg-[#264E70] dark:bg-[#9ECAFF] text-white dark:text-[#003258]'
                            }`}
                          >
                            {ev.is_private && (
                              <Lock className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">
                              {ev.event_time ? `${ev.event_time} ` : ''}
                              {ev.title}
                            </span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 2 && (
                        <span className="text-[9px] font-semibold text-[#525E56] dark:text-[#9BA79F] px-0.5">
                          +{dayEvents.length - 2} till
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Detaljvy & ny bokning för vald dag */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <form
          onSubmit={handleCreate}
          className="lg:col-span-6 rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-4 sm:p-5 flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold">
              Ny bokning ·{' '}
              <span className="font-mono-tabular text-[#2E6B4E] dark:text-[#8FD4AE]">
                {selectedDate}
              </span>
            </h3>
            <span className="text-[11px] text-[#525E56] dark:text-[#9BA79F]">
              {isPrivate ? 'Privat' : householdName}
            </span>
          </div>

          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="T.ex. Bokad tid hos veterinären..."
            className="w-full h-10 px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
          />

          <div className="grid grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-[#525E56] dark:text-[#9BA79F]">
              <span>Tid</span>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-medium text-[#525E56] dark:text-[#9BA79F]">
              <span>{isPrivate ? 'Påminn mig' : 'Påminn båda'}</span>
              <select
                value={remindBefore}
                onChange={(e) => setRemindBefore(Number(e.target.value))}
                className="h-10 px-2.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6]"
              >
                <option value={15}>15 min före</option>
                <option value={60}>1 timme före</option>
                <option value={180}>3 timmar före</option>
                <option value={1440}>1 dag före</option>
              </select>
            </label>
          </div>

          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Valfri detalj (adress, kom ihåg...)"
            className="w-full h-10 px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
          />

          {/* Switch: Privat bokning */}
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 px-3.5 py-2.5 cursor-pointer select-none">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Lock
                className={`w-4 h-4 ${
                  isPrivate
                    ? 'text-[#6E4C8E] dark:text-[#C6A4EA]'
                    : 'text-[#525E56] dark:text-[#9BA79F]'
                }`}
                aria-hidden="true"
              />
              <span>Privat bokning (syns bara för mig)</span>
            </div>
            <input
              type="checkbox"
              role="switch"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="sr-only peer"
            />
            <span className="w-10 h-6 rounded-full bg-[#18221C]/20 dark:bg-[#E3EAE5]/20 peer-checked:bg-[#6E4C8E] dark:peer-checked:bg-[#C6A4EA] relative transition-colors shrink-0 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
          </label>

          <button
            type="submit"
            disabled={saving || !title.trim()}
            className={`min-h-[42px] rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer transition-colors ${
              isPrivate
                ? 'bg-[#6E4C8E] dark:bg-[#C6A4EA] text-white dark:text-[#2B1245]'
                : 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822]'
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>
              {saving
                ? 'Sparar...'
                : isPrivate
                  ? 'Lägg till privat bokning'
                  : 'Lägg till i gemensam kalender'}
            </span>
          </button>
        </form>

        <div className="lg:col-span-6 rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-4 sm:p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
              Bokningar {selectedDate} ({selectedDayEvents.length})
            </h3>
          </div>

          {selectedDayEvents.length === 0 ? (
            <p className="text-sm text-[#525E56] dark:text-[#9BA79F] py-2">
              Inga bokningar inlagda denna dag. Tryck på valfri dag i kalendern ovan för att boka.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {selectedDayEvents.map((ev) => {
                const linkTarget = classifyCalendarEvent(ev);
                const canJump =
                  (linkTarget?.kind === 'shopping' && Boolean(onNavigateToShopping)) ||
                  (linkTarget?.kind === 'mail' && Boolean(onNavigateToMail));

                const handleJump = () => {
                  if (!linkTarget) return;
                  if (linkTarget.kind === 'shopping') {
                    onNavigateToShopping?.(linkTarget.storeName);
                  } else if (linkTarget.kind === 'mail') {
                    onNavigateToMail?.(ev);
                  }
                };

                return (
                  <div
                    key={ev.id}
                    className={`rounded-2xl p-3 flex items-start justify-between gap-3 border transition-colors ${
                      ev.is_private
                        ? 'bg-[#F3EDF8] dark:bg-[#261E31] border-[#6E4C8E]/20 dark:border-[#C6A4EA]/20'
                        : 'bg-[#F6F7F4] dark:bg-[#212723] border-transparent'
                    } ${canJump ? 'hover:border-[#2E6B4E]/35 dark:hover:border-[#8FD4AE]/35' : ''}`}
                  >
                    {canJump ? (
                      <button
                        type="button"
                        onClick={handleJump}
                        className="min-w-0 flex-1 text-left cursor-pointer group"
                      >
                        <div className="flex items-center gap-2">
                          {ev.is_private && (
                            <Lock
                              className="w-3.5 h-3.5 text-[#6E4C8E] dark:text-[#C6A4EA] shrink-0"
                              aria-label="Privat bokning"
                            />
                          )}
                          {ev.event_time && (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-mono-tabular font-semibold ${
                                ev.is_private
                                  ? 'text-[#6E4C8E] dark:text-[#C6A4EA]'
                                  : 'text-[#2E6B4E] dark:text-[#8FD4AE]'
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              {ev.event_time}
                            </span>
                          )}
                          <p className="text-sm font-semibold truncate group-hover:underline">
                            {ev.title}
                          </p>
                        </div>
                        {ev.notes && (
                          <p className="text-xs text-[#525E56] dark:text-[#9BA79F] mt-1">
                            {ev.notes}
                          </p>
                        )}
                        <div className="flex items-center gap-2 flex-wrap mt-1.5">
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E6B4E] dark:text-[#8FD4AE]">
                            <span>
                              {linkTarget?.kind === 'shopping'
                                ? 'Öppna i Inköp'
                                : 'Öppna i Post'}
                            </span>
                            <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                          </span>
                          <span className="text-[11px] text-[#525E56] dark:text-[#9BA79F] flex items-center gap-1.5">
                            {ev.is_private ? (
                              <>
                                <Bell className="w-3 h-3" />
                                <span>Privat bokning (visas bara för dig)</span>
                              </>
                            ) : (
                              <>
                                <MemberAvatar
                                  size="xs"
                                  name={getMemberDisplayName(ev.created_by, members)}
                                  avatarUrl={getMemberAvatarUrl(ev.created_by, members)}
                                />
                                <span>
                                  Inlagd av {getMemberDisplayName(ev.created_by, members)}
                                </span>
                              </>
                            )}
                          </span>
                        </div>
                      </button>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {ev.is_private && (
                            <Lock
                              className="w-3.5 h-3.5 text-[#6E4C8E] dark:text-[#C6A4EA] shrink-0"
                              aria-label="Privat bokning"
                            />
                          )}
                          {ev.event_time && (
                            <span
                              className={`inline-flex items-center gap-1 text-xs font-mono-tabular font-semibold ${
                                ev.is_private
                                  ? 'text-[#6E4C8E] dark:text-[#C6A4EA]'
                                  : 'text-[#2E6B4E] dark:text-[#8FD4AE]'
                              }`}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              {ev.event_time}
                            </span>
                          )}
                          <p className="text-sm font-semibold truncate">{ev.title}</p>
                        </div>
                        {ev.notes && (
                          <p className="text-xs text-[#525E56] dark:text-[#9BA79F] mt-1">
                            {ev.notes}
                          </p>
                        )}
                        <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] mt-1.5 flex items-center gap-1.5">
                          {ev.is_private ? (
                            <>
                              <Bell className="w-3 h-3" />
                              <span>Privat bokning (visas bara för dig)</span>
                            </>
                          ) : (
                            <>
                              <MemberAvatar
                                size="xs"
                                name={getMemberDisplayName(ev.created_by, members)}
                                avatarUrl={getMemberAvatarUrl(ev.created_by, members)}
                              />
                              <span>
                                Inlagd av {getMemberDisplayName(ev.created_by, members)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => exportToPhoneCalendar(ev, members)}
                        title="Lägg i telefonens kalender (Samsung/Google)"
                        aria-label="Lägg i telefonens kalender"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#2E6B4E] dark:text-[#8FD4AE] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                      >
                        <CalendarPlus className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEvent(ev.id)}
                        aria-label="Ta bort bokning"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#525E56] hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
