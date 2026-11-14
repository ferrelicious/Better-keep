import { useState } from 'react';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Pin,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  SnoozePreset,
  formatReminderDateTime,
  isReminderOverdue,
} from '../services/notifications';
import { Note, getColorConfig } from '../types/note';

interface NoteCardProps {
  note: Note;
  onEdit: (note: Note) => void;
  onTogglePin: (noteId: string) => void;
  onDelete: (noteId: string) => void;
  onToggleReminderComplete: (noteId: string) => void;
  onSnoozeReminder: (noteId: string, preset: SnoozePreset) => void;
}

export function NoteCard({
  note,
  onEdit,
  onTogglePin,
  onDelete,
  onToggleReminderComplete,
  onSnoozeReminder,
}: NoteCardProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const colorConfig = getColorConfig(note.color);

  const overdue = note.reminder
    ? isReminderOverdue(note.reminder.at, note.reminder.completed)
    : false;
  const completed = note.reminder?.completed ?? false;

  const formattedUpdated = new Date(note.updatedAt).toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
  });

  return (
    <article
      onClick={() => onEdit(note)}
      className={`group relative rounded-2xl border p-4 sm:p-5 flex flex-col justify-between gap-4 transition-all duration-150 cursor-pointer hover:border-[#18221C]/25 dark:hover:border-[#E3EAE5]/25 ${colorConfig.cardClass}`}
    >
      {/* Top Row: Clean unboxed metadata + Pin & Delete controls */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#525E56] dark:text-[#9BA79F] min-w-0">
            <span className="font-medium truncate">{note.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular whitespace-nowrap shrink-0">
              {formattedUpdated}
            </span>
          </div>

          <div
            className="flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onTogglePin(note.id)}
              aria-label={note.pinned ? 'Lossa anteckning' : 'Fäst anteckning'}
              title={note.pinned ? 'Lossa anteckning' : 'Fäst anteckning'}
              className={`inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl transition-colors duration-150 cursor-pointer ${
                note.pinned
                  ? 'text-[#2E6B4E] dark:text-[#8FD4AE] bg-[#2E6B4E]/10 dark:bg-[#8FD4AE]/15'
                  : 'text-[#525E56] dark:text-[#9BA79F] sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'
              }`}
            >
              <Pin
                className={`w-4 h-4 ${note.pinned ? 'fill-current' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={() => onDelete(note.id)}
              aria-label="Ta bort anteckning"
              title="Ta bort anteckning"
              className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl text-[#525E56] dark:text-[#9BA79F] hover:text-red-700 dark:hover:text-red-400 hover:bg-red-500/10 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition-colors duration-150 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Title & Body */}
        <div className="space-y-1.5">
          {note.title.trim() && (
            <h3 className="font-display text-base font-semibold leading-snug text-balance">
              {note.title}
            </h3>
          )}
          {note.body.trim() && (
            <p className="text-sm leading-relaxed whitespace-pre-line line-clamp-6 opacity-85 break-words">
              {note.body}
            </p>
          )}
        </div>
      </div>

      {/* Reminder Badge & Action Controls */}
      {note.reminder && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative rounded-xl border px-3 py-2.5 flex flex-col gap-2 transition-colors ${
            completed
              ? 'bg-black/[0.03] dark:bg-white/[0.04] border-black/10 dark:border-white/10 opacity-75'
              : overdue
                ? 'bg-red-600/10 dark:bg-red-500/15 border-red-600/25 dark:border-red-400/30 text-red-900 dark:text-red-200'
                : 'bg-black/[0.04] dark:bg-white/[0.06] border-black/10 dark:border-white/10'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {completed ? (
                <CheckCircle2
                  className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE] shrink-0"
                  aria-hidden="true"
                />
              ) : overdue ? (
                <AlertCircle
                  className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0"
                  aria-hidden="true"
                />
              ) : (
                <Bell
                  className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE] shrink-0"
                  aria-hidden="true"
                />
              )}

              <span
                className={`font-mono-tabular text-xs font-medium truncate ${
                  completed ? 'line-through' : ''
                }`}
              >
                {formatReminderDateTime(note.reminder.at)}
              </span>
            </div>

            <span className="text-[11px] font-semibold shrink-0">
              {completed ? 'Klar' : overdue ? 'Försenad' : 'Påminnelse'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setSnoozeOpen(false);
                onToggleReminderComplete(note.id);
              }}
              className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg text-xs font-medium bg-white/80 dark:bg-black/25 hover:bg-white dark:hover:bg-black/40 border border-black/10 dark:border-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              {completed ? (
                <>
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Återuppta</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                  <span>Markera klar</span>
                </>
              )}
            </button>

            {!completed && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSnoozeOpen((prev) => !prev)}
                  aria-expanded={snoozeOpen}
                  className="inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg text-xs font-medium bg-white/80 dark:bg-black/25 hover:bg-white dark:hover:bg-black/40 border border-black/10 dark:border-white/10 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Snooza</span>
                </button>

                {snoozeOpen && (
                  <div
                    role="menu"
                    className="absolute left-0 bottom-full mb-1.5 z-20 min-w-[148px] rounded-xl bg-white dark:bg-[#212723] border border-[#18221C]/15 dark:border-[#E3EAE5]/15 shadow-lg p-1 flex flex-col"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSnoozeReminder(note.id, '15m');
                        setSnoozeOpen(false);
                      }}
                      className="text-left px-3 py-2 text-xs font-medium rounded-lg text-[#171D19] dark:text-[#E4EBE6] hover:bg-[#ECEFE9] dark:hover:bg-[#2A312D] cursor-pointer"
                    >
                      +15 minuter
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSnoozeReminder(note.id, '1h');
                        setSnoozeOpen(false);
                      }}
                      className="text-left px-3 py-2 text-xs font-medium rounded-lg text-[#171D19] dark:text-[#E4EBE6] hover:bg-[#ECEFE9] dark:hover:bg-[#2A312D] cursor-pointer"
                    >
                      +1 timme
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onSnoozeReminder(note.id, 'tomorrow');
                        setSnoozeOpen(false);
                      }}
                      className="text-left px-3 py-2 text-xs font-medium rounded-lg text-[#171D19] dark:text-[#E4EBE6] hover:bg-[#ECEFE9] dark:hover:bg-[#2A312D] cursor-pointer"
                    >
                      Imorgon 09:00
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
