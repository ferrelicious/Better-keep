import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, StickyNote, Users } from 'lucide-react';

export interface HouseholdMessage {
  id: string;
  household_id: string;
  sender_email: string;
  body: string;
  created_at: string;
}

interface HouseholdChatProps {
  messages: HouseholdMessage[];
  householdName?: string;
  userEmail: string | null;
  onSendMessage: (body: string) => Promise<void>;
  onSaveAsNote: (body: string) => Promise<void>;
  onOpenHouseholdModal: () => void;
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

export function HouseholdChat({
  messages,
  householdName,
  userEmail,
  onSendMessage,
  onSaveAsNote,
  onOpenHouseholdModal,
}: HouseholdChatProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setText('');
    try {
      await onSendMessage(clean);
    } finally {
      setSending(false);
    }
  };

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" />
        </div>
        <h2 className="font-display text-lg font-bold">Familjechatt</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Koppla ihop ert hushåll för att skicka snabba meddelanden i realtid direkt inuti BetterKeep.
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
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center justify-between bg-[#F6F7F4]/60 dark:bg-[#141816]/60">
        <div className="flex items-center gap-2.5">
          <MessageCircle className="w-5 h-5 text-[#2E6B4E] dark:text-[#8FD4AE]" />
          <div>
            <h2 className="font-display text-sm sm:text-base font-bold">{householdName} · Chatt</h2>
            <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F]">
              Realtidsmeddelanden för hushållet
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-sm text-[#525E56] dark:text-[#9BA79F] px-6">
            <p>Inga meddelanden ännu.</p>
            <p className="text-xs mt-1">Skriv något nedan så plingar det till hos din partner!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.sender_email.toLowerCase() === userEmail.toLowerCase();
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] text-[#525E56] dark:text-[#9BA79F] px-1 mb-0.5">
                  {isMine ? 'Du' : msg.sender_email.split('@')[0]} · {formatMsgTime(msg.created_at)}
                </span>
                <div className="group flex items-center gap-1.5 max-w-[82%]">
                  {isMine && (
                    <button
                      type="button"
                      onClick={() => onSaveAsNote(msg.body)}
                      title="Spara som anteckning"
                      className="opacity-60 hover:opacity-100 p-1.5 rounded-lg text-[#525E56] dark:text-[#9BA79F] cursor-pointer"
                    >
                      <StickyNote className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                      isMine
                        ? 'bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] rounded-br-sm'
                        : 'bg-[#ECEFE9] dark:bg-[#212723] text-[#171D19] dark:text-[#E4EBE6] rounded-bl-sm'
                    }`}
                  >
                    {msg.body}
                  </div>
                  {!isMine && (
                    <button
                      type="button"
                      onClick={() => onSaveAsNote(msg.body)}
                      title="Spara som anteckning"
                      className="opacity-60 hover:opacity-100 p-1.5 rounded-lg text-[#525E56] dark:text-[#9BA79F] cursor-pointer"
                    >
                      <StickyNote className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center gap-2 bg-white dark:bg-[#191D1A]"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Skriv ett meddelande till partnern..."
          className="flex-1 h-11 px-4 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Skicka meddelande"
          className="h-11 px-4 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] font-semibold text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
