import type React from 'react';
import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Lock,
  MapPin,
  Plus,
  ShoppingCart,
  Star,
  Store,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  DEFAULT_STAPLES,
  DEFAULT_STORES,
  SHOPPING_DEPARTMENTS,
  ShoppingDepartment,
  ShoppingItem,
  ShoppingPreset,
  buildGoogleMapsUrl,
} from '../services/shoppingParser';

const ALL_STORES_VALUE = '__ALL__';

interface StoreOption {
  name: string;
  address: string;
  presetId?: string;
}

interface ShoppingListProps {
  items: ShoppingItem[];
  presets: ShoppingPreset[];
  householdName?: string;
  userEmail: string | null;
  onAddItems: (
    rawText: string,
    storeName?: string,
    departmentOverride?: ShoppingDepartment
  ) => Promise<number>;
  onToggleItem: (item: ShoppingItem) => Promise<void>;
  onUpdateDepartment: (item: ShoppingItem, department: ShoppingDepartment) => Promise<void>;
  onDeleteItem: (id: string) => Promise<void>;
  onClearChecked: (storeNameFilter?: string) => Promise<void>;
  onSavePreset: (draft: {
    presetType: 'store' | 'staple';
    label: string;
    storeName?: string;
    storeAddress?: string;
    department?: ShoppingDepartment;
  }) => Promise<void>;
  onDeletePreset: (id: string) => Promise<void>;
  onOpenHouseholdModal: () => void;
}

export function ShoppingList({
  items,
  presets,
  householdName,
  userEmail,
  onAddItems,
  onToggleItem,
  onUpdateDepartment,
  onDeleteItem,
  onClearChecked,
  onSavePreset,
  onDeletePreset,
  onOpenHouseholdModal,
}: ShoppingListProps) {
  const [selectedStore, setSelectedStore] = useState<string>(ALL_STORES_VALUE);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Add custom store inline form
  const [showStoreForm, setShowStoreForm] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [savingStore, setSavingStore] = useState(false);

  // Collapsible staples quick-pick
  const [staplesExpanded, setStaplesExpanded] = useState(true);
  const [busyStapleKey, setBusyStapleKey] = useState<string | null>(null);

  const storePresets = useMemo(
    () => presets.filter((p) => p.preset_type === 'store'),
    [presets]
  );

  const customStaples = useMemo(
    () => presets.filter((p) => p.preset_type === 'staple'),
    [presets]
  );

  // Merge default stores, saved store presets (which carry address), and any store names seen on items
  const storeOptions = useMemo<StoreOption[]>(() => {
    const map = new Map<string, StoreOption>();

    for (const defaultName of DEFAULT_STORES) {
      map.set(defaultName.toLowerCase(), { name: defaultName, address: '' });
    }

    for (const preset of storePresets) {
      const cleanName = (preset.store_name || preset.label).trim();
      if (!cleanName) continue;
      map.set(cleanName.toLowerCase(), {
        name: cleanName,
        address: preset.store_address.trim(),
        presetId: preset.id,
      });
    }

    for (const item of items) {
      const cleanName = item.store_name.trim();
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name: cleanName,
          address: item.store_address.trim(),
        });
      }
    }

    return Array.from(map.values());
  }, [storePresets, items]);

  const activeStoreOption = useMemo<StoreOption | null>(() => {
    if (selectedStore === ALL_STORES_VALUE) return null;
    return (
      storeOptions.find((s) => s.name.toLowerCase() === selectedStore.toLowerCase()) ?? {
        name: selectedStore,
        address: '',
      }
    );
  }, [selectedStore, storeOptions]);

  const activeStoreNameForNewItems =
    selectedStore === ALL_STORES_VALUE ? '' : activeStoreOption?.name ?? selectedStore;

  const filteredItems = useMemo(() => {
    if (selectedStore === ALL_STORES_VALUE) return items;
    const target = selectedStore.trim().toLowerCase();
    return items.filter((item) => item.store_name.trim().toLowerCase() === target);
  }, [items, selectedStore]);

  const uncheckedItems = useMemo(
    () => filteredItems.filter((item) => !item.checked),
    [filteredItems]
  );

  const checkedItems = useMemo(
    () => filteredItems.filter((item) => item.checked),
    [filteredItems]
  );

  // Group unchecked items by Store (when ALL is selected) then by Department
  const groupedUnchecked = useMemo(() => {
    const storeGroups = new Map<
      string,
      {
        storeName: string;
        storeAddress: string;
        departments: Map<ShoppingDepartment, ShoppingItem[]>;
      }
    >();

    for (const item of uncheckedItems) {
      const rawStore = item.store_name.trim();
      const storeKey = rawStore ? rawStore.toLowerCase() : '__none__';
      const displayStore = rawStore || 'Övriga varor (ej vald butik)';
      const presetStore = rawStore
        ? storeOptions.find((s) => s.name.toLowerCase() === rawStore.toLowerCase())
        : undefined;
      const address = presetStore?.address || item.store_address.trim();

      if (!storeGroups.has(storeKey)) {
        storeGroups.set(storeKey, {
          storeName: rawStore ? displayStore : '',
          storeAddress: address,
          departments: new Map<ShoppingDepartment, ShoppingItem[]>(),
        });
      }

      const group = storeGroups.get(storeKey)!;
      const dept = item.department;
      if (!group.departments.has(dept)) {
        group.departments.set(dept, []);
      }
      group.departments.get(dept)!.push(item);
    }

    const sortedStores = Array.from(storeGroups.entries()).sort(([keyA], [keyB]) => {
      if (keyA === '__none__') return 1;
      if (keyB === '__none__') return -1;
      return keyA.localeCompare(keyB, 'sv');
    });

    return sortedStores.map(([key, group]) => {
      const orderedDepts = SHOPPING_DEPARTMENTS.filter((d) =>
        group.departments.has(d)
      ).map((d) => ({
        department: d,
        items: group.departments.get(d)!,
      }));

      const totalCount = orderedDepts.reduce((sum, d) => sum + d.items.length, 0);
      return {
        key,
        storeName: group.storeName,
        storeAddress: group.storeAddress,
        totalCount,
        departments: orderedDepts,
      };
    });
  }, [uncheckedItems, storeOptions]);

  const combinedStaples = useMemo(() => {
    const map = new Map<
      string,
      {
        label: string;
        department: ShoppingDepartment;
        customPresetId?: string;
      }
    >();

    for (const def of DEFAULT_STAPLES) {
      map.set(def.label.toLowerCase(), {
        label: def.label,
        department: def.department,
      });
    }

    for (const custom of customStaples) {
      const label = custom.label.trim();
      if (!label) continue;
      map.set(label.toLowerCase(), {
        label,
        department: custom.department,
        customPresetId: custom.id,
      });
    }

    return Array.from(map.values());
  }, [customStaples]);

  const stapleKeysSet = useMemo(() => {
    return new Set(combinedStaples.map((s) => s.label.toLowerCase()));
  }, [combinedStaples]);

  const customStapleByLabel = useMemo(() => {
    const map = new Map<string, ShoppingPreset>();
    for (const p of customStaples) {
      map.set(p.label.trim().toLowerCase(), p);
    }
    return map;
  }, [customStaples]);

  const uncheckedLabelsInActiveStore = useMemo(() => {
    const targetStore = activeStoreNameForNewItems.trim().toLowerCase();
    return new Set(
      items
        .filter(
          (i) =>
            !i.checked &&
            (!targetStore || i.store_name.trim().toLowerCase() === targetStore)
        )
        .map((i) => i.label.trim().toLowerCase())
    );
  }, [items, activeStoreNameForNewItems]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = input.trim();
    if (!clean || adding) return;
    setAdding(true);
    try {
      await onAddItems(clean, activeStoreNameForNewItems);
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

  const handleSaveNewStore = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newStoreName.trim();
    if (!cleanName || savingStore) return;
    setSavingStore(true);
    try {
      await onSavePreset({
        presetType: 'store',
        label: cleanName,
        storeName: cleanName,
        storeAddress: newStoreAddress.trim(),
      });
      setSelectedStore(cleanName);
      setNewStoreName('');
      setNewStoreAddress('');
      setShowStoreForm(false);
    } finally {
      setSavingStore(false);
    }
  };

  const handleQuickAddStaple = async (
    label: string,
    department: ShoppingDepartment
  ) => {
    const key = label.toLowerCase();
    if (busyStapleKey === key) return;
    setBusyStapleKey(key);
    try {
      await onAddItems(label, activeStoreNameForNewItems, department);
    } finally {
      setBusyStapleKey(null);
    }
  };

  const handleToggleStarItem = async (item: ShoppingItem) => {
    const key = item.label.trim().toLowerCase();
    const existingCustom = customStapleByLabel.get(key);
    if (existingCustom) {
      await onDeletePreset(existingCustom.id);
      return;
    }
    if (DEFAULT_STAPLES.some((d) => d.label.toLowerCase() === key)) {
      return;
    }
    await onSavePreset({
      presetType: 'staple',
      label: item.label,
      department: item.department,
    });
  };

  const handleClear = async () => {
    if (checkedItems.length === 0 || clearing) return;
    setClearing(true);
    try {
      await onClearChecked(
        selectedStore === ALL_STORES_VALUE ? undefined : activeStoreNameForNewItems
      );
    } finally {
      setClearing(false);
    }
  };

  const mapUrl = activeStoreOption
    ? buildGoogleMapsUrl(activeStoreOption.name, activeStoreOption.address)
    : buildGoogleMapsUrl('Matbutik');

  if (!userEmail || !householdName) {
    return (
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 text-center flex flex-col items-center gap-3 max-w-md mx-auto">
        <div className="w-12 h-12 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
          <Users className="w-6 h-6" aria-hidden="true" />
        </div>
        <h2 className="font-display text-lg font-bold">Delad Inköpslista</h2>
        <p className="text-sm text-[#525E56] dark:text-[#9BA79F]">
          Koppla ihop ert hushåll för att dela E2E-krypterad inköpslista i realtid, gruppera efter butik och avdelning samt få pling när allt är handlat.
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
      {/* Header, Store Selector & Quick Add */}
      <div className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center shrink-0">
              <ShoppingCart className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base sm:text-lg font-bold truncate">
                {householdName} · Inköp
              </h2>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F] flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 text-[#2E6B4E] dark:text-[#8FD4AE] font-medium">
                  <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span>E2E-krypterad</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {uncheckedItems.length} kvar · {checkedItems.length} avbockade
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Store Picker & Google Maps */}
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[190px]">
              <Store
                className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                aria-label="Välj eller filtrera butik"
                className="w-full h-11 pl-10 pr-8 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] text-sm font-medium text-[#171D19] dark:text-[#E4EBE6] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E] dark:focus:ring-[#8FD4AE] cursor-pointer"
              >
                <option value={ALL_STORES_VALUE}>Alla butiker</option>
                {storeOptions.map((store) => (
                  <option key={store.name} value={store.name}>
                    {store.address ? `${store.name} (${store.address})` : store.name}
                  </option>
                ))}
              </select>
            </div>

            <a
              href={mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={
                activeStoreOption
                  ? `Öppna ${activeStoreOption.name} i Google Maps`
                  : 'Sök matbutiker i Google Maps'
              }
              className="h-11 px-3.5 rounded-2xl bg-[#D3EBD9] dark:bg-[#1C4A34] hover:bg-[#C2E2CA] dark:hover:bg-[#235B40] text-[#0D3824] dark:text-[#CBEED9] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors"
            >
              <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Öppna karta</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-75 shrink-0" aria-hidden="true" />
            </a>

            <button
              type="button"
              onClick={() => {
                if (!showStoreForm && activeStoreOption) {
                  setNewStoreName(activeStoreOption.name);
                  setNewStoreAddress(activeStoreOption.address);
                } else if (!showStoreForm) {
                  setNewStoreName('');
                  setNewStoreAddress('');
                }
                setShowStoreForm((v) => !v);
              }}
              className="h-11 px-3.5 rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] hover:bg-[#E1E6DE] dark:hover:bg-[#2B322E] text-[#171D19] dark:text-[#E4EBE6] text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer whitespace-nowrap transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>+ Lägg till egen butik & plats</span>
            </button>
          </div>

          {activeStoreOption && (
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-[#525E56] dark:text-[#9BA79F]">
              <span className="truncate">
                {activeStoreOption.address
                  ? `Plats: ${activeStoreOption.address}`
                  : `Vald butik: ${activeStoreOption.name} (ingen adress sparad ännu)`}
              </span>
              {activeStoreOption.presetId && (
                <button
                  type="button"
                  onClick={() => {
                    onDeletePreset(activeStoreOption.presetId!);
                    setSelectedStore(ALL_STORES_VALUE);
                  }}
                  className="text-red-700 dark:text-red-300 hover:underline shrink-0 cursor-pointer"
                >
                  Ta bort sparad butik
                </button>
              )}
            </div>
          )}

          {showStoreForm && (
            <form
              onSubmit={handleSaveNewStore}
              className="rounded-2xl bg-[#F6F7F4] dark:bg-[#141816] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 p-3.5 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#171D19] dark:text-[#E4EBE6]">
                  Spara butik & plats (E2E-krypterat)
                </p>
                <button
                  type="button"
                  onClick={() => setShowStoreForm(false)}
                  aria-label="Stäng butiksformulär"
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="Butiksnamn (t.ex. ICA Maxi Stenhagen)"
                  aria-label="Butiksnamn"
                  required
                  className="h-10 px-3.5 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
                <input
                  type="text"
                  value={newStoreAddress}
                  onChange={(e) => setNewStoreAddress(e.target.value)}
                  placeholder="Adress / plats (t.ex. Stenhagen, Uppsala)"
                  aria-label="Butikens adress eller plats"
                  className="h-10 px-3.5 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowStoreForm(false)}
                  className="h-9 px-3.5 rounded-xl text-xs font-medium text-[#525E56] dark:text-[#9BA79F] hover:bg-black/5 cursor-pointer"
                >
                  Avbryt
                </button>
                <button
                  type="submit"
                  disabled={!newStoreName.trim() || savingStore}
                  className="h-9 px-4 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {savingStore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Spara butik</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Quick Add Form */}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder={
              activeStoreNameForNewItems
                ? `Lägg till vara i ${activeStoreNameForNewItems} (t.ex. Mjölk, ägg)...`
                : 'Lägg till vara (t.ex. Mjölk, ägg, kaffe)...'
            }
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
          Varor sorteras automatiskt i avdelningar. Tips: Skriv{' '}
          <span className="font-mono-tabular font-semibold">
            Handla på Willys: mjölk, ägg, kaffe
          </span>{' '}
          i chatten för att lägga till direkt under rätt butik.
        </p>
      </div>

      {/* Collapsible Staples (Basvaror Snabbval) */}
      <section className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 overflow-hidden">
        <button
          type="button"
          onClick={() => setStaplesExpanded((v) => !v)}
          aria-expanded={staplesExpanded}
          className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-[#F6F7F4]/70 dark:hover:bg-[#212723]/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Star
              className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE] fill-current shrink-0"
              aria-hidden="true"
            />
            <span className="text-xs sm:text-sm font-semibold text-[#171D19] dark:text-[#E4EBE6]">
              Basvaror (Snabbval)
            </span>
            <span className="text-xs text-[#525E56] dark:text-[#9BA79F] font-mono-tabular">
              ({combinedStaples.length})
            </span>
            {activeStoreNameForNewItems && (
              <span className="text-[11px] text-[#2E6B4E] dark:text-[#8FD4AE] truncate hidden sm:inline">
                · läggs till i {activeStoreNameForNewItems}
              </span>
            )}
          </div>
          {staplesExpanded ? (
            <ChevronUp className="w-4 h-4 text-[#525E56] dark:text-[#9BA79F] shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#525E56] dark:text-[#9BA79F] shrink-0" />
          )}
        </button>

        {staplesExpanded && (
          <div className="px-4 sm:px-5 pb-4 pt-1 flex flex-wrap gap-2 border-t border-[#18221C]/8 dark:border-[#E3EAE5]/8">
            {combinedStaples.map((staple) => {
              const alreadyOnList = uncheckedLabelsInActiveStore.has(
                staple.label.toLowerCase()
              );
              const isBusy = busyStapleKey === staple.label.toLowerCase();
              return (
                <div
                  key={staple.label}
                  className={`inline-flex items-center rounded-xl border text-xs font-medium transition-colors ${
                    alreadyOnList
                      ? 'bg-[#D3EBD9]/70 dark:bg-[#1C4A34]/70 border-[#2E6B4E]/30 dark:border-[#8FD4AE]/30 text-[#0D3824] dark:text-[#CBEED9]'
                      : 'bg-[#F6F7F4] dark:bg-[#212723] border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#171D19] dark:text-[#E4EBE6]'
                  }`}
                >
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleQuickAddStaple(staple.label, staple.department)}
                    className="min-h-[36px] px-3 inline-flex items-center gap-1.5 hover:opacity-80 cursor-pointer disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : alreadyOnList ? (
                      <Check className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-[#2E6B4E] dark:text-[#8FD4AE]" aria-hidden="true" />
                    )}
                    <span>{staple.label}</span>
                  </button>
                  {staple.customPresetId && (
                    <button
                      type="button"
                      onClick={() => onDeletePreset(staple.customPresetId!)}
                      aria-label={`Ta bort basvaran ${staple.label}`}
                      title="Ta bort sparad basvara"
                      className="h-9 w-7 flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 border-l border-[#18221C]/10 dark:border-[#E3EAE5]/10 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#18221C]/15 dark:border-[#E3EAE5]/15 py-12 px-6 text-center flex flex-col items-center gap-2">
          <ShoppingCart
            className="w-8 h-8 text-[#525E56] dark:text-[#9BA79F] opacity-60"
            aria-hidden="true"
          />
          <h3 className="font-display text-base font-semibold">
            {selectedStore === ALL_STORES_VALUE
              ? 'Inköpslistan är tom'
              : `Inga varor under ${activeStoreOption?.name ?? selectedStore}`}
          </h3>
          <p className="text-xs sm:text-sm text-[#525E56] dark:text-[#9BA79F] max-w-md">
            Lägg till varor ovan, använd Basvaror (Snabbval) eller skriv{' '}
            <span className="font-mono-tabular">Handla på Willys: mjölk, ägg</span> i chatten.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Unchecked Items grouped by Store and Department */}
          {uncheckedItems.length === 0 ? (
            <section className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 px-5 py-6 text-center text-sm text-[#2E6B4E] dark:text-[#8FD4AE] font-medium">
              Alla varor {selectedStore === ALL_STORES_VALUE ? 'på listan' : `för ${activeStoreOption?.name ?? selectedStore}`} är avbockade!
            </section>
          ) : (
            groupedUnchecked.map((storeGroup) => (
              <section
                key={storeGroup.key}
                className="rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 overflow-hidden"
              >
                {/* Store Header */}
                <div className="px-4 sm:px-5 py-3 border-b border-[#18221C]/10 dark:border-[#E3EAE5]/10 bg-[#F6F7F4]/70 dark:bg-[#141816]/70 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <Store
                      className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE] shrink-0"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-[#171D19] dark:text-[#E4EBE6] truncate">
                        {storeGroup.storeName || 'Övriga varor'}
                        <span className="ml-2 text-xs font-normal font-mono-tabular text-[#525E56] dark:text-[#9BA79F]">
                          ({storeGroup.totalCount})
                        </span>
                      </h3>
                      {storeGroup.storeAddress && (
                        <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                          {storeGroup.storeAddress}
                        </p>
                      )}
                    </div>
                  </div>

                  {storeGroup.storeName && (
                    <a
                      href={buildGoogleMapsUrl(
                        storeGroup.storeName,
                        storeGroup.storeAddress
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#191D1A] border border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[11px] font-semibold text-[#2E6B4E] dark:text-[#8FD4AE] hover:opacity-85 whitespace-nowrap"
                    >
                      <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Karta</span>
                    </a>
                  )}
                </div>

                {/* Departments inside this Store */}
                <div className="divide-y divide-[#18221C]/10 dark:divide-[#E3EAE5]/10">
                  {storeGroup.departments.map((deptGroup) => (
                    <div key={deptGroup.department}>
                      <div className="px-4 sm:px-5 py-2 bg-[#ECEFE9]/45 dark:bg-[#212723]/45 flex items-center justify-between">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[#2E6B4E] dark:text-[#8FD4AE]">
                          {deptGroup.department}
                        </h4>
                        <span className="text-[11px] font-mono-tabular text-[#525E56] dark:text-[#9BA79F]">
                          {deptGroup.items.length}
                        </span>
                      </div>

                      <ul className="divide-y divide-[#18221C]/8 dark:divide-[#E3EAE5]/8">
                        {deptGroup.items.map((item) => {
                          const labelKey = item.label.trim().toLowerCase();
                          const isCustomStaple = customStapleByLabel.has(labelKey);
                          const isDefaultStaple = DEFAULT_STAPLES.some(
                            (d) => d.label.toLowerCase() === labelKey
                          );
                          const isStarred = stapleKeysSet.has(labelKey);

                          return (
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
                                    {item.label}
                                  </p>
                                  {item.created_by && (
                                    <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                                      Tillagd av {item.created_by.split('@')[0]}
                                    </p>
                                  )}
                                </div>
                              </button>

                              <div className="flex items-center gap-1 shrink-0">
                                <select
                                  value={item.department}
                                  onChange={(e) =>
                                    onUpdateDepartment(
                                      item,
                                      e.target.value as ShoppingDepartment
                                    )
                                  }
                                  aria-label={`Byt avdelning för ${item.label}`}
                                  className="h-8 max-w-[116px] sm:max-w-[140px] px-2 rounded-lg bg-[#ECEFE9] dark:bg-[#212723] text-[11px] font-medium text-[#525E56] dark:text-[#9BA79F] focus:outline-none focus:ring-2 focus:ring-[#2E6B4E] cursor-pointer truncate"
                                >
                                  {SHOPPING_DEPARTMENTS.map((dept) => (
                                    <option key={dept} value={dept}>
                                      {dept}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  onClick={() => handleToggleStarItem(item)}
                                  disabled={isDefaultStaple && !isCustomStaple}
                                  title={
                                    isDefaultStaple
                                      ? 'Standard-basvara i Snabbval'
                                      : isCustomStaple
                                        ? 'Ta bort från Basvaror'
                                        : 'Spara som basvara (Snabbval)'
                                  }
                                  aria-label={
                                    isCustomStaple
                                      ? `Ta bort ${item.label} från basvaror`
                                      : `Spara ${item.label} som basvara`
                                  }
                                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                                    isStarred
                                      ? 'text-amber-500 dark:text-amber-400'
                                      : 'text-[#525E56] dark:text-[#9BA79F] hover:text-amber-500 dark:hover:text-amber-400'
                                  } ${
                                    isDefaultStaple && !isCustomStaple
                                      ? 'opacity-70 cursor-default'
                                      : 'hover:bg-amber-500/10 cursor-pointer'
                                  }`}
                                >
                                  <Star
                                    className={`w-4 h-4 ${isStarred ? 'fill-current' : ''}`}
                                    aria-hidden="true"
                                  />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => onDeleteItem(item.id)}
                                  aria-label={`Ta bort ${item.label}`}
                                  className="w-9 h-9 rounded-xl flex items-center justify-center text-[#525E56] dark:text-[#9BA79F] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 shrink-0 cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

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
                      <div className="min-w-0">
                        <span className="text-sm line-through text-[#525E56] dark:text-[#9BA79F] break-words">
                          {item.label}
                        </span>
                        {(item.store_name || item.department) && (
                          <p className="text-[11px] text-[#525E56] dark:text-[#9BA79F] truncate">
                            {[item.store_name, item.department].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteItem(item.id)}
                      aria-label={`Ta bort ${item.label}`}
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
