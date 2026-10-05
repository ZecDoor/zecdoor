import { ASSET, type MoveKind } from '@zecdoor/solana';
import { PublicKey } from '@solana/web3.js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { exitMinimum, oneClick, type Destination, type TopUpPlan } from '../lib/move';
import { getPhantom, type PhantomSolana } from '../lib/phantom';
import { geo as fetchGeo, health as fetchHealth, type Geo, type Health } from '../lib/server';
import { readBalances, type Balances } from '../lib/solana';
import { getWallet, type BrowserWallet, type MoveRecord, listMoves } from '../lib/store';

/** What the user is about to do, built up across screens. Lives in memory only. */
export interface Draft {
  kind: MoveKind;
  amount: bigint;
  topUp?: TopUpPlan;
  /** Buy: what the user pays with and how much, in base units. */
  pay?: { symbol: 'USDC' | 'SOL'; amount: bigint };
  dest?: Destination;
}

export interface Prices {
  zec?: number;
  sol?: number;
  usdc?: number;
}

interface AppState {
  provider: PhantomSolana | null;
  owner: PublicKey | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  balances: Balances | null;
  balanceError: string | null;
  refreshBalances(): Promise<void>;
  minimum: bigint | null;
  wallet: BrowserWallet | null;
  reloadWallet(): Promise<void>;
  moves: MoveRecord[];
  reloadMoves(): Promise<void>;
  health: Health | null;
  geo: Geo | null;
  prices: Prices;
  draft: Draft | null;
  setDraft(d: Draft | null): void;
  /** The 24 words between the backup screen and the check. Never stored. */
  seed: React.MutableRefObject<{ mnemonic: string; ufvk: string; birthday: number } | null>;
}

const Ctx = createContext<AppState | null>(null);

/** Phantom's key object may come from another copy of web3.js; rebuild it as ours. */
const asKey = (pk: unknown) => new PublicKey(String(pk));

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<PhantomSolana | null>(() => getPhantom());
  const [owner, setOwner] = useState<PublicKey | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [minimum, setMinimum] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [moves, setMoves] = useState<MoveRecord[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [prices, setPrices] = useState<Prices>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const seed = useRef<AppState['seed']['current']>(null);

  // Phantom injects its provider shortly after load on some platforms.
  useEffect(() => {
    if (provider) return;
    const t = setInterval(() => {
      const p = getPhantom();
      if (p) {
        setProvider(p);
        clearInterval(t);
      }
    }, 250);
    const stop = setTimeout(() => clearInterval(t), 3000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [provider]);

  // Reconnect silently only if the user already trusted this site in Phantom.
  useEffect(() => {
    if (!provider) return;
    provider
      .connect({ onlyIfTrusted: true })
      .then((r) => setOwner(asKey(r.publicKey)))
      .catch(() => {});
    const onChange = (pk?: unknown) => {
      setOwner(pk ? asKey(pk) : null);
      setBalances(null);
      setDraft(null);
    };
    const onDisconnect = () => setOwner(null);
    provider.on('accountChanged', onChange);
    provider.on('disconnect', onDisconnect);
    return () => {
      (provider.off ?? provider.removeListener)?.call(provider, 'accountChanged', onChange);
      (provider.off ?? provider.removeListener)?.call(provider, 'disconnect', onDisconnect);
    };
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) throw new Error('Phantom not found');
    const r = await provider.connect();
    setOwner(asKey(r.publicKey));
  }, [provider]);

  const disconnect = useCallback(async () => {
    await provider?.disconnect().catch(() => {});
    setOwner(null);
    setBalances(null);
    setDraft(null);
  }, [provider]);

  const refreshBalances = useCallback(async () => {
    if (!owner) return;
    try {
      setBalances(await readBalances(owner));
      setBalanceError(null);
    } catch (e) {
      setBalanceError((e as Error).message);
    }
  }, [owner]);

  const reloadWallet = useCallback(async () => setWallet((await getWallet()) ?? null), []);
  const reloadMoves = useCallback(async () => setMoves(await listMoves()), []);

  useEffect(() => {
    void reloadWallet();
    void reloadMoves();
    void fetchHealth().then(setHealth);
    void fetchGeo().then(setGeo);
    void oneClick
      .tokens()
      .then((ts) => {
        const p = (id: string) => ts.find((t) => t.assetId === id)?.price;
        setPrices({ zec: p(ASSET.zec), sol: p(ASSET.sol), usdc: p(ASSET.solanaUsdc) });
      })
      .catch(() => {});
    const t = setInterval(() => void fetchHealth().then(setHealth), 60_000);
    return () => clearInterval(t);
  }, [reloadWallet, reloadMoves]);

  useEffect(() => {
    if (!owner) return;
    void refreshBalances();
    void exitMinimum(owner).then(setMinimum);
  }, [owner, refreshBalances]);

  const value = useMemo<AppState>(
    () => ({
      provider,
      owner,
      connect,
      disconnect,
      balances,
      balanceError,
      refreshBalances,
      minimum,
      wallet,
      reloadWallet,
      moves,
      reloadMoves,
      health,
      geo,
      prices,
      draft,
      setDraft,
      seed,
    }),
    [provider, owner, connect, disconnect, balances, balanceError, refreshBalances, minimum, wallet, reloadWallet, moves, reloadMoves, health, geo, prices, draft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
