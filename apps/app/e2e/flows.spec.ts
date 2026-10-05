import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { AddressLookupTableAccount, PublicKey } from '@solana/web3.js';
import { checkTransaction, JUPITER_PROGRAM, type MoveKind, type QuoteResponse } from '@zecdoor/solana';
import fs from 'node:fs';
import path from 'node:path';
import { decodeSigned, mock, OWNER, status, TEST_UA, type Mocks } from './mock';

const SLOW = { timeout: 25_000 };

function tables(): AddressLookupTableAccount[] {
  const dir = path.join(import.meta.dirname, 'fixtures');
  return ['NAQxBNqDYMASwX8FgXj56AZBSz2yvyCSKSjKFGupNjJ', '6PV6cFpiGrQbJbAEhyLkDMtHgJbaEZbgrwGJdXWwWFtZ'].map((k) => {
    const v = JSON.parse(fs.readFileSync(path.join(dir, `alt_${k}.json`), 'utf8'));
    return new AddressLookupTableAccount({ key: new PublicKey(k), state: AddressLookupTableAccount.deserialize(Buffer.from(v.data[0], 'base64')) });
  });
}

/** Re-checks, from outside the page, that what Phantom was asked to sign passes the allowlist. */
async function expectAllowed(m: Mocks, kind: MoveKind, extra: { maxWrapLamports?: bigint } = {}) {
  const signed = await m.signed();
  expect(signed).toHaveLength(1);
  const q = m.quotes.at(-1) as QuoteResponse;
  const tx = decodeSigned(signed[0]!);
  const r = checkTransaction(tx, {
    kind,
    owner: new PublicKey(OWNER),
    depositAddress: new PublicKey(q.quote.depositAddress!),
    amountIn: BigInt(q.quote.amountIn),
    lookupTables: kind === 'topup' ? tables() : [],
    ...extra,
  });
  expect(r.violations).toEqual([]);
  return tx;
}

async function makeWallet(page: Page) {
  await expect(page.getByRole('heading', { name: 'Your new shielded wallet' })).toBeVisible();
  await page.getByRole('button', { name: /Tap to show/ }).click();
  const words = (await page.locator('ol.words li').allInnerTexts()).map((t) => t.replace(/^\d+\s*/, '').trim());
  expect(words).toHaveLength(24);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Check my backup' }).click();
  await expect(page.locator('fieldset')).toHaveCount(3);
  for (const fs of await page.locator('fieldset').all()) {
    const n = Number((await fs.locator('legend').innerText()).replace(/\D/g, ''));
    await fs.getByRole('button', { name: words[n - 1]!, exact: true }).click();
  }
  await expect(page.getByText('Backup checked. Your wallet is ready to receive.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to review' }).click();
  return words;
}

test.describe('connect', () => {
  test('connects when the user approves in Phantom', async ({ page }) => {
    await mock(page, { trusted: false });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Bring your ZEC home.' })).toBeVisible();
    await page.getByRole('button', { name: 'Connect Phantom' }).click();
    await expect(page.getByText('0.0874 ZEC').first()).toBeVisible();
  });

  test('outside Phantom it offers the Phantom deeplink', async ({ page }) => {
    await mock(page, { phantom: false });
    await page.goto('./');
    const link = page.getByRole('link', { name: /Open (this page )?in Phantom/ }).first();
    await expect(link).toHaveAttribute('href', /^https:\/\/phantom\.com\/ul\/browse\/http/);
  });
});

test('exit into a new wallet made here: backup, sign, progress, proof, after', async ({ page }) => {
  const m = await mock(page, { statuses: [status.pending(), status.processing(), status.processing(), status.success()] });
  await page.goto('./');
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await makeWallet(page);

  await expect(page.getByText('Signed by NEAR Intents · checked')).toBeVisible();
  await expect(page.getByText('new address in this browser')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();

  await expect(page.getByText(/^Moving /)).toBeVisible();
  await expect(page.getByText('NEAR Intents saw your deposit')).toBeVisible(SLOW);
  await expect(page.getByText('Note found by your browser')).toBeVisible(SLOW);
  await expectAllowed(m, 'exit');
  await expect(page.getByText(/^Arrived · /)).toBeVisible();
  expect(m.counted).toEqual([{ depositAddress: m.quotes[0]!.quote.depositAddress, kind: 'exit', firstWallet: true }]);

  await page.getByRole('button', { name: 'What to do next' }).click();
  await expect(page.getByText('Open your wallet in Zodl or Zkool')).toBeVisible();
  await expect(page.getByText('3,509,990')).toBeVisible(); // birthday = tip − 10

  // The 24 words are not stored anywhere in the browser.
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => {
      const q = indexedDB.open('zecdoor');
      q.onsuccess = () => r(q.result);
    });
    const all = await new Promise<unknown[]>((r) => {
      const q = db.transaction('kv').objectStore('kv').getAll();
      q.onsuccess = () => r(q.result);
    });
    return JSON.stringify(all) + JSON.stringify(localStorage) + JSON.stringify(sessionStorage);
  });
  expect(stored).toContain('uview'); // the viewing key
  expect(stored.split(/\W+/).filter((w) => /^[a-z]{3,8}$/.test(w)).length).toBeLessThan(24);
});

test.describe('moves closed (production until the mainnet test runs pass)', () => {
  test('wallet backup and a live quote work, but nothing can be signed', async ({ page }) => {
    const m = await mock(page, { movesClosed: true });
    await page.goto('./');
    await expect(page.getByText('Opening soon').first()).toBeVisible();
    await page.getByRole('button', { name: /Move it to shielded/ }).click();
    await makeWallet(page);
    await expect(page.getByText('Signed by NEAR Intents · checked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Opening soon' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign in Phantom' })).toHaveCount(0);
    expect(await m.signed()).toHaveLength(0);
    // Only dry quotes (no deposit address) were ever requested.
    expect(m.quotes.every((q) => (q as QuoteResponse).quoteRequest.dry === true)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('buying shows the quote and the opening-soon state', async ({ page }) => {
    const m = await mock(page, { zec: 0n, movesClosed: true });
    await page.goto('./#/buy');
    await page.getByLabel('You pay').fill('25');
    await page.getByRole('button', { name: 'Choose where it lands' }).click();
    await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
    await page.getByLabel('Zcash address').fill(TEST_UA);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.amount', { hasText: '25.00 USDC' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Opening soon' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign in Phantom' })).toHaveCount(0);
    expect(await m.signed()).toHaveLength(0);
  });
});

test('second move from the same browser wallet uses the next address', async ({ page }) => {
  await mock(page);
  await page.goto('./');
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await makeWallet(page);
  const first = await page.locator('dl.rows dd').first().innerText();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Note found by your browser')).toBeVisible(SLOW);
  await page.goto('./#/');
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByText('Signed by NEAR Intents · checked')).toBeVisible();
  const second = await page.locator('dl.rows dd').first().innerText();
  expect(second).not.toEqual(first);
});

test('exit to a pasted address: validation, review, proof without a viewing key', async ({ page }) => {
  const m = await mock(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  const input = page.getByLabel('Zcash address');
  await input.fill('t1J5WT7CwfJy7WJaMkYweYT2JUnSebbVRz4');
  await expect(page.getByText(/Transparent address \(t1…\): not private/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await input.fill('u1notanaddress');
  await expect(page.getByText(/This is not a Zcash address/)).toBeVisible();
  await input.fill(TEST_UA);
  await expect(page.getByText('Shielded address · can receive in Ironwood')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/My wallet · u1c5…/)).toBeVisible();

  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByText(/your wallet$/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible(SLOW);
  await expectAllowed(m, 'exit');
  expect(m.quotes[0]!.quoteRequest.recipient).toBe(TEST_UA);
  expect(m.quotes[0]!.quoteRequest.refundTo).toBe(OWNER);

  // Reusing the same address is flagged.
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await expect(page.getByText(/You used this address before on this device/)).toBeVisible();
});

test('top-up and shield a balance below the minimum, in one transaction', async ({ page }) => {
  const m = await mock(page, { zec: 37_814n });
  await page.goto('./');
  await expect(page.getByText(/Below the bridge minimum of 0\.00133669 ZEC/)).toBeVisible();
  await page.getByRole('button', { name: /Top up and shield/ }).click();
  await expect(page.getByText('Your one signature does both')).toBeVisible();
  await expect(page.getByText(/Send all 0\.00133669 ZEC/)).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).click();
  await makeWallet(page);
  await expect(page.getByText(/swapped into ZEC/)).toBeVisible();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Note found by your browser')).toBeVisible(SLOW);
  const tx = await expectAllowed(m, 'topup', { maxWrapLamports: 11_177_144n });
  expect(tx.message.staticAccountKeys.concat(tables().flatMap((t) => t.state.addresses)).some((k) => k.equals(JUPITER_PROGRAM))).toBe(true);
});

test('buy shielded ZEC with USDC', async ({ page }) => {
  const m = await mock(page, { zec: 0n });
  await page.goto('./');
  await page.getByRole('button', { name: /Buy shielded ZEC/ }).first().click();
  await page.getByLabel('You pay').fill('25');
  await expect(page.getByText('NEAR Intents fee')).toBeVisible();
  await expect(page.locator('dl.rows')).toContainText('0.25%');
  await page.getByRole('button', { name: 'Choose where it lands' }).click();
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.amount', { hasText: '25.00 USDC' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible(SLOW);
  await expectAllowed(m, 'buyUsdc');
});

test('buy shielded ZEC with SOL', async ({ page }) => {
  const m = await mock(page, { zec: 0n });
  await page.goto('./#/buy');
  await page.getByRole('button', { name: 'SOL', exact: true }).click();
  await page.getByLabel('You pay').fill('0.2');
  await expect(page.getByText(/^1 ZEC ≈/)).toBeVisible();
  await page.getByRole('button', { name: 'Choose where it lands' }).click();
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Check it in your wallet')).toBeVisible(SLOW);
  await expectAllowed(m, 'buySol');
});

test('buy below the minimum order says so', async ({ page }) => {
  await mock(page);
  await page.goto('./#/buy');
  await page.getByLabel('You pay').fill('1');
  await expect(page.getByText('The smallest order now is 1.78 USDC.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose where it lands' })).toBeDisabled();
});

test('refund: shows the reason and that the funds are back', async ({ page }) => {
  await mock(page, { statuses: [status.refunded()] });
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByRole('heading', { name: 'Refunded' })).toBeVisible(SLOW);
  await expect(page.getByText('The price moved past the quote’s limit')).toBeVisible();
  await expect(page.getByText('is back in your Phantom wallet on Solana')).toBeVisible();
});

test('cancelling in Phantom sends nothing and keeps no record', async ({ page }) => {
  await mock(page, { reject: true });
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('You cancelled in Phantom. Nothing was sent.')).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByText('None yet')).toBeVisible();
});

test('the bridge is paused: no moves offered', async ({ page }) => {
  await mock(page, { health: { ok: false, paused: true, message: 'NEAR Intents reports an incident.' } });
  await page.goto('./');
  await expect(page.getByText('The bridge is paused')).toBeVisible();
  await expect(page.getByRole('button', { name: /Move it to shielded/ })).toBeDisabled();
});

test('a failed fee self-test pauses that kind of move', async ({ page }) => {
  await mock(page, { health: { ok: true, paused: false, fees: { exit: true, buyUsdc: false, buySol: true } } as never });
  await page.goto('./#/buy');
  await page.getByLabel('You pay').fill('25');
  await expect(page.getByText('NEAR Intents fee')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose where it lands' })).toBeDisabled();
  await page.getByRole('button', { name: 'SOL', exact: true }).click();
  await page.getByLabel('You pay').fill('0.2');
  await expect(page.getByRole('button', { name: 'Choose where it lands' })).toBeEnabled();
});

test('not available in the region', async ({ page }) => {
  await mock(page, { geo: { allowed: false, topup: false, country: 'IR' } });
  await page.goto('./');
  await expect(page.getByText('Not available in your region')).toBeVisible();
  await expect(page.getByRole('button', { name: /Move it to shielded/ })).toBeDisabled();
});

test('top-up not offered where Jupiter is restricted (D6)', async ({ page }) => {
  await mock(page, { zec: 37_814n, geo: { allowed: true, topup: false, country: 'US' } });
  await page.goto('./');
  await expect(page.getByText(/Top-up is not offered where you are/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Top up and shield/ })).toBeDisabled();
});

test('not enough SOL for fees blocks signing', async ({ page }) => {
  await mock(page, { sol: 1_000_000n });
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByText('Not enough SOL for fees')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in Phantom' })).toBeDisabled();
});

test('a quote left open expires and can be renewed', async ({ page }) => {
  await page.clock.install();
  await mock(page);
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await expect(page.getByText(/^Quote valid /)).toBeVisible();
  await page.clock.fastForward('10:05');
  await expect(page.getByText('Quote expired')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in Phantom' })).toBeDisabled();
  await page.getByRole('button', { name: 'Get a new quote' }).click();
  await expect(page.getByText(/^Quote valid /)).toBeVisible();
});

test('a slow bridge shows "taking longer than usual"', async ({ page }) => {
  await page.clock.install();
  await mock(page, { statuses: [status.processing()] });
  await page.goto('./#/destination');
  await page.getByRole('button', { name: /Use my Zcash wallet/ }).click();
  await page.getByLabel('Zcash address').fill(TEST_UA);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Move it to shielded/ }).click();
  await page.getByRole('button', { name: 'Sign in Phantom' }).click();
  await expect(page.getByText('Received by the bridge')).toBeVisible();
  await page.clock.fastForward('11:00');
  await expect(page.getByText('Taking longer than usual')).toBeVisible(SLOW);
});

test('counter: placeholders until there are real moves', async ({ page }) => {
  await mock(page);
  await page.goto('./#/counter');
  await expect(page.getByText('Fills in from launch day. No numbers until there are real ones.')).toBeVisible();
  await expect(page.locator('.stats .v').first()).toHaveText('—');
});

test.describe('accessibility', () => {
  for (const [name, url] of [
    ['home', './'],
    ['buy', './#/buy'],
    ['destination', './#/destination'],
    ['counter', './#/counter'],
  ] as const) {
    test(`no axe violations: ${name}`, async ({ page }) => {
      await mock(page);
      await page.goto(url);
      await page.waitForTimeout(800);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ') + ' ' + n.failureSummary).join(' | ')}`)).toEqual([]);
    });
  }
});
