// Agendas ministériels publiés derrière une protection anti-robots (Cloudflare) : lus avec un vrai navigateur.
// Ce sont des informations publiques, destinées à tous ; le script les consulte comme un visiteur, à faible cadence.
// Il tourne sur un poste avec écran (la protection refuse les navigateurs sans interface), puis dépose le résultat
// sur R2 (og.parlementeur.fr/donnees/agendas-navigateur.json), où le pipeline le récupère.
// Lancement : pnpm exec tsx scripts/agendas-navigateur.ts  (variables CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

type Entry = { source: string; ministere: string; ministre: string; date: string; heure: string | null; texte: string; lieu: string | null; url: string };

const DEPUIS = '2024-07-01';
const OUT = path.resolve(process.cwd(), '../database/data/raw/agendas-navigateur.json');

// Playwright : celui du projet s'il est installé, sinon l'installation globale du poste.
async function chromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    const req = createRequire(process.env.PLAYWRIGHT_GLOBAL ?? '/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/package.json');
    return req('playwright').chromium;
  }
}

async function matignon(page: any): Promise<Entry[]> {
  const url = 'https://www.info.gouv.fr/agenda/ministre/sebastien-lecornu';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30 && /moment|instant/i.test(await page.title()); i++) await page.waitForTimeout(1000);
  const after = DEPUIS.replace(/-/g, '/');
  const before = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10).replace(/-/g, '/');
  const data = await page.evaluate(async ([a, b]: string[]) => {
    const r = await fetch(`/api/agenda?date%5Bafter%5D=${encodeURIComponent(a)}&date%5Bbefore%5D=${encodeURIComponent(b)}&pagination=false`, { headers: { Accept: 'application/ld+json' } });
    if (!r.ok) throw new Error(`info.gouv.fr ${r.status}`);
    return r.json();
  }, [after, before]);
  return (data['hydra:member'] ?? []).map((e: any) => {
    // « date » porte le jour (minuit UTC de la veille, heure de Paris) ; « datetime » l'heure, sur une date fictive.
    const day = new Date(new Date(e.date).getTime() + 12 * 3600e3).toISOString().slice(0, 10);
    const h = e.datetime ? new Date(e.datetime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : null;
    return { source: 'matignon', ministere: 'Premier ministre', ministre: 'Premier ministre', date: day, heure: h, texte: (e.description ?? '').trim(), lieu: e.location ?? null, url };
  });
}

const MOIS: Record<string, number> = { janvier: 1, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12 };
const CACHE = path.resolve(process.cwd(), '../database/data/raw/agendas/economie');

/** Texte d'un agenda PDF de Bercy → rendez-vous (« 12h   Entretien avec … », le lieu en dernière ligne du bloc). */
function parseEconomie(txt: string, url: string): Entry[] {
  const lines = txt.split('\n');
  const head = txt.replace(/\s+/g, ' ');
  const who = (head.match(/Agenda prévisionnel d(?:e |['’])\s*([^,]+),/) ?? [])[1]?.trim() ?? 'Ministre (Bercy)';
  const nice = who.replace(/^(Monsieur|Madame|M\.|Mme)\s+/i, '').replace(/\b([A-ZÀ-Ý][A-ZÀ-Ý'’-]+)\b/g, (w) => (w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w));
  const year = Number((head.match(/\b(20\d\d)\b/) ?? [])[1] ?? new Date().getFullYear());
  const out: Entry[] = [];
  let day: string | null = null;
  let cur: { h: string; parts: string[] } | null = null;
  const flush = () => {
    if (cur && day) {
      const parts = cur.parts.filter(Boolean);
      const lieu = parts.length > 1 && parts[parts.length - 1].length < 40 ? parts.pop()! : null;
      out.push({ source: 'economie', ministere: 'Economie et finances', ministre: nice, date: day, heure: cur.h, texte: parts.join(' ').replace(/\s+/g, ' ').trim(), lieu, url });
    }
    cur = null;
  };
  for (const raw of lines) {
    const l = raw.trim();
    const d = l.match(/^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\s+(\d+)(?:er)?\s+([a-zéû]+)$/i);
    if (d && MOIS[d[3].toLowerCase()]) { flush(); day = `${year}-${String(MOIS[d[3].toLowerCase()]).padStart(2, '0')}-${d[2].padStart(2, '0')}`; continue; }
    if (/^contacts? presse/i.test(l)) break;
    const h = l.match(/^(\d{1,2})\s*h\s*(\d{2})?\s+(.*)$/);
    if (h && day) { flush(); cur = { h: `${h[1].padStart(2, '0')}:${h[2] ?? '00'}`, parts: [h[3].trim()] }; continue; }
    if (!l) { flush(); continue; }
    if (cur) cur.parts.push(l);
  }
  flush();
  return out;
}

async function economie(page: any): Promise<Entry[]> {
  fs.mkdirSync(CACHE, { recursive: true });
  await page.goto('https://presse.economie.gouv.fr/agendas/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30 && /moment|instant/i.test(await page.title()); i++) await page.waitForTimeout(1000);
  const seen = new Set<string>();
  let stale = 0;
  // Chaque agenda PDF est archivé localement : l'historique se constitue nuit après nuit.
  for (let p = 0; p < 120 && stale < 2; p++) {
    await page.waitForTimeout(1200);
    const links: string[] = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="download?n="]')].map((a: any) => a.href))]);
    let fresh = 0;
    for (const u of links) {
      if (seen.has(u)) continue;
      seen.add(u);
      const id = new URL(u).searchParams.get('id') ?? String(seen.size);
      const name = new URL(u).searchParams.get('n') ?? '';
      const txtPath = path.join(CACHE, `${id}.txt`);
      if (!/agenda/i.test(name)) continue;
      if (fs.existsSync(txtPath)) continue;
      fresh++;
      const b64: string = await page.evaluate(async (url: string) => {
        const r = await fetch(url);
        const buf = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      }, u);
      const pdf = path.join(CACHE, `${id}.pdf`);
      fs.writeFileSync(pdf, Buffer.from(b64, 'base64'));
      try {
        fs.writeFileSync(txtPath, `${u}\n` + execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }));
      } catch { /* PDF illisible : ignoré */ }
      fs.rmSync(pdf, { force: true });
      await page.waitForTimeout(400);
    }
    stale = fresh ? 0 : stale + 1;
    // Pagination affichée seulement quand le site en propose une (aujourd'hui, Bercy ne garde que les semaines récentes).
    const first = links[0];
    const moved: boolean = await page.evaluate(() => {
      const n = [...document.querySelectorAll('a.fr-pagination__link--next')].find((a: any) => a.offsetParent) as any;
      n?.click();
      return !!n;
    });
    if (!moved) break;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(500);
      const now: string | undefined = await page.evaluate(() => (document.querySelector('a[href*="download?n="]') as any)?.href);
      if (now && now !== first) break;
    }
  }
  const out: Entry[] = [];
  for (const f of fs.readdirSync(CACHE).filter((x) => x.endsWith('.txt'))) {
    const [u, ...rest] = fs.readFileSync(path.join(CACHE, f), 'utf8').split('\n');
    out.push(...parseEconomie(rest.join('\n'), u));
  }
  return out.filter((e) => e.date >= DEPUIS && e.texte);
}

async function upload(body: string) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
  if (!account || !token) { console.log('Pas d\'identifiants Cloudflare : fichier gardé en local seulement.'); return; }
  const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${account}.r2.cloudflarestorage.com`, credentials: { accessKeyId: verify.result.id, secretAccessKey: crypto.createHash('sha256').update(token).digest('hex') } });
  await s3.send(new PutObjectCommand({ Bucket: 'parlementeur-og', Key: 'donnees/agendas-navigateur.json', Body: body, ContentType: 'application/json', CacheControl: 'public, max-age=3600' }));
  console.log('Déposé sur R2 : og.parlementeur.fr/donnees/agendas-navigateur.json');
}

const browser = await (await chromium()).launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const page = await (await browser.newContext({ locale: 'fr-FR', viewport: { width: 1280, height: 900 } })).newPage();
const sources: Record<string, { records: number; erreur?: string }> = {};
const entries: Entry[] = [];
for (const [key, fn] of Object.entries({ matignon, economie })) {
  try {
    const rows = await fn(page);
    entries.push(...rows);
    sources[key] = { records: rows.length };
    console.log(`${key} : ${rows.length} événements`);
  } catch (e) {
    sources[key] = { records: 0, erreur: String(e).slice(0, 160) };
    console.log(`${key} : échec (${e})`);
  }
}
await browser.close();
const body = JSON.stringify({ collecte: new Date().toISOString(), sources, entries });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body);
await upload(body);
