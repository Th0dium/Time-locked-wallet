"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import BN from "bn.js";
import bs58 from "bs58";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { getProgram, getVaultPda, randomU64BN, solToLamports } from "../src/utils/anchor";

// Time helpers (UTC-first)
function pad2(n: number) { return String(n).padStart(2, "0"); }
function formatTzLabel(offsetMin: number) {
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `UTC${sign}${pad2(hh)}${mm ? ":" + pad2(mm) : ""}`;
}
const TZ_OFFSETS: number[] = Array.from({ length: ((14 - -12) * 60) / 30 + 1 }, (_, i) => -12 * 60 + i * 30);
function formatCountdown(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}
function defaultUnlockMs() {
  // default now + 2 minutes
  return Date.now() + 120_000;
}
function msToDateTimeFields(msUTC: number, offsetMin: number) {
  // Convert a UTC ms timestamp into date/time components in the given timezone
  const msLocal = msUTC + offsetMin * 60_000;
  const d = new Date(msLocal);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  const hour = pad2(d.getUTCHours());
  const minute = pad2(d.getUTCMinutes());
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}
function fieldsToEpoch(dateStr: string, timeStr: string, offsetMin: number): number {
  // Interpret date/time as being in the given timezone, and return epoch seconds (UTC)
  // Expect dateStr=YYYY-MM-DD, timeStr=HH:MM
  if (!dateStr || !timeStr) return NaN;
  const [y, m, d] = dateStr.split("-").map((s) => parseInt(s, 10));
  const [hh, mm] = timeStr.split(":").map((s) => parseInt(s, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  const msUTC = Date.UTC(y, (m - 1), d, hh, mm) - offsetMin * 60_000;
  return Math.floor(msUTC / 1000);
}

// Avoid SSR for wallet button to prevent hydration mismatch
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function fmtAuthority(auth: any): string {
  if (auth === null || auth === undefined) return "None";
  try {
    if (typeof auth?.toBase58 === "function") return auth.toBase58();
    if (auth?.some !== undefined) {
      const v = auth.some;
      if (v === null || v === undefined) return "None";
      if (typeof v?.toBase58 === "function") return v.toBase58();
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return new PublicKey(v).toBase58();
    }
    if (typeof auth === "string") return auth;
    if (Array.isArray(auth)) return new PublicKey(auth).toBase58();
  } catch {}
  return "Unknown";
}

export default function Home() {
  const wallet = useWallet();
  const [tab, setTab] = useState<"create" | "admin" | "withdraw">("create");

  // Cache data across tabs; fetch once after wallet connects
  const [adminVaults, setAdminVaults] = useState<any[]>([]);
  const [withdrawVaults, setWithdrawVaults] = useState<any[]>([]);
  const [creatorVaults, setCreatorVaults] = useState<any[]>([]);
  const [loadingAdmin, setLoadingAdmin] = useState(false);
  const [loadingWithdraw, setLoadingWithdraw] = useState(false);
  const [loadingCreator, setLoadingCreator] = useState(false);
  const initialFetchedForWallet = useRef<string | null>(null);
  const [adminCooldownUntil, setAdminCooldownUntil] = useState<number | null>(null);
  const [withdrawCooldownUntil, setWithdrawCooldownUntil] = useState<number | null>(null);
  const [creatorCooldownUntil, setCreatorCooldownUntil] = useState<number | null>(null);

  const fetchAdmin = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setLoadingAdmin(true);
    try {
      const program = getProgram(wallet);
      const mem = bs58.encode(Buffer.concat([Buffer.from([1]), wallet.publicKey.toBuffer()]));
      const all = await program.account.timeLock.all([{ memcmp: { offset: 8 + 32, bytes: mem } }]);
      setAdminVaults(all);
    } catch (e) { console.error(e); }
    finally { setLoadingAdmin(false); }
  }, [wallet]);

  const fetchWithdraw = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setLoadingWithdraw(true);
    try {
      const program = getProgram(wallet);
      const pkb58 = wallet.publicKey.toBase58();
      const tagNone = bs58.encode(Buffer.from([0]));
      const tagSome = bs58.encode(Buffer.from([1]));
      // Case authority == None: receiver at offset 8+32+1, and tag 0 at 8+32
      const qNone = program.account.timeLock.all([
        { memcmp: { offset: 8 + 32, bytes: tagNone } },
        { memcmp: { offset: 8 + 32 + 1, bytes: pkb58 } },
      ]);
      // Case authority == Some: receiver at offset 8+32+1+32, and tag 1 at 8+32
      const qSome = program.account.timeLock.all([
        { memcmp: { offset: 8 + 32, bytes: tagSome } },
        { memcmp: { offset: 8 + 32 + 1 + 32, bytes: pkb58 } },
      ]);
      const [r1, r2] = await Promise.all([qNone, qSome]);
      const map = new Map<string, any>();
      for (const v of [...r1, ...r2]) map.set(v.publicKey.toBase58(), v);
      setWithdrawVaults(Array.from(map.values()));
    } catch (e) { console.error(e); }
    finally { setLoadingWithdraw(false); }
  }, [wallet]);

  const fetchCreator = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setLoadingCreator(true);
    try {
      const program = getProgram(wallet);
      const pkb58 = wallet.publicKey.toBase58();
      const all = await program.account.timeLock.all([{ memcmp: { offset: 8, bytes: pkb58 } }]);
      setCreatorVaults(all);
    } catch (e) { console.error(e); }
    finally { setLoadingCreator(false); }
  }, [wallet]);

  // Initial fetch after wallet connects (page load / reload)
  useEffect(() => {
    const pk = wallet.publicKey?.toBase58();
    if (!wallet.connected || !pk) return;
    if (initialFetchedForWallet.current === pk) return;
    initialFetchedForWallet.current = pk;
    fetchAdmin();
    fetchWithdraw();
    fetchCreator();
  }, [wallet.connected, wallet.publicKey, fetchAdmin, fetchWithdraw, fetchCreator]);
  
  // Refresh all lists (bypass cooldowns). Use after mutating actions.
  const refreshAll = useCallback(async () => {
    await Promise.all([
      (async () => { try { await fetchAdmin(); } catch {} })(),
      (async () => { try { await fetchWithdraw(); } catch {} })(),
      (async () => { try { await fetchCreator(); } catch {} })(),
    ]);
  }, [fetchAdmin, fetchWithdraw, fetchCreator]);

  // Manual refresh with 5s cooldown per tab
  const handleAdminRefresh = useCallback(async () => {
    const now = Date.now();
    if (adminCooldownUntil && now < adminCooldownUntil) return;
    setAdminCooldownUntil(now + 5000);
    setTimeout(() => setAdminCooldownUntil(null), 5000);
    await fetchAdmin();
  }, [fetchAdmin, adminCooldownUntil]);

  const handleWithdrawRefresh = useCallback(async () => {
    const now = Date.now();
    if (withdrawCooldownUntil && now < withdrawCooldownUntil) return;
    setWithdrawCooldownUntil(now + 5000);
    setTimeout(() => setWithdrawCooldownUntil(null), 5000);
    await fetchWithdraw();
  }, [fetchWithdraw, withdrawCooldownUntil]);

  const handleCreatorRefresh = useCallback(async () => {
    const now = Date.now();
    if (creatorCooldownUntil && now < creatorCooldownUntil) return;
    setCreatorCooldownUntil(now + 5000);
    setTimeout(() => setCreatorCooldownUntil(null), 5000);
    await fetchCreator();
  }, [fetchCreator, creatorCooldownUntil]);

  return (
    <div className="min-h-screen p-4 sm:p-6 text-base sm:text-sm flex flex-col items-center">
      <header className="w-full max-w-4xl flex flex-col sm:flex-row gap-3 sm:gap-0 items-stretch sm:items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Time-Locked Wallet (Devnet)</h1>
        <WalletMultiButton />
      </header>

      <nav className="w-full max-w-4xl flex flex-wrap gap-2 mb-4 justify-center">
        <button className={btnCls(tab === "create") + " w-full sm:w-auto"} onClick={() => setTab("create")}>Create Vault</button>
        <button className={btnCls(tab === "admin") + " w-full sm:w-auto"} onClick={() => setTab("admin")}>Administrator</button>
        <button className={btnCls(tab === "withdraw") + " w-full sm:w-auto"} onClick={() => setTab("withdraw")}>Withdraw</button>
      </nav>

      {tab === "create" && (
        <CreateVault
          creatorVaults={creatorVaults}
          loadingCreator={loadingCreator}
          onRefreshCreator={handleCreatorRefresh}
          refreshDisabledCreator={!!(creatorCooldownUntil && Date.now() < creatorCooldownUntil)}
          onRefreshAll={refreshAll}
        />
      )}
      {tab === "admin" && (
        <AdminView
          vaults={adminVaults}
          loading={loadingAdmin}
          onRefresh={handleAdminRefresh}
          refreshDisabled={!!(adminCooldownUntil && Date.now() < adminCooldownUntil)}
          onRefreshAll={refreshAll}
        />
      )}
      {tab === "withdraw" && (
        <WithdrawView
          vaults={withdrawVaults}
          loading={loadingWithdraw}
          onRefresh={handleWithdrawRefresh}
          refreshDisabled={!!(withdrawCooldownUntil && Date.now() < withdrawCooldownUntil)}
          onRefreshAll={refreshAll}
        />
      )}
    </div>
  );
}

function btnCls(active: boolean) {
  return `btn ${active ? 'btn--solid' : ''}`;
}

function CreateVault({
  creatorVaults,
  loadingCreator,
  onRefreshCreator,
  refreshDisabledCreator,
  onRefreshAll,
}: {
  creatorVaults: any[];
  loadingCreator: boolean;
  onRefreshCreator: () => Promise<void> | void;
  refreshDisabledCreator: boolean;
  onRefreshAll: () => Promise<void> | void;
}) {
  const wallet = useWallet();
  const [amountSol, setAmountSol] = useState(0.1);
  const [unlockDate, setUnlockDate] = useState<string>("");
  const [unlockTime, setUnlockTime] = useState<string>("");
  const [tzOffset, setTzOffset] = useState<number>(420); // minutes offset from UTC (default GMT+7)
  const [authorityInput, setAuthorityInput] = useState("");
  const [receiver, setReceiver] = useState("");
  const [rights, setRights] = useState(0);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deletingPk, setDeletingPk] = useState<string | null>(null);

  // Initialize default UTC time (now + 2 min) with default TZ = GMT+7
  useEffect(() => {
    const defaultOffset = 7 * 60;
    const ms = defaultUnlockMs();
    const { date, time } = msToDateTimeFields(ms, defaultOffset);
    setUnlockDate(date);
    setUnlockTime(time);
    setTzOffset(defaultOffset);
  }, []);

  const authorityPk = useMemo(() => {
    if (!authorityInput) return null;
    try { return new PublicKey(authorityInput); } catch { return null; }
  }, [authorityInput]);
  const hasAuthority = authorityInput.trim().length > 0;
  const authorityInvalid = hasAuthority && authorityPk === null;

  const receiverPkObj = useMemo(() => {
    if (!receiver) return null;
    try { return new PublicKey(receiver); } catch { return null; }
  }, [receiver]);
  const receiverInvalid = receiver.trim().length > 0 && receiverPkObj === null;

  // If authority cleared, ensure rights reset to 0 so validation passes
  useEffect(() => {
    if (!hasAuthority && rights !== 0) setRights(0);
  }, [hasAuthority, rights]);
  // If authority is entered for the first time, default rights to BOTH (3)
  useEffect(() => {
    if (hasAuthority && rights === 0) setRights(3);
  }, [hasAuthority, rights]);

  // PDA preview is omitted; seed is generated on submit

  const onSubmit = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) return alert("Connect wallet first");
    if (!receiverPkObj) return alert("Receiver pubkey required or invalid format");
    // Do not block on invalid authority: treat as None and force rights=0 at submit

    setBusy(true);
    try {
      const program = getProgram(wallet);
      const amount = new BN(solToLamports(amountSol).toString());
      const tsNum = fieldsToEpoch(unlockDate, unlockTime, tzOffset);
      const nowNum = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(tsNum) || tsNum <= nowNum) {
        return alert("Unlock time must be in the future");
      }
      const unlockTs = new BN(tsNum);
      const useAuthority = authorityPk ? authorityPk : null;
      const useRights = authorityPk ? rights : 0;
      // Generate a fresh random seed for this vault
      const seedBN = randomU64BN();
      const [pda] = getVaultPda(wallet.publicKey, seedBN);

      const tx = await program.methods
        .initializeLock(amount, unlockTs, useAuthority, receiverPkObj, seedBN, useRights)
        .accounts({
          vault: pda.toBase58(),
          creator: wallet.publicKey.toBase58(),
          systemProgram: SystemProgram.programId.toBase58(),
        })
        .rpc();
      setTxSig(tx);
      // refresh all lists after successful create
      try { await onRefreshAll(); } catch {}
    } catch (e: any) {
      try {
        if (typeof e?.getLogs === "function") {
          const logs = await e.getLogs();
          console.error("SendTransactionError logs:", logs);
        }
      } catch {}
      console.error(e);
      // Some RPCs may throw "already been processed" on duplicate simulation; treat as non-fatal if tx actually landed
      alert(e?.error?.errorMessage || e.message || "Transaction failed");
    } finally {
      setBusy(false);
    }
  }, [wallet, amountSol, unlockDate, unlockTime, tzOffset, authorityInput, authorityPk, receiverPkObj, rights]);

  return (
    <div className="w-full max-w-xl space-y-3">
      <h2 className="text-lg font-semibold">Create Vault</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="col-span-1">Amount (SOL)
          <input type="number" step="0.000000001" className="w-full border px-2 py-1"
            value={amountSol} onChange={e=>setAmountSol(parseFloat(e.target.value||"0"))} />
        </label>
        <div className="col-span-1 space-y-1">
          <div className="font-medium">Unlock time</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
            <input type="date" className="border px-2 py-1 sm:col-span-2" value={unlockDate} onChange={(e)=>setUnlockDate(e.target.value)} />
            <input type="time" className="border px-2 py-1 sm:col-span-1" step={60} value={unlockTime} onChange={(e)=>setUnlockTime(e.target.value)} />
          </div>
          <div>
            <label className="text-xs">Timezone</label>
            <select className="w-full border px-2 py-1" value={tzOffset} onChange={(e)=>setTzOffset(parseInt(e.target.value))}>
              {TZ_OFFSETS.map((o)=> (
                <option key={o} value={o}>{formatTzLabel(o)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="col-span-2">
          <label className="block">Receiver Pubkey</label>
          <div className="flex gap-2">
            <input
              className={`flex-1 border px-2 py-1 ${receiverInvalid ? 'border-red-500' : ''}`}
              placeholder="Receiver PublicKey"
              value={receiver}
              onChange={e=>setReceiver(e.target.value)}
              aria-invalid={receiverInvalid}
            />
            <button
              type="button"
              className="btn"
              onClick={()=> setReceiver(wallet.publicKey?.toBase58() || "")}
            >Self</button>
          </div>
          {receiverInvalid && (
            <p className="text-xs text-red-600 mt-1">Invalid public key format</p>
          )}
        </div>
        <div className="col-span-2">
          <label className="block font-medium mb-1" title="Leave empty for none">Authority Pubkey (optional)</label>
          <div className="flex gap-2">
            <input
              className={`flex-1 border px-2 py-1 ${authorityInvalid ? 'border-red-500' : ''}`}
              placeholder="Leave empty for none"
              title="Leave empty for none"
              value={authorityInput}
              onChange={(e)=>setAuthorityInput(e.target.value)}
              aria-invalid={authorityInvalid}
            />
            <button
              type="button"
              className="btn"
              onClick={()=> setAuthorityInput(wallet.publicKey?.toBase58() || "")}
            >Self</button>
          </div>
          {authorityInvalid && (
            <p className="text-xs text-red-600 mt-1">Invalid public key format</p>
          )}
        </div>
        {hasAuthority && (
          <label className="col-span-2">Authority rights
            <select className="w-full border px-2 py-1" value={rights} onChange={e=>setRights(parseInt(e.target.value))}>
              <option value={1}>Change receiver</option>
              <option value={2}>Change duration</option>
              <option value={3}>Both</option>
            </select>
          </label>
        )}
        <div className="col-span-2 flex items-center gap-2">
          <button disabled={busy || !wallet.connected} onClick={onSubmit} className="btn btn--solid disabled:opacity-50">Create</button>
          {/* Seed is generated automatically on submit */}
        </div>
        {txSig && <div className="col-span-2 text-xs break-all">Tx: {txSig}</div>}
      </div>
      {/* Creator vaults list */}
      <div className="mt-8 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Vaults Created</h3>
          <div className="flex items-center gap-2">
            <button disabled={refreshDisabledCreator} onClick={()=>onRefreshCreator()} className="btn disabled:opacity-50">Refresh</button>
            {loadingCreator && <span className="text-sm">Loading…</span>}
          </div>
        </div>
        <div className="grid gap-3">
          {creatorVaults.map((v:any)=> (
            <div key={v.publicKey.toBase58()} className="vault-card border rounded-md p-2 sm:p-3 space-y-1 text-xs sm:text-base leading-tight">
              <div>Vault:</div>
              <div className="break-all text-gray-500">{v.publicKey.toBase58()}</div>
              <div>Authority:</div>
              <div className="break-all text-emerald-500">{fmtAuthority(v.account.authority)}</div>
              <div>Receiver:</div>
              <div className="break-all text-emerald-500">{v.account.receiver.toBase58()}</div>
            <div>
              Amount: <span className="text-purple-500">{Number(v.account.amount) / 1_000_000_000} SOL</span>{Number(v.account.amount) === 0 ? " (Claimed)" : ""}
            </div>
              <div>
                {Number(v.account.amount) === 0
                  ? <>Withdrawn at {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleTimeString()}</>
                  : <>Unlock: {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleString()}</>}
              </div>
              <div>
                <button
                  className="btn"
                  disabled={Number(v.account.amount) !== 0 || deletingPk === v.publicKey.toBase58()}
                  onClick={async ()=>{
                    if (!wallet.connected || !wallet.publicKey) return alert('Connect wallet first');
                    try {
                      setDeletingPk(v.publicKey.toBase58());
                      const program = getProgram(wallet);
                      await program.methods
                        .closeVault()
                        .accounts({ vault: v.publicKey.toBase58(), creator: wallet.publicKey.toBase58() })
                        .rpc();
                      await onRefreshAll();
                    } catch (e:any) {
                      try { if (typeof e?.getLogs === 'function') console.error('SendTransactionError logs:', await e.getLogs()); } catch {}
                      console.error(e);
                      alert(e?.error?.errorMessage || e.message || 'Delete failed');
                    } finally {
                      setDeletingPk(null);
                    }
                  }}
                >{deletingPk === v.publicKey.toBase58() ? 'Deleting…' : 'Delete Vault'}</button>
              </div>
            </div>
          ))}
          {creatorVaults.length === 0 && (
            <div className="text-sm text-gray-500">No vaults found for your address.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AdminView({ vaults, loading, onRefresh, refreshDisabled, onRefreshAll }: { vaults: any[]; loading: boolean; onRefresh: () => Promise<void> | void; refreshDisabled: boolean; onRefreshAll: () => Promise<void> | void }) {
  const wallet = useWallet();
  const [newReceiver, setNewReceiver] = useState("");
  const [newDate, setNewDate] = useState<string>("");
  const [newTime, setNewTime] = useState<string>("");
  const [newTzOffset, setNewTzOffset] = useState<number>(7 * 60);
  useEffect(() => {
    const defaultOffset = 7 * 60; // GMT+7, align with Create tab
    const ms = Date.now() + 3600_000; // +1h default
    const { date, time } = msToDateTimeFields(ms, defaultOffset);
    setNewDate(date);
    setNewTime(time);
    setNewTzOffset(defaultOffset);
  }, []);

  // Data comes from parent and persists across tabs

  const doSetReceiver = async (vault: any) => {
    if (!newReceiver) return alert("Enter new receiver pubkey");
    let pk: PublicKey;
    try { pk = new PublicKey(newReceiver); } catch { return alert("Invalid receiver pubkey"); }
    try {
      const program = getProgram(wallet);
      await program.methods
        .setReceiver(pk)
        .accounts({ vault: vault.publicKey.toBase58(), authority: wallet.publicKey?.toBase58() as string })
        .rpc();
      await onRefreshAll();
    } catch (e:any) {
      try { if (typeof e?.getLogs === 'function') console.error('SendTransactionError logs:', await e.getLogs()); } catch {}
      alert(e?.error?.errorMessage || e.message);
    }
  };

  const doSetDuration = async (vault: any) => {
    const ts = fieldsToEpoch(newDate, newTime, newTzOffset);
    const nowNum = Math.floor(Date.now()/1000);
    if (!Number.isFinite(ts) || ts <= nowNum) {
      return alert("New unlock time must be in the future");
    }
    try {
      const program = getProgram(wallet);
      await program.methods
        .setDuration(new BN(ts))
        .accounts({ vault: vault.publicKey.toBase58(), authority: wallet.publicKey?.toBase58() as string })
        .rpc();
      await onRefreshAll();
    } catch (e:any) {
      try { if (typeof e?.getLogs === 'function') console.error('SendTransactionError logs:', await e.getLogs()); } catch {}
      alert(e?.error?.errorMessage || e.message);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Administrator</h2>
      <div className="flex gap-2 items-center justify-center">
        <button disabled={refreshDisabled} onClick={()=>onRefresh()} className="btn disabled:opacity-50">Refresh</button>
        {loading && <span>Loading…</span>}
      </div>
      <div className="grid gap-3">
        {vaults.map((v:any)=> (
          <div key={v.publicKey.toBase58()} className="vault-card border rounded-md p-2 sm:p-3 space-y-2 text-xs sm:text-base leading-tight">
            <div>Vault:</div>
            <div className="break-all text-gray-500">{v.publicKey.toBase58()}</div>
            <div>Authority:</div>
            <div className="break-all text-emerald-500">{fmtAuthority(v.account.authority)}</div>
            <div>Receiver:</div>
            <div className="break-all text-emerald-500">{v.account.receiver.toBase58()}</div>
            <div>
              Amount: <span className="text-purple-500">{Number(v.account.amount) / 1_000_000_000} SOL</span>{Number(v.account.amount) === 0 ? " (Claimed)" : ""}
            </div>
            <div>
              {Number(v.account.amount) === 0
                ? <>Withdrawn at {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleTimeString()}</>
                : <>Unlock: {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleString()}</>}
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input className="border px-2 py-1 rounded-md" placeholder="New Receiver" value={newReceiver} onChange={e=>setNewReceiver(e.target.value)} />
              <button onClick={()=>doSetReceiver(v)} className="btn">Set Receiver</button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" className="border px-2 py-1 rounded-md" value={newDate} onChange={(e)=>setNewDate(e.target.value)} />
              <input lang="en-US" type="time" className="border px-2 py-1 rounded-md" step={60} value={newTime} onChange={(e)=>setNewTime(e.target.value)} />
              <select className="border px-2 py-1 rounded-md" value={newTzOffset} onChange={(e)=>setNewTzOffset(parseInt(e.target.value))}>
                {TZ_OFFSETS.map((o)=> (
                  <option key={o} value={o}>{formatTzLabel(o)}</option>
                ))}
              </select>
              <button onClick={()=>doSetDuration(v)} className="btn">Set Duration</button>
            </div>
          </div>
        ))}
        {vaults.length === 0 && <div className="text-sm text-gray-500">No vaults found for your address.</div>}
      </div>
    </div>
  );
}

function WithdrawView({ vaults, loading, onRefresh, refreshDisabled, onRefreshAll }: { vaults: any[]; loading: boolean; onRefresh: () => Promise<void> | void; refreshDisabled: boolean; onRefreshAll: () => Promise<void> | void }) {
  const wallet = useWallet();
  const [nowSec, setNowSec] = useState(Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const doWithdraw = async (vault:any) => {
    try {
      const program = getProgram(wallet);
      await program.methods
        .withdraw()
        .accounts({
          vault: vault.publicKey.toBase58(),
          receiver: wallet.publicKey?.toBase58() as string,
          creatorAccount: vault.account.creator.toBase58(),
        })
        .rpc();
      await onRefreshAll();
    } catch (e:any) {
      try { if (typeof e?.getLogs === 'function') console.error('SendTransactionError logs:', await e.getLogs()); } catch {}
      alert(e?.error?.errorMessage || e.message);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Withdraw</h2>
      <div className="flex gap-2 items-center justify-center">
        <button disabled={refreshDisabled} onClick={()=>onRefresh()} className="btn disabled:opacity-50">Refresh</button>
        {loading && <span>Loading…</span>}
      </div>
      <div className="grid gap-3">
        {vaults.map((v:any)=> (
          <div key={v.publicKey.toBase58()} className="vault-card border rounded-md p-2 sm:p-3 space-y-2 text-xs sm:text-base leading-tight">
            <div>Vault:</div>
            <div className="break-all text-gray-500">{v.publicKey.toBase58()}</div>
            <div>
              Amount: <span className="text-purple-500">{Number(v.account.amount) / 1_000_000_000} SOL</span>{Number(v.account.amount) === 0 ? " (Claimed)" : ""}
            </div>
            <div>
              {Number(v.account.amount) === 0
                ? <>Withdrawn at {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleTimeString()}</>
                : <>Unlock: {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleString()}</>}
            </div>
            <div>
              {(() => {
                const rem = Number(v.account.unlockTimestamp) - nowSec;
                if (rem > 0) return <>Unlocks in: {formatCountdown(rem)}</>;
                return Number(v.account.amount) === 0
                  ? <>There is nothing to withdraw</>
                  : <>Ready to withdraw</>;
              })()}
            </div>
            <button
              onClick={()=>doWithdraw(v)}
              className="btn btn--solid"
              disabled={Number(v.account.amount) === 0}
            >
              Withdraw
            </button>
          </div>
        ))}
        {vaults.length === 0 && <div  className="text-sm text-gray-500">No vaults found for your address.</div>}
      </div>
    </div>
  );
}
