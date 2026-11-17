import { MailPlus, Moon, Plus, Search, Settings, Sun, X } from 'lucide-react';

interface TopBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  effectiveTheme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenNewNote: () => void;
  onOpenEmailImport: () => void;
}

export function TopBar({
  searchQuery,
  onSearchChange,
  effectiveTheme,
  onToggleTheme,
  onOpenSettings,
  onOpenNewNote,
  onOpenEmailImport,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 pt-safe bg-[#F6F7F4]/90 dark:bg-[#111412]/90 backdrop-blur-md border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-6">
        {/* Brand Wordmark */}
        <div className="flex items-center shrink-0">
          <span className="font-display text-lg sm:text-xl font-bold tracking-tight text-[#171D19] dark:text-[#E4EBE6] whitespace-nowrap">
            BetterKeep
          </span>
        </div>

        {/* Desktop Search Field */}
        <div className="hidden md:flex flex-1 max-w-xl relative">
          <Search
            className="w-4 h-4 text-[#525E56] dark:text-[#9BA79F] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Sök i rubriker, anteckningar eller mejl..."
            aria-label="Sök anteckningar"
            className="w-full h-10 pl-10 pr-9 rounded-full bg-[#ECEFE9] dark:bg-[#212723] text-sm text-[#171D19] dark:text-[#E4EBE6] placeholder:text-[#525E56] dark:placeholder:text-[#9BA79F] border border-transparent focus:border-[#2E6B4E] dark:focus:border-[#8FD4AE] focus:bg-white dark:focus:bg-[#191D1A] focus:outline-none transition-colors duration-150"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Rensa sökning"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-[#525E56] dark:text-[#9BA79F] hover:bg-[#18221C]/10 dark:hover:bg-[#E3EAE5]/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenEmailImport}
            className="inline-flex items-center justify-center gap-1.5 sm:gap-2 min-h-[44px] sm:min-h-[40px] px-2.5 sm:px-4 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-[#171D19] dark:text-[#E4EBE6] text-xs sm:text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MailPlus className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
            <span>Importera mejl</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={effectiveTheme === 'dark' ? 'Byt till ljust tema' : 'Byt till mörkt tema'}
            title={effectiveTheme === 'dark' ? 'Ljust tema' : 'Mörkt tema'}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-[#171D19] dark:text-[#E4EBE6] transition-colors duration-150 shrink-0 cursor-pointer"
          >
            {effectiveTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-[#E7C67A]" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-[#2E6B4E]" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Inställningar"
            title="Inställningar"
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] rounded-xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E2E7DF] dark:hover:bg-[#2A312D] text-[#171D19] dark:text-[#E4EBE6] transition-colors duration-150 shrink-0 cursor-pointer"
          >
            <Settings className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenNewNote}
            className="hidden sm:inline-flex items-center justify-center gap-2 min-h-[40px] px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] hover:bg-[#24563E] dark:hover:bg-[#A3DFBD] text-white dark:text-[#063822] text-sm font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Ny anteckning</span>
          </button>
        </div>
      </div>
    </header>
  );
}
