export type NoteCategory = 'Arbete' | 'Privat' | 'Gmail' | 'Outlook';

export type FilterCategory = 'Alla' | NoteCategory;

export type NoteColor =
  | 'default'
  | 'sage'
  | 'sand'
  | 'sky'
  | 'lavender'
  | 'terracotta';

export interface ReminderInfo {
  at: string; // ISO 8601 timestamp
  completed: boolean;
  snoozedCount?: number;
}

export interface EmailSourceMeta {
  provider: 'Gmail' | 'Outlook';
  sender: string;
  subject?: string;
  receivedAt?: string;
}

export type NoteShareFilter = 'all' | 'shared' | 'private';

export interface Note {
  id: string;
  title: string;
  body: string;
  category: NoteCategory;
  color: NoteColor;
  pinned: boolean;
  isPrivate?: boolean;
  reminder: ReminderInfo | null;
  sourceMeta?: EmailSourceMeta;
  createdAt: string;
  updatedAt: string;
}

export type EmailProvider = 'Gmail' | 'Outlook';

export interface EmailProviderConfig {
  provider: EmailProvider;
  clientId: string;
  tenantId?: string;
  redirectUri: string;
  scopes: string[];
  prepared: boolean;
  updatedAt: string;
}

export interface NoteColorOption {
  id: NoteColor;
  label: string;
  cardClass: string;
  swatchClass: string;
}

export const NOTE_CATEGORIES: NoteCategory[] = [
  'Arbete',
  'Privat',
  'Gmail',
  'Outlook',
];

export const FILTER_TABS: FilterCategory[] = [
  'Alla',
  'Arbete',
  'Privat',
  'Gmail',
  'Outlook',
];

export const NOTE_COLORS: NoteColorOption[] = [
  {
    id: 'default',
    label: 'Standard',
    cardClass:
      'bg-white dark:bg-[#191D1A] border-[#18221C]/10 dark:border-[#E3EAE5]/10 text-[#171D19] dark:text-[#E4EBE6]',
    swatchClass: 'bg-[#FFFFFF] dark:bg-[#191D1A] border-[#18221C]/25 dark:border-[#E3EAE5]/30',
  },
  {
    id: 'sage',
    label: 'Salvia',
    cardClass:
      'bg-[#EAF2EC] dark:bg-[#1C2A22] border-[#2E6B4E]/15 dark:border-[#8FD4AE]/15 text-[#13261C] dark:text-[#E1EFE6]',
    swatchClass: 'bg-[#D3EBD9] dark:bg-[#244131] border-[#2E6B4E]/35 dark:border-[#8FD4AE]/40',
  },
  {
    id: 'sand',
    label: 'Sand',
    cardClass:
      'bg-[#F7F1E3] dark:bg-[#2A2418] border-[#8C6A23]/15 dark:border-[#E7C67A]/15 text-[#29200E] dark:text-[#F4EAD2]',
    swatchClass: 'bg-[#EFE1C0] dark:bg-[#493C21] border-[#8C6A23]/35 dark:border-[#E7C67A]/40',
  },
  {
    id: 'sky',
    label: 'Himmel',
    cardClass:
      'bg-[#E9F1F8] dark:bg-[#192530] border-[#2B638C]/15 dark:border-[#8BC2EC]/15 text-[#122230] dark:text-[#DFECF7]',
    swatchClass: 'bg-[#CFE3F4] dark:bg-[#223B50] border-[#2B638C]/35 dark:border-[#8BC2EC]/40',
  },
  {
    id: 'lavender',
    label: 'Lavendel',
    cardClass:
      'bg-[#F1ECF8] dark:bg-[#241E2F] border-[#5E458F]/15 dark:border-[#C2ACEE]/15 text-[#221933] dark:text-[#ECE5F8]',
    swatchClass: 'bg-[#DFD4F2] dark:bg-[#382C4E] border-[#5E458F]/35 dark:border-[#C2ACEE]/40',
  },
  {
    id: 'terracotta',
    label: 'Terrakotta',
    cardClass:
      'bg-[#F9ECEA] dark:bg-[#2D1D1B] border-[#964236]/15 dark:border-[#ECA69B]/15 text-[#301613] dark:text-[#F6E4E1]',
    swatchClass: 'bg-[#F0D1CC] dark:bg-[#4C2B27] border-[#964236]/35 dark:border-[#ECA69B]/40',
  },
];

export function getColorConfig(color: NoteColor): NoteColorOption {
  return NOTE_COLORS.find((c) => c.id === color) ?? NOTE_COLORS[0];
}
