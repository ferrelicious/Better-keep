import type React from 'react';
import { useEffect, useState } from 'react';
import { Bell, Check, Lock, Pin, Trash2, X } from 'lucide-react';
import {
  NOTE_CATEGORIES,
  NOTE_COLORS,
  Note,
  NoteCategory,
  NoteColor,
  getColorConfig,
} from '../types/note';

interface NoteEditorModalProps {
  isOpen: boolean;
  initialNote: Note | null;
  defaultCategory: NoteCategory;
  onClose: () => void;
  onSave: (draft: {
    id?: string;
    title: string;
    body: string;
    category: NoteCategory;
    color: NoteColor;
    pinned: boolean;
    isPrivate: boolean;
    reminder: { at: string; completed: boolean } | null;
  }) => void;
  onDelete?: (noteId: string) => void;
}

function toLocalDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '09:00';
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function NoteEditorModal({
  isOpen,
  initialNote,
  defaultCategory,
  onClose,
  onSave,
  onDelete,
}: NoteEditorModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<NoteCategory>(defaultCategory);
  const [color, setColor] = useState<NoteColor>('default');
  const [pinned, setPinned] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('09:00');
  const [reminderCompleted, setReminderCompleted] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (initialNote) {
      setTitle(initialNote.title);
      setBody(initialNote.body);
      setCategory(initialNote.category);
      setColor(initialNote.color);
      setPinned(initialNote.pinned);
      setIsPrivate(Boolean(initialNote.isPrivate));
      if (initialNote.reminder) {
        setReminderDate(toLocalDateInput(initialNote.reminder.at));
        setReminderTime(toLocalTimeInput(initialNote.reminder.at));
        setReminderCompleted(initialNote.reminder.completed);
      } else {
        setReminderDate('');
        setReminderTime('09:00');
        setReminderCompleted(false);
      }
    } else {
      setTitle('');
      setBody('');
      setCategory(defaultCategory);
      setColor('default');
      setPinned(false);
      setIsPrivate(false);
      setReminderDate('');
      setReminderTime('09:00');
      setReminderCompleted(false);
    }
  }, [isOpen, initialNote, defaultCategory]);

  if (!isOpen) return null;

  const applyQuickReminder = (mode: 'today18' | 'tomorrow9' | 'nextWeek') => {
    const d = new Date();
    if (mode === 'today18') {
      d.setHours(18, 0, 0, 0);
      if (d.getTime() < Date.now()) {
        d.setDate(d.getDate() + 1);
      }
    } else if (mode === 'tomorrow9') {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
    } else {
      d.setDate(d.getDate() + 7);
      d.setHours(9, 0, 0, 0);
    }
    setReminderDate(toLocalDateInput(d.toISOString()));
    setReminderTime(toLocalTimeInput(d.toISOString()));
    setReminderCompleted(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !body.trim()) return;

    let reminder: { at: string; completed: boolean } | null = null;
    if (reminderDate) {
      const timePart = reminderTime || '09:00';
      const combined = new Date(`${reminderDate}T${timePart}`);
      if (!Number.isNaN(combined.getTime())) {
        reminder = {
          at: combined.toISOString(),
          completed: reminderCompleted,
        };
      }
    }

    onSave({
      id: initialNote?.id,
      title: title.trim(),
      body: body.trim(),
      category,
      color,
      pinned,
      isPrivate,
      reminder,
    });
  };

  const colorStyle = getColorConfig(color);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="note-editor-title"
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className={`w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border shadow-2xl p-5 sm:p-6 flex flex-col gap-5 transition-colors ${colorStyle.cardClass}`}
      >
        {/* Mobile grab handle */}
        <div className="sm:hidden w-10 h-1.5 rounded-full bg-current opacity-20 mx-auto -mt-1" />

        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3">
          <h2 id="note-editor-title" className="font-display text-lg font-semibold">
            {initialNote ? 'Redigera anteckning' : 'Ny anteckning'}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPinned((p) => !p)}
              aria-pressed={pinned}
              className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                pinned
                  ? 'bg-[#2E6B4E] text-white dark:bg-[#8FD4AE] dark:text-[#063822]'
                  : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
              }`}
            >
              <Pin className={`w-3.5 h-3.5 ${pinned ? 'fill-current' : ''}`} aria-hidden="true" />
              <span>{pinned ? 'Fäst' : 'Fäst'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Stäng"
              className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Title & Body */}
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Rubrik"
            autoFocus
            className="w-full bg-transparent text-lg font-display font-semibold placeholder:opacity-50 focus:outline-none border-b border-black/10 dark:border-white/10 pb-2"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Skriv din anteckning här..."
            rows={5}
            className="w-full bg-transparent text-sm sm:text-base leading-relaxed placeholder:opacity-50 focus:outline-none resize-y min-h-[120px]"
          />
        </div>

        {/* Category Selector */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-75">Kategori</span>
          <div className="flex items-center gap-2 flex-wrap">
            {NOTE_CATEGORIES.map((cat) => {
              const selected = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    selected
                      ? 'bg-[#2E6B4E] text-white dark:bg-[#8FD4AE] dark:text-[#063822]'
                      : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Swatches */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium opacity-75">Färgtema</span>
          <div className="flex items-center gap-2.5 flex-wrap">
            {NOTE_COLORS.map((c) => {
              const selected = color === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  aria-label={c.label}
                  title={c.label}
                  className={`w-9 h-9 rounded-full border-2 flex items-center justify-center transition-transform cursor-pointer ${
                    c.swatchClass
                  } ${selected ? 'scale-110 ring-2 ring-[#2E6B4E] dark:ring-[#8FD4AE] ring-offset-2 ring-offset-transparent' : 'hover:scale-105'}`}
                >
                  {selected && <Check className="w-4 h-4" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date & Time Reminder Picker */}
        <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
              <span>Påminnelse</span>
            </div>
            {reminderDate && (
              <button
                type="button"
                onClick={() => {
                  setReminderDate('');
                  setReminderCompleted(false);
                }}
                className="text-xs font-medium text-red-700 dark:text-red-400 hover:underline cursor-pointer"
              >
                Ta bort påminnelse
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="flex flex-col gap-1 text-xs opacity-80">
              <span>Datum</span>
              <input
                type="date"
                value={reminderDate}
                onChange={(e) => {
                  setReminderDate(e.target.value);
                  setReminderCompleted(false);
                }}
                className="w-full h-10 px-3 rounded-xl bg-white/80 dark:bg-black/30 border border-black/15 dark:border-white/15 text-sm font-mono-tabular [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs opacity-80">
              <span>Tid</span>
              <input
                type="time"
                value={reminderTime}
                onChange={(e) => {
                  setReminderTime(e.target.value);
                  setReminderCompleted(false);
                }}
                disabled={!reminderDate}
                className="w-full h-10 px-3 rounded-xl bg-white/80 dark:bg-black/30 border border-black/15 dark:border-white/15 text-sm font-mono-tabular [color-scheme:light] dark:[color-scheme:dark] disabled:opacity-45 focus:outline-none focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE]"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => applyQuickReminder('today18')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/75 dark:bg-black/25 border border-black/10 dark:border-white/10 hover:bg-white dark:hover:bg-black/40 cursor-pointer"
            >
              Idag 18:00
            </button>
            <button
              type="button"
              onClick={() => applyQuickReminder('tomorrow9')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/75 dark:bg-black/25 border border-black/10 dark:border-white/10 hover:bg-white dark:hover:bg-black/40 cursor-pointer"
            >
              Imorgon 09:00
            </button>
            <button
              type="button"
              onClick={() => applyQuickReminder('nextWeek')}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white/75 dark:bg-black/25 border border-black/10 dark:border-white/10 hover:bg-white dark:hover:bg-black/40 cursor-pointer"
            >
              Om 1 vecka
            </button>
            {reminderDate && (
              <button
                type="button"
                onClick={() => setReminderCompleted((c) => !c)}
                className={`ml-auto px-2.5 py-1.5 rounded-lg text-xs font-medium border cursor-pointer ${
                  reminderCompleted
                    ? 'bg-[#2E6B4E] text-white border-transparent dark:bg-[#8FD4AE] dark:text-[#063822]'
                    : 'bg-white/75 dark:bg-black/25 border-black/10 dark:border-white/10'
                }`}
              >
                {reminderCompleted ? 'Markerad som klar' : 'Markera som klar'}
              </button>
            )}
          </div>
        </div>

        {/* Private Note Toggle */}
        <label className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] px-4 py-3 cursor-pointer select-none">
          <div className="flex items-center gap-2.5 text-sm font-medium">
            <Lock
              className={`w-4 h-4 ${
                isPrivate
                  ? 'text-[#6E4C8E] dark:text-[#C6A4EA]'
                  : 'opacity-65'
              }`}
              aria-hidden="true"
            />
            <span>Privat anteckning (syns bara för mig)</span>
          </div>
          <input
            type="checkbox"
            role="switch"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="sr-only peer"
          />
          <span className="w-10 h-6 rounded-full bg-black/20 dark:bg-white/20 peer-checked:bg-[#6E4C8E] dark:peer-checked:bg-[#C6A4EA] relative transition-colors shrink-0 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
        </label>

        {/* Footer Buttons */}
        <div className="flex items-center justify-between gap-3 pt-1">
          {initialNote && onDelete ? (
            <button
              type="button"
              onClick={() => {
                onDelete(initialNote.id);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              <span>Ta bort</span>
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={!title.trim() && !body.trim()}
              className="min-h-[44px] px-5 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-sm font-semibold disabled:opacity-40 transition-colors cursor-pointer"
            >
              Spara anteckning
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
