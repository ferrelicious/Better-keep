import { BellRing } from 'lucide-react';
import { FILTER_TABS, FilterCategory } from '../types/note';

interface CategoryTabsProps {
  activeCategory: FilterCategory;
  onSelectCategory: (category: FilterCategory) => void;
  counts: Record<FilterCategory, number>;
  onlyReminders: boolean;
  onToggleOnlyReminders: () => void;
  activeRemindersCount: number;
}

export function CategoryTabs({
  activeCategory,
  onSelectCategory,
  counts,
  onlyReminders,
  onToggleOnlyReminders,
  activeRemindersCount,
}: CategoryTabsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      {/* Horizontal Category Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filtrera anteckningar efter kategori"
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5"
      >
        {FILTER_TABS.map((tab) => {
          const isActive = activeCategory === tab;
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => onSelectCategory(tab)}
              className={`inline-flex items-center gap-2 min-h-[44px] sm:min-h-[38px] px-3.5 rounded-xl text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-[#2E6B4E] text-white dark:bg-[#8FD4AE] dark:text-[#063822]'
                  : 'bg-[#ECEFE9] text-[#525E56] hover:text-[#171D19] hover:bg-[#E2E7DF] dark:bg-[#212723] dark:text-[#9BA79F] dark:hover:text-[#E4EBE6] dark:hover:bg-[#2A312D]'
              }`}
            >
              <span>{tab}</span>
              <span
                className={`font-mono-tabular text-xs ${
                  isActive
                    ? 'text-white/85 dark:text-[#063822]/80'
                    : 'text-[#525E56]/80 dark:text-[#9BA79F]/80'
                }`}
              >
                {counts[tab]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Reminder Filter Toggle */}
      <button
        type="button"
        onClick={onToggleOnlyReminders}
        aria-pressed={onlyReminders}
        className={`inline-flex items-center justify-center gap-2 min-h-[44px] sm:min-h-[38px] px-3.5 rounded-xl text-sm font-medium border transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
          onlyReminders
            ? 'bg-[#D3EBD9] border-[#2E6B4E]/30 text-[#0D3824] dark:bg-[#1C4A34] dark:border-[#8FD4AE]/30 dark:text-[#CBEED9]'
            : 'bg-transparent border-[#18221C]/12 text-[#525E56] hover:bg-[#ECEFE9] dark:border-[#E3EAE5]/12 dark:text-[#9BA79F] dark:hover:bg-[#212723]'
        }`}
      >
        <BellRing className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span>Påminnelser</span>
        <span className="font-mono-tabular text-xs opacity-80">{activeRemindersCount}</span>
      </button>
    </div>
  );
}
