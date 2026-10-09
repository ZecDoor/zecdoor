#!/usr/bin/env node
// Renders the 1200×630 share image for every page of a built site into deploy/site/og/<slug>.png, from the page's own
// title and description. Run after a build whenever a page is added or retitled; the images are committed so the
// site build itself needs no browser.
//
//   node scripts/seo/og-images.mjs dist/site

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(ROOT, 'apps/app/package.json'))('@playwright/test');
const out = process.argv[2];
if (!out) throw new Error('usage: og-images.mjs <dist/site>');
const DEST = path.join(ROOT, 'deploy/site/og');
const DOMAIN = 'zecdoor.0xo.in';

const font = (f) => fs.readFileSync(path.join(ROOT, 'deploy/site/fonts', f)).toString('base64');
const unesc = (s) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function pages(dir) {
  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!['_next', '_not-found', 'og', 'fonts', 'demo', 'assets'].includes(e.name)) walk(p);
      } else if (e.name.endsWith('.html') && e.name !== '404.html' && e.name !== '_not-found.html') found.push(p);
    }
  };
  walk(dir);
  return found;
}

function card({ label, title, description }) {
  return `<!doctype html><html><head><style>
@font-face{font-family:M;src:url(data:font/woff2;base64,${font('manrope-latin-wght.woff2')});font-weight:200 800}
@font-face{font-family:J;src:url(data:font/woff2;base64,${font('jetbrains-mono-latin-400.woff2')})}
*{box-sizing:border-box}html,body{margin:0}
body{width:1200px;height:630px;background:#f6f4ee;color:#17160f;font-family:M;display:flex;flex-direction:column;padding:64px 72px;-webkit-font-smoothing:antialiased}
.top{display:flex;align-items:center;gap:14px;font-weight:700;font-size:30px;letter-spacing:-.01em}
.label{margin-left:auto;font-family:J;font-size:20px;color:#8a5a00;letter-spacing:.06em}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center}
h1{margin:0;font-size:${title.length > 34 ? 60 : 72}px;line-height:1.08;letter-spacing:-.025em;font-weight:750;max-width:1000px}
p{margin:24px 0 0;font-size:28px;line-height:1.45;color:#5c5950;max-width:980px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.foot{display:flex;justify-content:space-between;align-items:center;padding-top:24px;border-top:1px solid #dedacf;font-size:21px;color:#5c5950}
.foot .d{font-family:J;color:#17160f}
</style></head><body>
<div class="top"><svg width="40" height="40" viewBox="0 0 28 28" fill="none"><path d="M5 13 14 5.5l9 7.5V22.5H5V13Z" stroke="#e5a42a" stroke-width="2.2" stroke-linejoin="round"/><path d="M9.5 18h9" stroke="#17160f" stroke-width="2.2" stroke-linecap="round"/></svg>ZecDoor<span class="label">${label}</span></div>
<div class="mid"><h1>${esc(title)}</h1><p>${esc(description)}</p></div>
<div class="foot"><span class="d">${DOMAIN}</span><span>Open source (MIT) · no token</span></div>
</body></html>`;
}

fs.mkdirSync(DEST, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
let n = 0;
for (const file of pages(out)) {
  const rel = path.relative(out, file).split(path.sep).join('/');
  const html = fs.readFileSync(file, 'utf8');
  if (/<meta[^>]+name="robots"[^>]+noindex/.test(html)) continue;
  const p = rel === 'index.html' ? '/' : rel === 'app/index.html' ? '/app/' : '/' + rel.replace(/\/index\.html$/, '').replace(/\.html$/, '');
  const slug = p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/\//g, '-');
  const title = unesc([...html.matchAll(/<title>([^<]*)<\/title>/g)].at(-1)[1]);
  const description = unesc(html.match(/<meta name="description" content="([^"]*)"/)[1]);
  const c =
    p === '/'
      ? { label: '', title: 'Bring your ZEC home.', description: 'The ZEC you hold on Solana, into a shielded Zcash wallet you control. One signature in Phantom.' }
      : p === '/app/'
        ? { label: 'APP', title: 'Move your Solana ZEC into a shielded wallet.', description }
        : { label: 'DOCS', title: title.replace(/ · ZecDoor Docs$/, ''), description };
  await page.setContent(card(c), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(DEST, `${slug}.png`) });
  n++;
}
await browser.close();
console.log(`${n} share images in ${path.relative(ROOT, DEST)}`);
