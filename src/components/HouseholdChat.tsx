import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Download,
  FileText,
  Loader2,
  Lock,
  MessageCircle,
  Mic,
  Paperclip,
  Send,
  Square,
  StickyNote,
  Users,
  X,
} from 'lucide-react';
import {
  decryptBlob,
  decryptText,
  inferMimeTypeFromFilename,
} from '../services/crypto';
import { supabase } from '../services/supabase';

export interface HouseholdMessage {
  id: string;
  household_id: string;
  sender_email: string;
  body: string;
  is_encrypted?: boolean;
  attachment_url?: string | null;
  attachment_type?: 'image' | 'file' | 'audio' | null;
  attachment_name?: string | null;
  created_at: string;
}

export interface OutgoingChatPayload {
  text: string;
  file?: Blob;
  attachmentType?: 'image' | 'file' | 'audio';
  originalName?: string;
}

interface HouseholdChatProps {
  messages: HouseholdMessage[];
  householdName?: string;
  encryptionSecret: string | null;
  userEmail: string | null;
  onSendMessage: (payload: OutgoingChatPayload) => Promise<void>;
  onSaveAsNote: (body: string) => Promise<void>;
  onOpenHouseholdModal: () => void;
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface EncryptedMessageBubbleProps {
  msg: HouseholdMessage;
  isMine: boolean;
  encryptionSecret: string | null;
  onSaveAsNote: (decryptedBody: string) => Promise<void>;
  onPreviewImage: (url: string, name: string) => void;
}

function EncryptedMessageBubble({
  msg,
  isMine,
  encryptionSecret,
  onSaveAsNote,
  onPreviewImage,
}: EncryptedMessageBubbleProps) {
  const [decryptedBody, setDecryptedBody] = useState<string>(() =>
    msg.is_encrypted ? '' : msg.body
  );
  const [decryptedName, setDecryptedName] = useState<string>('Fil');
  const [decryptFailed, setDecryptFailed] = useState(false);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!msg.is_encrypted) {
        if (active) {
          setDecryptedBody(msg.body);
          setDecryptedName(msg.attachment_name || 'Fil');
          setDecryptFailed(false);
        }
        return;
      }

      if (!encryptionSecret) {
        if (active) {
          setDecryptedBody('Låst meddelande');
          setDecryptFailed(true);
        }
        return;
      }

      try {
        const plainBody = msg.body ? await decryptText(msg.body, encryptionSecret) : '';
        const plainName = msg.attachment_name
          ? await decryptText(msg.attachment_name, encryptionSecret)
          : 'Bilaga';
        if (active) {
          setDecryptedBody(plainBody);
          setDecryptedName(plainName);
          setDecryptFailed(false);
        }
      } catch {
        if (active) {
          setDecryptedBody('Kunde inte dekryptera meddelandet (kontrollera lösenfras).');
          setDecryptedName('Krypterad fil');
          setDecryptFailed(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [msg.body, msg.attachment_name, msg.is_encrypted, encryptionSecret]);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;

    if (!msg.attachment_url || !encryptionSecret || decryptFailed) {
      setMediaUrl(null);
      return;
    }

    (async () => {
      setMediaLoading(true);
      setMediaError(null);
      try {
        const { data, error } = await supabase.storage
          .from('household-media')
          .download(msg.attachment_url!);

        if (error || !data) {
          throw new Error(error?.message || 'Kunde inte hämta krypterad bilaga');
        }

        const mime = inferMimeTypeFromFilename(decryptedName, msg.attachment_type);
        const plainBlob = await decryptBlob(data, encryptionSecret, mime);
        createdUrl = URL.createObjectURL(plainBlob);
        if (active) {
          setMediaUrl(createdUrl);
        } else {
          URL.revokeObjectURL(createdUrl);
        }
      } catch {
        if (active) {
          setMediaError('Kunde inte dekryptera bilagan.');
        }
      } finally {
        if (active) setMediaLoading(false);
      }
    })();

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [msg.attachment_url, msg.attachment_type, decryptedName, encryptionSecret, decryptFailed]);

  const canSaveNote = Boolean(decryptedBody.trim()) && !decryptFailed;

  return (
    <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
      <span className="text-[10px] text-[#525E56] dark:text-[#9BA79F] px-1 mb-0.5">
        {isMine ? 'Du' : msg.sender_email.split('@')[0]} · {formatMsgTime(msg.created_at)}
      </span>
      <div className="group flex items-center gap-1.5 max-w-[85%] sm:max-w-[75%]">
        {isMine && canSaveNote && (
          <button
            type="button"
            onClick={() => onSaveAsNote(decryptedBody)}
            title="Spara som anteckning"
            className="opacity-60 hover:opacity-100 p-1.5 rounded-lg text-[#525E56] dark:text-[#9BA79F] cursor-pointer"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
        )}

        <div
          className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words flex flex-col gap-2 ${
            isMine
              ? 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] rounded-br-sm'
              : 'bg-[#ECEFE9] dark:bg-[#212723] text-[#171D19] dark:text-[#E4EBE6] rounded-bl-sm'
          }`}
        >
          {msg.attachment_url && (
            <div>
              {mediaLoading ? (
                <div className="flex items-center gap-2 text-xs opacity-80 py-1">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Dekrypterar bilaga...</span>
                </div>
              ) : mediaError ? (
                <p className="text-xs opacity-80">{mediaError}</p>
              ) : mediaUrl ? (
                msg.attachment_type === 'image' ? (
                  <button
                    type="button"
                    onClick={() => onPreviewImage(mediaUrl, decryptedName)}
                    className="block rounded-xl overflow-hidden max-w-[240px] cursor-pointer focus:outline-none"
                  >
                    <img
                      src={mediaUrl}
                      alt={decryptedName}
                      className="max-h-56 w-auto object-cover rounded-xl"
                    />
                  </button>
                ) : msg.attachment_type === 'audio' ? (
                  <div className="flex flex-col gap-1 min-w-[210px] sm:min-w-[250px]">
                    <audio controls src={mediaUrl} className="w-full h-9" />
                  </div>
                ) : (
                  <a
                    href={mediaUrl}
                    download={decryptedName}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                      isMine
                        ? 'bg-black/15 hover:bg-black/25 text-white dark:text-[#063822]'
                        : 'bg-white/75 dark:bg-black/25 hover:bg-white dark:hover:bg-black/40'
                    }`}
                  >
                    <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate max-w-[170px]">{decryptedName}</span>
                    <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                )
              ) : null}
            </div>
          )}

          {decryptedBody && (
            <span className={decryptFailed ? 'italic opacity-80 text-xs' : ''}>
              {decryptedBody}
            </span>
          )}
        </div>

        {!isMine && canSaveNote && (
          <button
            type="button"
            onClick={() => onSaveAsNote(decryptedBody)}
            title="Spara som anteckning"
            className="opacity-60 hover:opacity-100 p-1.5 rounded-lg text-[#525E56] dark:text-[#9BA79F] cursor-pointer"
          >
            <StickyNote className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function HouseholdChat({
  messages,
  householdName,
  encryptionSecret,
  userEmail,
  onSendMessage,
  onSaveAsNote,
  onOpenHouseholdModal,
}: HouseholdChatProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  // Audio recording state
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelRecordRef = useRef(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setMediaError(null);
    setSending(true);
    setText('');
    try {
      await onSendMessage({ text: clean });
    } catch {
      setMediaError('Kunde inte kryptera eller skicka meddelandet.');
    } finally {
      setSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || sending) return;

    setMediaError(null);
    setSending(true);
    const caption = text.trim();
    setText('');

    try {
      const attachmentType: 'image' | 'file' | 'audio' = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'file';

      await onSendMessage({
        text: caption,
        file,
        attachmentType,
        originalName: file.name,
      });
    } catch {
      setMediaError('Kunde inte ladda upp den krypterade filen.');
    } finally {
      setSending(false);
    }
  };

  const startRecording = async () => {
    if (recording || sending) return;
    setMediaError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg',
      ];
      const mimeType =
        preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      cancelRecordRef.current = false;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (cancelRecordRef.current) {
          audioChunksRef.current = [];
          return;
        }

        const actualType = recorder.mimeType || 'audio/webm';
        const ext = actualType.includes('mp4')
          ? 'm4a'
          : actualType.includes('ogg')
            ? 'ogg'
            : 'webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: actualType });
        audioChunksRef.current = [];

        if (audioBlob.size === 0) return;

        setSending(true);
        try {
          await onSendMessage({
            text: '',
            file: audioBlob,
            attachmentType: 'audio',
            originalName: `Rostmeddelande_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.${ext}`,
          });
        } catch {
          setMediaError('Kunde inte skicka röstmeddelandet.');
        } finally {
          setSending(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordSeconds(0);
      setRecording(true);

      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setMediaError('Mikrofonåtkomst nekades eller saknas på enheten.');
    }
  };

  const stopAndSendRecording = () => {
    if (!recording || !mediaRecorderRef.current) return;
    cancelRecordRef.current = false;
    setRecording(false);
    mediaRecorderRef.current.stop();
  };

  const cancelRecording = () => {
    if (!recording || !mediaRecorderRef.current) return;
    cancelRecordRef.current = true;
    setRecording(false);
    mediaRecorderRef.current.stop();
  };

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold">Familjechatt</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Koppla ihop ert hushåll för att skicka krypterade meddelanden, bilder och röstmeddelanden i realtid.
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
    <div className="max-w-3xl w-full mx-auto rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 overflow-hidden flex flex-col h-[68vh] min-h-[420px]">
      {/* Header with green Lock indicator */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center justify-between gap-3 bg-[#F6F7F4]/60 dark:bg-[#141816]/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <MessageCircle className="w-5 h-5 text-[#2E6B4E] dark:text-[#8FD4AE] shrink-0" />
          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold truncate">
              {householdName} · Chatt
            </h2>
            <p className="text-[11px] font-medium text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center gap-1">
              <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
              <span>Krypterad hushållschatt</span>
            </p>
          </div>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-sm text-[#525E56] dark:text-[#9BA79F] px-6">
            <p>Inga meddelanden ännu.</p>
            <p className="text-xs mt-1">
              Skriv ett meddelande, skicka en bild eller spela in ett röstmeddelande!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_email.toLowerCase() === userEmail.toLowerCase();
            return (
              <div key={msg.id} className="contents">
                <EncryptedMessageBubble
                  msg={msg}
                  isMine={isMine}
                  encryptionSecret={encryptionSecret}
                  onSaveAsNote={onSaveAsNote}
                  onPreviewImage={(url, name) => setLightbox({ url, name })}
                />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {mediaError && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{mediaError}</span>
          <button
            type="button"
            onClick={() => setMediaError(null)}
            aria-label="Stäng felmeddelande"
            className="p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Composer / Recording Bar */}
      {recording ? (
        <div className="p-3 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10 bg-red-500/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-red-700 dark:text-red-300">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
            <span className="text-xs sm:text-sm font-semibold">
              Spelar in ljud...{' '}
              <span className="font-mono-tabular">{formatDuration(recordSeconds)}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancelRecording}
              aria-label="Avbryt inspelning"
              className="h-10 px-3 rounded-xl bg-white/80 dark:bg-black/25 text-xs font-semibold cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={stopAndSendRecording}
              className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Stoppa & skicka</span>
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="p-3 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center gap-2 bg-white dark:bg-[#191D1A]"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,*/*"
            onChange={handleFileChange}
            className="sr-only"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label="Bifoga bild eller fil"
            title="Bifoga bild eller fil"
            className="h-11 w-11 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-[#171D19] dark:text-[#E4EBE6] flex items-center justify-center shrink-0 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Paperclip className="w-4 h-4" aria-hidden="true" />
          </button>

          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              sending ? 'Krypterar & skickar...' : 'Skriv ett krypterat meddelande...'
            }
            disabled={sending}
            className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
          />

          <button
            type="button"
            onClick={startRecording}
            disabled={sending}
            aria-label="Spela in röstmeddelande"
            title="Spela in röstmeddelande"
            className="h-11 w-11 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-[#171D19] dark:text-[#E4EBE6] flex items-center justify-center shrink-0 disabled:opacity-50 cursor-pointer transition-colors"
          >
            <Mic className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="submit"
            disabled={!text.trim() || sending}
            aria-label="Skicka meddelande"
            className="h-11 px-4 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] font-semibold text-sm inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </form>
      )}

      {/* Fullscreen Image Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-3xl flex items-center justify-between text-white mb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-medium truncate">{lightbox.name}</span>
            <div className="flex items-center gap-2">
              <a
                href={lightbox.url}
                download={lightbox.name}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>Spara</span>
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Stäng förhandsvisning"
                className="w-9 h-9 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          <img
            src={lightbox.url}
            alt={lightbox.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
}
