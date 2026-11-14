import React, { useState } from 'react';
import { Home, LogOut, Mail, Plus, Trash2, UserPlus, Users, X } from 'lucide-react';
import {
  HouseholdInfo,
  createHousehold,
  inviteHouseholdMember,
  removeHouseholdMember,
  supabase,
} from '../services/supabase';

interface HouseholdModalProps {
  open: boolean;
  onClose: () => void;
  userEmail: string | null;
  household: HouseholdInfo | null;
  onHouseholdUpdated: () => Promise<void>;
}

export function HouseholdModal({
  open,
  onClose,
  userEmail,
  household,
  onHouseholdUpdated,
}: HouseholdModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('Familjen');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        setInfoMsg('Konto skapat! Du är nu inloggad.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      await onHouseholdUpdated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kunde inte logga in.');
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    onClose();
  };

  const handleCreateHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userEmail) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      await createHousehold(householdName, userEmail);
      await onHouseholdUpdated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kunde inte skapa hushåll.');
    } finally {
      setBusy(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!household || !inviteEmail.trim()) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBusy(true);
    try {
      await inviteHouseholdMember(household.id, inviteEmail);
      setInviteEmail('');
      setInfoMsg('Familjemedlem tillagd! De ser hushållet direkt när de loggar in med sin e-post.');
      await onHouseholdUpdated();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Kunde inte lägga till medlem.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setBusy(true);
    try {
      await removeHouseholdMember(memberId);
      await onHouseholdUpdated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#191D1A] border border-[#18221C]/12 dark:border-[#E3EAE5]/12 p-6 flex flex-col gap-5 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#2E6B4E] dark:text-[#8FD4AE] flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold">Konto & Hushåll</h2>
              <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">
                Synka listor & påminnelser i realtid
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-[#ECEFE9] dark:hover:bg-[#212723]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMsg && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/25 text-red-700 dark:text-red-300 px-3.5 py-2.5 text-xs">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="rounded-xl bg-[#D3EBD9] dark:bg-[#1C4A34] text-[#0D3824] dark:text-[#CBEED9] px-3.5 py-2.5 text-xs">
            {infoMsg}
          </div>
        )}

        {!userEmail ? (
          <form onSubmit={handleAuth} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#ECEFE9] dark:bg-[#212723]">
              <button
                type="button"
                onClick={() => setMode('login')}
                className={`py-2 rounded-lg text-xs font-semibold transition ${
                  mode === 'login'
                    ? 'bg-white dark:bg-[#191D1A] shadow-xs'
                    : 'text-[#525E56] dark:text-[#9BA79F]'
                }`}
              >
                Logga in
              </button>
              <button
                type="button"
                onClick={() => setMode('register')}
                className={`py-2 rounded-lg text-xs font-semibold transition ${
                  mode === 'register'
                    ? 'bg-white dark:bg-[#191D1A] shadow-xs'
                    : 'text-[#525E56] dark:text-[#9BA79F]'
                }`}
              >
                Skapa konto
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                E-postadress (t.ex. Outlook / Gmail)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#525E56] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="namn@outlook.com"
                  className="w-full h-11 pl-10 pr-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                Lösenord (minst 6 tecken)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-11 px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none focus:ring-2 focus:ring-[#2E6B4E]"
              />
            </div>

            <button
              type="submit"
              disabled={busy}
              className="h-11 mt-1 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Vänta...' : mode === 'register' ? 'Registrera konto' : 'Logga in'}
            </button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-2xl bg-[#ECEFE9] dark:bg-[#212723] px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs text-[#525E56] dark:text-[#9BA79F]">Inloggad som</p>
                <p className="text-sm font-semibold truncate">{userEmail}</p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#191D1A] text-xs font-medium text-red-600 dark:text-red-400"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logga ut</span>
              </button>
            </div>

            {!household ? (
              <form onSubmit={handleCreateHousehold} className="flex flex-col gap-3">
                <label className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                  Skapa ett nytt hushåll för att dela listor & påminnelser
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={householdName}
                    onChange={(e) => setHouseholdName(e.target.value)}
                    placeholder="T.ex. Familjen"
                    className="flex-1 h-11 px-3.5 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-sm focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 h-11 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Skapa</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Home className="w-4 h-4 text-[#2E6B4E] dark:text-[#8FD4AE]" />
                  <span>{household.name}</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                    Medlemmar i hushållet
                  </p>
                  {household.members.map((m) => (
                    <div
                      key={m.id + m.member_email}
                      className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-xs"
                    >
                      <span className="truncate">{m.member_email}</span>
                      {household.owner_email === userEmail &&
                        m.member_email !== userEmail &&
                        m.id !== 'self' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(m.id)}
                            className="text-red-500 p-1"
                            aria-label="Ta bort medlem"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                    </div>
                  ))}
                </div>

                <form onSubmit={handleInvite} className="flex flex-col gap-1.5 pt-1">
                  <label className="text-xs font-medium text-[#525E56] dark:text-[#9BA79F]">
                    Bjud in familjemedlem (ange deras e-post)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="partner@outlook.com"
                      className="flex-1 h-10 px-3 rounded-xl bg-[#ECEFE9] dark:bg-[#212723] text-xs focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-3.5 h-10 rounded-xl bg-[#2E6B4E] dark:bg-[#8FD4AE] text-white dark:text-[#063822] text-xs font-semibold"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Lägg till</span>
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
