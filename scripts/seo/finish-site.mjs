#!/usr/bin/env node
// Last step of build-site.sh. For every page in dist/site: a canonical link and share tags (Open Graph, Twitter) built
// from the page's own <title> and description, with its share image from deploy/site/og/. Then the designed 404 page
// (at / and /docs/), sitemap.xml, and the Sitemap line in robots.txt. Preview builds get no sitemap.
//
//   node scripts/seo/finish-site.mjs <dist/site> <domain> [--preview]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [out, domain] = process.argv.slice(2);
const preview = process.argv.includes('--preview');
if (!out || !domain) throw new Error('usage: finish-site.mjs <dist/site> <domain> [--preview]');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SITE = path.join(ROOT, 'deploy/site');
const ORIGIN = `https://${domain}`;

// Pages: every .html except error pages and Next's internal not-found page.
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
  return found.sort();
}

// "docs/fees.html" -> "/docs/fees"; "docs/index.html" -> "/docs"; "index.html" -> "/"; "app/index.html" -> "/app/".
function urlPath(rel) {
  if (rel === 'index.html') return '/';
  if (rel === 'app/index.html') return '/app/';
  return '/' + rel.replace(/\/index\.html$/, '').replace(/\.html$/, '');
}

// "/" -> "home"; "/app/" -> "app"; "/docs/legal/terms" -> "docs-legal-terms".
function slug(p) {
  return p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/\//g, '-');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const unesc = (s) =>
  s.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const ogDir = path.join(SITE, 'og');
const images = new Set(fs.existsSync(ogDir) ? fs.readdirSync(ogDir) : []);
const missing = [];
const listed = [];

for (const file of pages(out)) {
  const rel = path.relative(out, file).split(path.sep).join('/');
  let html = fs.readFileSync(file, 'utf8');
  if (/<meta[^>]+name="robots"[^>]+noindex/.test(html) && !preview) continue;
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => unesc(m[1]));
  const title = titles.at(-1);
  const description = unesc(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '');
  if (!title || !description) throw new Error(`${rel}: no title or description`);
  const p = urlPath(rel);
  const url = ORIGIN + p;
  let image = `${slug(p)}.png`;
  if (!images.has(image)) {
    missing.push(rel);
    image = 'home.png';
  }
  const tags = [
    `<link rel="canonical" href="${url}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:site_name" content="ZecDoor"/>`,
    `<meta property="og:url" content="${url}"/>`,
    `<meta property="og:title" content="${esc(title)}"/>`,
    `<meta property="og:description" content="${esc(description)}"/>`,
    `<meta property="og:image" content="${ORIGIN}/og/${image}"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta property="og:image:alt" content="${esc(title)}"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${esc(title)}"/>`,
    `<meta name="twitter:description" content="${esc(description)}"/>`,
    `<meta name="twitter:image" content="${ORIGIN}/og/${image}"/>`,
  ].filter((t) => !html.includes(t.match(/(?:property|name|rel)="[^"]+"/)[0])); // keep any tag the page already has
  html = html.replace('</head>', tags.join('') + '</head>');
  fs.writeFileSync(file, html);
  listed.push(url);
}

// Share images, fonts and the 404 page (also under /docs/, where Cloudflare looks first for docs paths).
fs.cpSync(ogDir, path.join(out, 'og'), { recursive: true });
fs.cpSync(path.join(SITE, 'fonts'), path.join(out, 'fonts'), { recursive: true });
fs.copyFileSync(path.join(SITE, '404.css'), path.join(out, '404.css'));
const notFound = fs.readFileSync(path.join(SITE, '404.html'), 'utf8').replaceAll('[DOMAIN]', domain);
for (const f of ['404.html', 'docs/404.html', 'app/404.html']) fs.writeFileSync(path.join(out, f), notFound);
for (const f of ['_not-found.html', '_not-found.txt', 'docs/_not-found.html', 'docs/_not-found.txt']) fs.rmSync(path.join(out, f), { force: true });

if (!preview) {
  const lines = listed.map((u) => `  <url><loc>${u}</loc></url>`);
  fs.writeFileSync(
    path.join(out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`,
  );
  const robots = path.join(out, 'robots.txt');
  fs.appendFileSync(robots, `\nSitemap: ${ORIGIN}/sitemap.xml\n`);
}

if (missing.length) console.warn(`No share image for ${missing.join(', ')}; using home.png. Run scripts/seo/og-images.mjs.`);
console.log(`Share tags on ${listed.length} pages${preview ? '' : `; sitemap.xml lists ${listed.length} URLs`}; 404 page installed.`);
