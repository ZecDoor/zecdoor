// The public proof page: three live checks against NEAR Intents, a Solana RPC and lightwalletd, with
// B1's real NEAR Intents record (its real signature). Offline: every source is answered here.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { encodeVarint, frame } from '@zecdoor/zcash';
import fs from 'node:fs';
import path from 'node:path';
import { mock } from './mock';

const B1_STATUS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../src/lib/fixtures/status-success-b1.json'), 'utf8'));
const DEP = '6HVDicNC2ureqoJHHyJ6PmRjE82pTAiJhPZVNQTWdTbe';
const ZEC = 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS';

async function sources(page: Page, o: { history?: boolean; height?: number; tamper?: boolean } = {}) {
  await mock(page, { trusted: false });
  const status = structuredClone(B1_STATUS);
  if (o.tamper) status.quoteResponse.quote.minAmountOut = '200000';
  await page.route(`https://1click.chaindefuser.com/v0/status?depositAddress=${DEP}`, (r) => r.fulfill({ json: status }));
  const rpc = async (route: import('@playwright/test').Route) => {
    const body = route.request().postDataJSON() as { id: number; method: string };
    if (body.method !== 'getTransaction') return route.fallback();
    // The first endpoint keeps no history, as on mainnet; the second has it.
    const hasHistory = o.history !== false && route.request().url().includes('solanavibestation');
    const bal = (amount: string) => ({ mint: ZEC, owner: DEP, uiTokenAmount: { amount } });
    return route.fulfill({
      json: { jsonrpc: '2.0', id: body.id, result: hasHistory ? { blockTime: 1791230624, meta: { err: null, preTokenBalances: [], postTokenBalances: [bal('133669')] } } : null },
    });
  };
  await page.route('https://rpc.solanatracker.io/**', rpc);
  await page.route('https://public.rpc.solanavibestation.com/**', rpc);
  await page.route('https://zjs.zec.rocks/**', (r) => {
    const msg = new Uint8Array([0x0a, 2, 5, 0, 0x10, ...encodeVarint(o.height ?? 3_507_539)]);
    const trailer = new TextEncoder().encode('grpc-status:0\r\ngrpc-message:\r\n');
    const t = frame(trailer);
    t[0] = 0x80;
    return r.fulfill({ status: 200, headers: { 'content-type': 'application/grpc-web+proto' }, body: Buffer.concat([frame(msg), t]) });
  });
}

test('three live checks pass on B1’s real record, with the test-key label', async ({ page }) => {
  await sources(page);
  await page.goto('./#/proof');
  await expect(page.getByText('Signed by our test key, standing in for Phantom', { exact: false })).toBeVisible();
  await expect(page.getByText('Its signature on the quote is valid', { exact: false })).toBeVisible();
  await expect(page.getByText('The deposit address received 0.00133669 ZEC, as quoted.', { exact: false })).toBeVisible();
  await expect(page.getByText('lightwalletd has it in block 3,507,539', { exact: false })).toBeVisible();
  await expect(page.getByText('Note found with the viewing key · recorded')).toBeVisible();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test('an altered quote fails the signature check', async ({ page }) => {
  await sources(page, { tamper: true });
  await page.goto('./#/proof');
  await expect(page.getByText('signature not valid', { exact: false })).toBeVisible();
});

test('a wrong block fails the Zcash check', async ({ page }) => {
  await sources(page, { height: 3_507_540 });
  await page.goto('./#/proof');
  await expect(page.getByText('Found in block 3,507,540', { exact: false })).toBeVisible();
});

test('no RPC with history: says so, and offers to check again', async ({ page }) => {
  await sources(page, { history: false });
  await page.goto('./#/proof');
  await expect(page.getByText('No public Solana RPC returned this transaction.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Check again' }).first()).toBeVisible();
});
