"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import BN from "bn.js";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { getProgram, getVaultPda, randomU64BN, solToLamports, nowUnix } from "../src/utils/anchor";

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
function defaultUnlockMs(offsetMin = 0) {
  // default now + 2 minutes, represented in given timezone
  const ms = Date.now() + 120_000;
  return ms;
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

export default function Home() {
  const wallet = useWallet();
  const [tab, setTab] = useState<"create" | "admin" | "withdraw">("create");

  return (
    <div className="min-h-screen p-6 text-sm">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Time-Locked Wallet (Devnet)</h1>
        <WalletMultiButton />
      </header>

      <nav className="flex gap-2 mb-4">
        <button className={btnCls(tab === "create")} onClick={() => setTab("create")}>Create Vault</button>
        <button className={btnCls(tab === "admin")} onClick={() => setTab("admin")}>Administrator</button>
        <button className={btnCls(tab === "withdraw")} onClick={() => setTab("withdraw")}>Withdraw</button>
      </nav>

      {tab === "create" && <CreateVault />}
      {tab === "admin" && <AdminView />}
      {tab === "withdraw" && <WithdrawView />}
    </div>
  );
}

function btnCls(active: boolean) {
  return `px-3 py-2 rounded border ${active ? "bg-black text-white" : "bg-transparent"}`;
}

function CreateVault() {
  const wallet = useWallet();
  const [amountSol, setAmountSol] = useState(0.1);
  const [unlockDate, setUnlockDate] = useState<string>("");
  const [unlockTime, setUnlockTime] = useState<string>("");
  const [tzOffset, setTzOffset] = useState<number>(0); // minutes offset from UTC
  const [authorityMode, setAuthorityMode] = useState<"none" | "self" | "other">("none");
  const [authorityOther, setAuthorityOther] = useState("");
  const [receiver, setReceiver] = useState("");
  const [rights, setRights] = useState(0);
  const [seedBN, setSeedBN] = useState<BN | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Initialize default UTC time (now + 2 min) and seed
  useEffect(() => {
    const ms = defaultUnlockMs(0);
    const { date, time } = msToDateTimeFields(ms, 0);
    setUnlockDate(date);
    setUnlockTime(time);
    setTzOffset(0);
    setSeedBN(randomU64BN());
  }, []);

  const creatorPk = wallet.publicKey;
  const authorityPk = useMemo(() => {
    if (authorityMode === "none") return null;
    if (authorityMode === "self") return creatorPk ?? null;
    try {
      return authorityOther ? new PublicKey(authorityOther) : null;
    } catch { return null; }
  }, [authorityMode, creatorPk, authorityOther]);

  const seedLe = useMemo(() => (seedBN ? Buffer.from(seedBN.toArray("le", 8)) : Buffer.alloc(8)), [seedBN]);
  const vaultPda = useMemo(() => {
    if (!creatorPk) return null as PublicKey | null;
    if (!seedBN) return null;
    return getVaultPda(creatorPk, seedBN)[0];
  }, [creatorPk, seedBN]);

  const onSubmit = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey) return alert("Connect wallet first");
    if (!receiver) return alert("Receiver pubkey required");
    let receiverPk: PublicKey;
    try { receiverPk = new PublicKey(receiver); } catch { return alert("Invalid receiver pubkey"); }
    if (authorityMode === "other" && !authorityPk) return alert("Invalid authority pubkey");
    if (authorityMode === "none" && rights !== 0) return alert("Rights must be 0 when authority is None");

    setBusy(true);
    try {
      if (!seedBN) return alert("Seed not ready yet, please try again");
      const program = getProgram(wallet);
      const amount = new BN(solToLamports(amountSol).toString());
      const tsNum = fieldsToEpoch(unlockDate, unlockTime, tzOffset);
      const nowNum = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(tsNum) || tsNum <= nowNum) {
        return alert("Unlock time must be in the future");
      }
      const unlockTs = new BN(tsNum);
      const authorityOpt = authorityPk ? authorityPk : null;
      const [pda] = getVaultPda(wallet.publicKey, seedBN);

      const tx = await program.methods
        .initializeLock(amount, unlockTs, authorityOpt, receiverPk, seedBN, rights)
        .accounts({
          vault: pda.toBase58(),
          creator: wallet.publicKey.toBase58(),
          systemProgram: SystemProgram.programId.toBase58(),
        })
        .rpc();
      setTxSig(tx);
    } catch (e: any) {
      console.error(e);
      alert(e?.error?.errorMessage || e.message || "Transaction failed");
    } finally {
      setBusy(false);
    }
  }, [wallet, amountSol, unlockDate, unlockTime, tzOffset, authorityMode, authorityPk, receiver, rights, seedBN]);

  return (
    <div className="max-w-xl space-y-3">
      <h2 className="text-lg font-semibold">Create Vault</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-1">Amount (SOL)
          <input type="number" step="0.000000001" className="w-full border px-2 py-1"
            value={amountSol} onChange={e=>setAmountSol(parseFloat(e.target.value||"0"))} />
        </label>
        <div className="col-span-1 space-y-1">
          <div className="font-medium">Unlock time (UTC-first)</div>
          <div className="grid grid-cols-3 gap-2 items-center">
            <input type="date" className="col-span-2 border px-2 py-1" value={unlockDate} onChange={(e)=>setUnlockDate(e.target.value)} />
            <input type="time" className="col-span-1 border px-2 py-1" step={60} value={unlockTime} onChange={(e)=>setUnlockTime(e.target.value)} />
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
        <label className="col-span-2">Receiver pubkey
          <input className="w-full border px-2 py-1" placeholder="Receiver PublicKey"
            value={receiver} onChange={e=>setReceiver(e.target.value)} />
        </label>
        <fieldset className="col-span-2">
          <legend className="font-medium mb-1">Authority</legend>
          <div className="flex gap-4">
            <label><input type="radio" name="auth" checked={authorityMode==="none"} onChange={()=>setAuthorityMode("none")} /> None</label>
            <label><input type="radio" name="auth" checked={authorityMode==="self"} onChange={()=>setAuthorityMode("self")} /> Self (creator)</label>
            <label className="flex items-center gap-2">
              <input type="radio" name="auth" checked={authorityMode==="other"} onChange={()=>setAuthorityMode("other")} /> Other
              <input className="border px-2 py-1" placeholder="Authority PublicKey" value={authorityOther} onChange={e=>setAuthorityOther(e.target.value)} />
            </label>
          </div>
        </fieldset>
        <label className="col-span-2">Authority rights
          <select className="w-full border px-2 py-1" value={rights} onChange={e=>setRights(parseInt(e.target.value))}>
            <option value={0}>None</option>
            <option value={1}>Change receiver</option>
            <option value={2}>Change duration</option>
            <option value={3}>Both</option>
          </select>
        </label>
        <div className="col-span-2 flex items-center gap-2">
          <button disabled={busy || !wallet.connected} onClick={onSubmit} className="px-3 py-2 border rounded disabled:opacity-50">Create</button>
          <button className="px-3 py-2 border rounded" onClick={()=>setSeedBN(randomU64BN())}>New Seed</button>
          {vaultPda && <span className="text-xs break-all">PDA: {vaultPda.toBase58()}</span>}
        </div>
        {txSig && <div className="col-span-2 text-xs break-all">Tx: {txSig}</div>}
      </div>
    </div>
  );
}

function AdminView() {
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [vaults, setVaults] = useState<any[]>([]);
  const [newReceiver, setNewReceiver] = useState("");
  const [newDate, setNewDate] = useState<string>("");
  const [newTime, setNewTime] = useState<string>("");
  const [newTzOffset, setNewTzOffset] = useState<number>(0);
  useEffect(() => {
    const ms = Date.now() + 3600_000; // +1h default
    const { date, time } = msToDateTimeFields(ms, 0);
    setNewDate(date);
    setNewTime(time);
    setNewTzOffset(0);
  }, []);

  const reload = useCallback(async ()=>{
    if (!wallet.connected) return setVaults([]);
    setLoading(true);
    try {
      const program = getProgram(wallet);
      const all = await program.account.timeLock.all();
      const filtered = all.filter((a: any)=> a.account.authority && a.account.authority.toBase58 && a.account.authority.toBase58() === wallet.publicKey?.toBase58());
      setVaults(filtered);
    } catch(e){ console.error(e); }
    setLoading(false);
  },[wallet]);

  useEffect(()=>{ reload(); },[reload]);

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
      await reload();
    } catch (e:any) { alert(e?.error?.errorMessage || e.message); }
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
      await reload();
    } catch (e:any) { alert(e?.error?.errorMessage || e.message); }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Administrator</h2>
      <div className="flex gap-2 items-center">
        <button onClick={reload} className="px-3 py-2 border rounded">Refresh</button>
        {loading && <span>Loading…</span>}
      </div>
      <div className="grid gap-3">
        {vaults.map((v:any)=> (
          <div key={v.publicKey.toBase58()} className="border rounded p-3 space-y-2">
            <div className="text-xs break-all">Vault: {v.publicKey.toBase58()}</div>
            <div>Receiver: {v.account.receiver.toBase58()}</div>
            <div>Amount: {Number(v.account.amount) / 1_000_000_000} SOL</div>
            <div>Unlock: {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleString()}</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input className="border px-2 py-1" placeholder="New receiver" value={newReceiver} onChange={e=>setNewReceiver(e.target.value)} />
              <button onClick={()=>doSetReceiver(v)} className="px-3 py-1 border rounded">Set Receiver</button>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <input type="date" className="border px-2 py-1" value={newDate} onChange={(e)=>setNewDate(e.target.value)} />
              <input type="time" className="border px-2 py-1" step={60} value={newTime} onChange={(e)=>setNewTime(e.target.value)} />
              <select className="border px-2 py-1" value={newTzOffset} onChange={(e)=>setNewTzOffset(parseInt(e.target.value))}>
                {TZ_OFFSETS.map((o)=> (
                  <option key={o} value={o}>{formatTzLabel(o)}</option>
                ))}
              </select>
              <button onClick={()=>doSetDuration(v)} className="px-3 py-1 border rounded">Set Duration</button>
            </div>
          </div>
        ))}
        {vaults.length === 0 && <div>No vaults found for your authority.</div>}
      </div>
    </div>
  );
}

function WithdrawView() {
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [vaults, setVaults] = useState<any[]>([]);

  const reload = useCallback(async ()=>{
    if (!wallet.connected) return setVaults([]);
    setLoading(true);
    try {
      const program = getProgram(wallet);
      const all = await program.account.timeLock.all();
      const filtered = all.filter((a: any)=> a.account.receiver.toBase58() === wallet.publicKey?.toBase58());
      setVaults(filtered);
    } catch(e){ console.error(e); }
    setLoading(false);
  },[wallet]);

  useEffect(()=>{ reload(); },[reload]);

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
      await reload();
    } catch (e:any) { alert(e?.error?.errorMessage || e.message); }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Withdraw</h2>
      <div className="flex gap-2 items-center">
        <button onClick={reload} className="px-3 py-2 border rounded">Refresh</button>
        {loading && <span>Loading…</span>}
      </div>
      <div className="grid gap-3">
        {vaults.map((v:any)=> (
          <div key={v.publicKey.toBase58()} className="border rounded p-3 space-y-2">
            <div className="text-xs break-all">Vault: {v.publicKey.toBase58()}</div>
            <div>Amount: {Number(v.account.amount) / 1_000_000_000} SOL</div>
            <div>Unlock: {new Date(Number(v.account.unlockTimestamp) * 1000).toLocaleString()}</div>
            <button onClick={()=>doWithdraw(v)} className="px-3 py-2 border rounded">Withdraw</button>
          </div>
        ))}
        {vaults.length === 0 && <div>No vaults found for your receiver.</div>}
      </div>
    </div>
  );
}
