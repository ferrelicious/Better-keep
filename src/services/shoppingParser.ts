export interface ShoppingItem {
  id: string;
  household_id: string;
  title: string;
  checked: boolean;
  created_by: string;
  created_at?: string;
}

const SHOPPING_PREFIX_REGEX = /^(handla|inköp|lista)\s*:\s*/i;

export function hasShoppingPrefix(text: string): boolean {
  return SHOPPING_PREFIX_REGEX.test(text.trim());
}

export function extractShoppingItems(rawText: string): string[] {
  const withoutPrefix = rawText.trim().replace(SHOPPING_PREFIX_REGEX, '');
  if (!withoutPrefix) return [];

  const tokens = withoutPrefix.split(/[\r\n,;]+/);
  const seen = new Set<string>();
  const items: string[] = [];

  for (const token of tokens) {
    const cleaned = token
      .trim()
      .replace(/^[-•*☐☑✅✓]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .trim();

    if (!cleaned) continue;
    const normalizedKey = cleaned.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);

    const formatted = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    items.push(formatted);
  }

  return items;
}
