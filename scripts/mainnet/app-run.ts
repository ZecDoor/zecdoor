// Drives the real ZecDoor app through one move on mainnet, recording what a user sees (blocks B1/B7).
//
// The app is a LOCAL build with moves open (VITE_MOVES_OPEN=1), served by `wrangler dev`; it is never deployed
// (scripts/deploy.sh refuses a build with open moves). Phantom is replaced by a local keypair signer which, before
// it signs, independently re-checks the transaction against the instruction allowlist (the quote's deposit
// address and amount, and for a top-up the Jupiter quote's maximum input) and the USD 10 budget ledger.
//
// USAGE (from the repo root, after building the site with VITE_MOVES_OPEN=1 and starting `wrangler dev`)
//   pnpm exec tsx scripts/mainnet/app-run.ts topup   --keypair ../.secrets/topup-test-wallet.json --out <dir> --i-approve
//   pnpm exec tsx scripts/mainnet/app-run.ts exit    --keypair … --out <dir> --dest <u1…> --i-approve
//   pnpm exec tsx scripts/mainnet/app-run.ts buyUsdc --keypair … --amount 1.9 --out <dir> --dest <u1…> --i-approve
// Without --dest, the move goes to a NEW wallet made in the app; its 24 words and birthday are written to
// ../.secrets/<run>-wallet.json (never into the repo) for the restore test, and blurred in the recording.

import { AddressLookupTableAccount, Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { checkTransaction, type MoveKind, type QuoteResponse } from '@zecdoor/solana';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '../../apps/app/node_modules/@playwright/test/index.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SECRETS = path.resolve(ROOT, '../.secrets');
const LEDGER = path.join(SECRETS, 'mainnet-ledger.json');
const BUDGET_USD = 10;
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const ZEC_MINT = 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const argv = process.argv.slice(2);
const kind = argv[0] as MoveKind;
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (k: string) => argv.includes(`--${k}`);
if (!['exit', 'topup', 'buyUsdc', 'buySol'].includes(kind)) throw new Error('kind: exit | topup | buyUsdc | buySol');
const OUT = path.resolve(opt('out') ?? path.join(ROOT, '../build-plan/mainnet-test/live', `${kind}-${Date.now()}`));
const URL = opt('url') ?? 'https://127.0.0.1:8788/app/'; // wrangler dev --local-protocol https
const APPROVE = flag('i-approve');
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(opt('keypair')!), 'utf8'))));
const owner = kp.publicKey.toBase58();
const conn = new Connection(RPC, 'confirmed');
fs.mkdirSync(OUT, { recursive: true });

const events: Array<{ t: string; k: string; v?: unknown }> = [];
const log = (k: string, v?: unknown) => {
  events.push({ t: new Date().toISOString(), k, v });
  console.log(new Date().toISOString(), k, v === undefined ? '' : JSON.stringify(v));
  fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify({ kind, owner, events }, null, 2));
};

interface LedgerEntry { at: string; kind: string; depositAddress?: string; usdIn: number; signature?: string; note?: string }
const ledger = (): LedgerEntry[] => (fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : []);
const spent = () => ledger().reduce((s, e) => s + e.usdIn, 0);
async function prices() {
  const r = (await (await fetch(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT},${ZEC_MINT}`)).json()) as Record<string, { usdPrice: number }>;
  return { sol: r[SOL_MINT]!.usdPrice, zec: r[ZEC_MINT]!.usdPrice };
}

// What the app asked for, read from its own network traffic.
let lastQuote: QuoteResponse | null = null;
let jupMaxIn: bigint | undefined;

async function signAndSend(b64: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
  if (!lastQuote || lastQuote.quoteRequest.dry) throw new Error('no real quote seen: refusing to sign');
  const dep = lastQuote.quote.depositAddress!;
  const lookupTables: AddressLookupTableAccount[] = [];
  for (const l of tx.message.addressTableLookups) {
    const a = (await conn.getAddressLookupTable(l.accountKey)).value;
    if (a) lookupTables.push(a);
  }
  const check = checkTransaction(tx, {
    kind,
    owner: kp.publicKey,
    depositAddress: new PublicKey(dep),
    amountIn: BigInt(lastQuote.quote.amountIn),
    lookupTables,
    ...(jupMaxIn !== undefined ? { maxWrapLamports: jupMaxIn } : {}),
  });
  log('allowlist.recheck', { violations: check.violations, bytes: tx.serialize().length });
  if (check.violations.length) throw new Error('allowlist violations: refusing to sign');
  const p = await prices();
  const usdIn =
    kind === 'buyUsdc' ? Number(lastQuote.quote.amountIn) / 1e6
    : kind === 'buySol' ? (Number(lastQuote.quote.amountIn) / 1e9) * p.sol
    : (Number(lastQuote.quote.amountIn) / 1e8) * p.zec;
  log('budget', { spentUsd: spent(), thisUsd: usdIn, budget: BUDGET_USD });
  if (spent() + usdIn > BUDGET_USD) throw new Error('budget: refusing to sign');
  if (!APPROVE) throw new Error('dry run: pass --i-approve to sign and send');
  tx.sign([kp]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
  log('sent', { signature: sig, depositAddress: dep, usdIn });
  fs.writeFileSync(LEDGER, JSON.stringify([...ledger(), { at: new Date().toISOString(), kind, depositAddress: dep, usdIn, signature: sig, note: 'app-run' }], null, 2));
  return sig;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
    recordVideo: { dir: OUT, size: { width: 780, height: 1688 } },
  });
  await ctx.exposeFunction('__zdSign', async (b64: string) => signAndSend(b64));
  // Passed as plain JavaScript text: functions compiled by tsx carry helpers the page does not have.
  await ctx.addInitScript(`(() => {
    const pk = ${JSON.stringify(owner)};
    const key = { toString: () => pk, toBase58: () => pk };
    let connected = false;
    window.phantom = {
      solana: {
        isPhantom: true,
        get publicKey() { return connected ? key : null; },
        get isConnected() { return connected; },
        connect: async () => { connected = true; return { publicKey: key }; },
        disconnect: async () => { connected = false; },
        signAndSendTransaction: async (tx) => {
          const bytes = tx.serialize();
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          const signature = await window.__zdSign(btoa(s));
          return { signature };
        },
        on() {}, off() {}, removeListener() {},
      },
    };
    // The recovery words are read by this script but never shown in the recording: blur each word as it
    // appears (an inline style attribute, which the app's CSP allows; a stylesheet would be refused).
    new MutationObserver(() => {
      document.querySelectorAll('ol.words li').forEach((li) => { li.style.filter = 'blur(7px)'; });
    }).observe(document, { childList: true, subtree: true });
  })();`);
  const page = await ctx.newPage();
  pageRef = page;
  page.on('response', async (r) => {
    try {
      if (r.url().includes('/v0/quote') && r.request().method() === 'POST') {
        const j = (await r.json()) as QuoteResponse;
        if (j?.quote) { lastQuote = j; log('quote', { dry: j.quoteRequest?.dry, deposit: j.quote.depositAddress, amountIn: j.quote.amountIn, minOut: j.quote.minAmountOut }); }
      }
      if (r.url().includes('lite-api.jup.ag') && r.url().includes('/quote')) {
        const j = (await r.json()) as { otherAmountThreshold?: string; swapMode?: string };
        if (j?.swapMode === 'ExactOut' && j.otherAmountThreshold) jupMaxIn = BigInt(j.otherAmountThreshold);
      }
    } catch {}
  });
  page.on('console', (m) => m.type() === 'error' && log('console.error', m.text().slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 400) log('http.' + r.status(), r.url().slice(0, 160)); });
  let shot = 0;
  const snap = async (name: string) => page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
  await page.goto(URL);
  await page.waitForTimeout(3000);
  const connectBtn = page.getByRole('button', { name: /^(Connect|Open in Phantom)/ }).first();
  if (await connectBtn.isVisible().catch(() => false)) {
    await snap('connect');
    await connectBtn.click();
  }
  await page.getByText('ZEC on Solana').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await snap('home');

  if (kind === 'topup') {
    await page.getByRole('button', { name: /Top up and shield/ }).click();
    await page.getByText('Your one signature does both').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await snap('topup');
    await page.getByRole('button', { name: 'Review' }).click();
  } else if (kind === 'exit') {
    await page.getByRole('button', { name: /Move it to shielded|Move / }).first().click();
  } else {
    await page.goto(URL + '#/buy');
    if (kind === 'buySol') await page.getByRole('button', { name: 'SOL', exact: true }).click();
    await page.getByLabel('You pay').fill(opt('amount') ?? '1.9');
    await page.waitForTimeout(3000);
    await snap('buy');
    await page.getByRole('button', { name: 'Choose where it lands' }).click();
  }

  const dest = opt('dest');
  if (dest) {
    await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
    await page.getByLabel('Zcash address').fill(dest);
    await snap('destination');
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    if (kind !== 'topup') await page.getByRole('button', { name: /Create one here/ }).click().catch(() => {});
    await page.getByRole('heading', { name: 'Your new shielded wallet' }).waitFor({ timeout: 60_000 });
    await snap('wallet-new');
    await page.getByRole('button', { name: /Tap to show/ }).click();
    const words = (await page.locator('ol.words li').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, '').trim());
    const body = await page.locator('body').innerText();
    const birthday = Number((body.match(/Birthday Height[\s\S]{0,40}?([\d,]{7,})/)?.[1] ?? '').replace(/,/g, ''));
    if (words.length !== 24 || !birthday) throw new Error('could not read the new wallet');
    const secretFile = path.join(SECRETS, `${path.basename(OUT)}-wallet.json`);
    fs.writeFileSync(secretFile, JSON.stringify({ words, birthday, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    log('wallet', { birthday, secretFile });
    await snap('wallet-words-blurred');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Check my backup' }).click();
    await page.locator('fieldset').nth(2).waitFor({ timeout: 30_000 });
    for (const fsel of await page.locator('fieldset').all()) {
      const n = Number((await fsel.locator('legend').innerText()).replace(/\D/g, ''));
      await fsel.getByRole('button', { name: words[n - 1]!, exact: true }).click();
    }
    await snap('wallet-checked');
    await page.getByRole('button', { name: 'Continue to review' }).click();
  }

  await page.getByText('Signed by NEAR Intents · checked').waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await snap('review');
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await page.getByText(/^Moving /).waitFor({ timeout: 120_000 });
  await snap('progress-start');
  const t0 = Date.now();
  let i = 0;
  // Follow the move until the proof (or a refund/failure) shows; screenshot each new state.
  let last = '';
  for (;;) {
    const text = await page.locator('main').innerText().catch(() => '');
    const state = /Note found by your browser|Check it in your wallet/.test(text) ? 'proof' : /Refunded|Not moved/.test(text) ? 'refunded' : /did not complete|failed/i.test(text) ? 'failed' : /longer than usual/.test(text) ? 'slow' : 'moving';
    if (state !== last) { last = state; log('state', state); await snap(`state-${state}-${++i}`); }
    if (['proof', 'refunded', 'failed'].includes(state)) break;
    if (Date.now() - t0 > 45 * 60_000) { log('timeout'); break; }
    await page.waitForTimeout(15_000);
    if ((Date.now() - t0) % (60_000 * 3) < 15_000) await snap(`progress-${Math.round((Date.now() - t0) / 60_000)}min`);
  }
  await page.waitForTimeout(3000);
  await snap('final');
  if (last === 'proof') {
    await page.getByRole('button', { name: 'What to do next' }).click().catch(() => {});
    await page.waitForTimeout(1500);
    await snap('after');
  }
  log('done', { elapsedMin: (Date.now() - t0) / 60_000, deposit: lastQuote?.quote.depositAddress });
  await ctx.close();
  await browser.close();
}

let pageRef: import('playwright-core').Page | null = null;
main().catch(async (e) => {
  log('ERROR', String(e?.message ?? e));
  await pageRef?.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => {});
  process.exit(1);
});
