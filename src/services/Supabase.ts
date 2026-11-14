import { createClient } from '@supabase/supabase-js';
import { Note } from '../types/note';

const SUPABASE_URL = 'https://cpzjxjctjmxxpjjvdvjm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-wXq5Dn5SRGegTHXEinHVA_340FkdZC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface HouseholdInfo {
  id: string;
  name: string;
  owner_email: string;
  members: { id: string; member_email: string; status: string }[];
}

export interface CloudNoteRecord {
  id: string;
  owner_email: string;
  household_id: string | null;
  data: Note;
  updated_at: string;
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

  const { data: members } = await supabase
    .from('household_members')
    .select('id, member_email, status')
    .eq('household_id', household.id);

  return {
    id: household.id,
    name: household.name,
    owner_email: household.owner_email,
    members: members ?? [],
  };
}

export async function createHousehold(name: string, ownerEmail: string): Promise<HouseholdInfo> {
  const cleanEmail = ownerEmail.trim().toLowerCase();
  const { data, error } = await supabase
    .from('households')
    .insert({ name: name.trim() || 'Vårt hushåll', owner_email: cleanEmail })
    .select()
    .single();

  if (error) throw error;

  await supabase.from('household_members').insert({
    household_id: data.id,
    member_email: cleanEmail,
    status: 'active',
  });

  return {
    id: data.id,
    name: data.name,
    owner_email: data.owner_email,
    members: [{ id: 'self', member_email: cleanEmail, status: 'active' }],
  };
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
