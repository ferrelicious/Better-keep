import type React from 'react';
import { useMemo, useState } from 'react';
import {
  Check,
  Loader2,
  Plus,
  ShoppingCart,
  Trash2,
  Users,
} from 'lucide-react';
import { ShoppingItem } from '../services/shoppingParser';

interface ShoppingListProps {
  items: ShoppingItem[];
  householdName?: string;
  userEmail: string | null;
  onAddItems: (rawText: string) => Promise<number>;
  onToggleItem: (item: ShoppingItem) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onClearChecked: () => Promise<void>;
  onOpenHouseholdModal: () => void;
}

export function ShoppingList({
  items,
  householdName,
  userEmail,
  onAddItems,
  onToggleItem,
  onDeleteItem,
  onClearChecked,
  onOpenHouseholdModal,
}: ShoppingListProps) {
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);

  const uncheckedItems = useMemo(
    () => items.filter((item) => !item.checked),
    [items]
  );
  const checkedItems = useMemo(
    () => items.filter((item) => item.checked),
    [items]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = input.trim();
    if (!clean || adding) return;
    setAdding(true);
    try {
      await onAddItems(clean);
      setInput('');
    } finally {
      setAdding(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted && /[\r\n]/.test(pasted)) {
      e.preventDefault();
      const normalized = pasted
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(', ');
      setInput((prev) => (prev.trim() ? `${prev.trim()}, ${normalized}` : normalized));
    }
  };

  const handleClear = async () => {
    if (checkedItems.length === 0 || clearing) return;
    setClearing(true);
    try {
      await onClearChecked();
    } finally {
      setClearing(false);
    }
  };

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" aria-hidden="true" />
        </div>
        <h2 className="font-display text-lg font-bold">Delad Inköpslista</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Koppla ihop ert hushåll för att dela inköpslistan i realtid, bocka av varor i butiken och få pling när allt är handlat.
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
      {/* Header & Quick Add */}
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <ShoppingCart className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-bold">
                {householdName} · Inköp
              </h2>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F] font-mono-tabular">
                {uncheckedItems.length} kvar att handla · {checkedItems.length} avbockade
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="Lägg till vara (t.ex. Mjölk, ägg, kaffe)..."
            aria-label="Lägg till varor i inköpslistan"
            disabled={adding}
            className="flex-1 min-w-0 h-11 px-4 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] placeholder:text-[#525E56] dark:placeholder:text-[#9BA79F] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E] dark:focus:ring-[#8FD4AE]"
          />
          <button
            type="submit"
            disabled={!input.trim() || adding}
            className="h-11 px-4 rounded-2xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            {adding ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="w-4 h-4" aria-hidden="true" />
            )}
            <span>Lägg till</span>
          </button>
        </form>

        <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F]">
          Tips: Separera flera varor med kommatecken, klistra in en lista eller skriv <span className="font-mono-tabular font-semibold">Handla: mjölk, ägg</span> i chatten.
        </p>
      </div>

      {/* Items List */}
      {items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#18221C]/15 dark:border-[#E3EAE5]/15 py-12 px-6 text-center flex flex-col items-center gap-2">
          <ShoppingCart className="w-8 h-8 text-[#525E56] dark:text-[#9BA79F] opacity-60" aria-hidden="true" />
          <h3 className="font-display text-base font-semibold">Inköpslistan är tom</h3>
          <p className="text-xs sm:text-sm text-[#525E56] dark:text-[#9BA79F] max-w-md">
            Lägg till varor ovan eller skicka ett chattmeddelande som börjar med <span className="font-mono-tabular">Handla:</span> så skapas bockrutor automatiskt.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Unchecked Items */}
          <section className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 overflow-hidden">
            <div className="px-4 sm:px-5 py-3 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                Att handla ({uncheckedItems.length})
              </h3>
            </div>

            {uncheckedItems.length === 0 ? (
              <div className="px-5 py-6 text-center text-sm text-[#2E6B4E] dark:text-[#8FD4AE] font-medium">
                Alla varor på listan är avbockade!
              </div>
            ) : (
              <ul className="divide-y divide-[#18221C]/8 dark:divide-[#E3EAE5]/8">
                {uncheckedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 hover:bg-[#F6F7F4]/70 dark:hover:bg-[#212723]/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleItem(item)}
                      className="flex-1 min-w-0 min-h-[44px] flex items-center gap-3 text-left cursor-pointer"
                    >
                      <span
                        className="w-6 h-6 rounded-lg border-2 border-[#2E6B4E] dark:border-[#8FD4AE] flex items-center justify-center shrink-0 transition-colors"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-medium text-[#171D19] dark:text-[#E4EBE6] break-words">
                          {item.title}
                        </p>
                        {item.created_by && (
                          <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                            Tillagd av {item.created_by.split('@')[0]}
                          </p>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      aria-label={`Ta bort ${item.title}`}
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Checked Items */}
          {checkedItems.length > 0 && (
            <section className="rounded-3xl bg-[#F6F7F4]/80 dark:bg-[#141816] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold text-[#525E56] dark:text-[#9BA79F]">
                  Avbockat ({checkedItems.length})
                </h3>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={clearing}
                  className="inline-flex items-center gap-1.5 min-h-[34px] px-3 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                >
                  {clearing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  <span>Rensa avbockade</span>
                </button>
              </div>

              <ul className="divide-y divide-[#18221C]/8 dark:divide-[#E3EAE5]/8">
                {checkedItems.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 opacity-75"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleItem(item)}
                      className="flex-1 min-w-0 min-h-[44px] flex items-center gap-3 text-left cursor-pointer"
                    >
                      <span
                        className="w-6 h-6 rounded-lg bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] flex items-center justify-center shrink-0"
                        aria-hidden="true"
                      >
                        <Check className="w-4 h-4 stroke-[2.5]" />
                      </span>
                      <span className="text-sm line-through text-[#525E56] dark:text-[#9BA79F] break-words">
                        {item.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      aria-label={`Ta bort ${item.title}`}
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 shrink-0 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
