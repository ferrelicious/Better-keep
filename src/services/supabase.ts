import { createClient } from '@supabase/supabase-js';
import { Note } from '../types/note';

const SUPABASE_URL = 'https://cpzjxjctjmxxpjjvdvjm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-wXq5Dn5SRGegTHXEinHVA_340FkdZC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface HouseholdMember {
  id: string;
  member_email: string;
  status: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export interface HouseholdInfo {
  id: string;
  name: string;
  owner_email: string;
  encryption_secret?: string | null;
  members: HouseholdMember[];
}

export interface CloudNoteRecord {
  id: string;
  owner_email: string;
  household_id: string | null;
  data: Note;
  updated_at: string;
}

const MEMBER_PROFILE_CACHE_KEY = 'betterkeep_member_profiles_v1';

function readCachedMemberProfiles(): Record<
  string,
  { display_name?: string | null; avatar_url?: string | null }
> {
  try {
    const raw = localStorage.getItem(MEMBER_PROFILE_CACHE_KEY);
    return raw
      ? (JSON.parse(raw) as Record<
          string,
          { display_name?: string | null; avatar_url?: string | null }
        >)
      : {};
  } catch {
    return {};
  }
}

function writeCachedMemberProfile(
  memberEmail: string,
  updates: { display_name?: string | null; avatar_url?: string | null }
): void {
  try {
    const map = readCachedMemberProfiles();
    const key = memberEmail.trim().toLowerCase();
    map[key] = { ...(map[key] || {}), ...updates };
    localStorage.setItem(MEMBER_PROFILE_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

function mergeMemberProfiles(members: HouseholdMember[]): HouseholdMember[] {
  const cache = readCachedMemberProfiles();
  return members.map((m) => {
    const cached = cache[m.member_email.trim().toLowerCase()];
    return {
      ...m,
      display_name: m.display_name ?? cached?.display_name ?? null,
      avatar_url: m.avatar_url ?? cached?.avatar_url ?? null,
    };
  });
}

function generateRandomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function getUserHousehold(email: string): Promise<HouseholdInfo | null> {
  const cleanEmail = email.trim().toLowerCase();

  const { data: owned } = await supabase
    .from('households')
    .select('*')
    .eq('owner_email', cleanEmail)
    .limit(1)
    .maybeSingle();

  let household = owned;

  if (!household) {
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('member_email', cleanEmail)
      .limit(1)
      .maybeSingle();

    if (membership?.household_id) {
      const { data: joined } = await supabase
        .from('households')
        .select('*')
        .eq('id', membership.household_id)
        .maybeSingle();
      household = joined;
    }
  }

  if (!household) return null;

  const { data: members, error: membersErr } = await supabase
    .from('household_members')
    .select('id, member_email, status, display_name, avatar_url')
    .eq('household_id', household.id);

  let rawMembers: HouseholdMember[] = (members ?? []) as HouseholdMember[];

  if (
    membersErr &&
    (/display_name/i.test(membersErr.message) || /avatar_url/i.test(membersErr.message))
  ) {
    const fallbackRes = await supabase
      .from('household_members')
      .select('id, member_email, status')
      .eq('household_id', household.id);
    rawMembers = (fallbackRes.data ?? []) as HouseholdMember[];
  }

  const normalizedMembers = mergeMemberProfiles(rawMembers);

  return {
    id: household.id,
    name: household.name,
    owner_email: household.owner_email,
    encryption_secret: household.encryption_secret ?? null,
    members: normalizedMembers,
  };
}

export async function createHousehold(name: string, ownerEmail: string): Promise<HouseholdInfo> {
  const cleanEmail = ownerEmail.trim().toLowerCase();
  const generatedSecret = generateRandomSecret();
  const { data, error } = await supabase
    .from('households')
    .insert({
      name: name.trim() || 'Vårt hushåll',
      owner_email: cleanEmail,
      encryption_secret: generatedSecret,
    })
    .select()
    .single();

  if (error) throw error;

  const { data: insertedMember } = await supabase
    .from('household_members')
    .insert({
      household_id: data.id,
      member_email: cleanEmail,
      status: 'active',
    })
    .select('id, member_email, status')
    .maybeSingle();

  return {
    id: data.id,
    name: data.name,
    owner_email: data.owner_email,
    encryption_secret: data.encryption_secret ?? generatedSecret,
    members: mergeMemberProfiles([
      (insertedMember as HouseholdMember) ?? {
        id: 'self',
        member_email: cleanEmail,
        status: 'active',
      },
    ]),
  };
}

export async function updateHouseholdMemberProfile(params: {
  householdId: string;
  memberId?: string;
  memberEmail: string;
  display_name?: string | null;
  avatar_url?: string | null;
}): Promise<void> {
  const cleanEmail = params.memberEmail.trim().toLowerCase();
  const payload: Record<string, unknown> = {};
  if ('display_name' in params) {
    payload.display_name = params.display_name?.trim() || null;
  }
  if ('avatar_url' in params) {
    payload.avatar_url = params.avatar_url || null;
  }

  writeCachedMemberProfile(cleanEmail, {
    ...(params.display_name !== undefined
      ? { display_name: params.display_name?.trim() || null }
      : {}),
    ...(params.avatar_url !== undefined ? { avatar_url: params.avatar_url || null } : {}),
  });

  if (Object.keys(payload).length === 0) return;

  let query = supabase.from('household_members').update(payload);
  if (params.memberId && params.memberId !== 'self') {
    query = query.eq('id', params.memberId);
  } else {
    query = query.eq('household_id', params.householdId).eq('member_email', cleanEmail);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function inviteHouseholdMember(householdId: string, memberEmail: string): Promise<void> {
  const cleanEmail = memberEmail.trim().toLowerCase();
  const { error } = await supabase.from('household_members').insert({
    household_id: householdId,
    member_email: cleanEmail,
    status: 'active',
  });
  if (error) throw error;
}

export async function removeHouseholdMember(memberId: string): Promise<void> {
  const { error } = await supabase.from('household_members').delete().eq('id', memberId);
  if (error) throw error;
}

export async function fetchCloudNotes(): Promise<CloudNoteRecord[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CloudNoteRecord[];
}

export async function upsertCloudNote(
  note: Note,
  ownerEmail: string,
  householdId: string | null
): Promise<void> {
  const { error } = await supabase.from('notes').upsert({
    id: note.id,
    owner_email: ownerEmail.trim().toLowerCase(),
    household_id: householdId,
    data: note,
    updated_at: note.updatedAt || new Date().toISOString(),
  });
  if (error) throw error;
}

export async function deleteCloudNote(noteId: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', noteId);
  if (error) throw error;
}
