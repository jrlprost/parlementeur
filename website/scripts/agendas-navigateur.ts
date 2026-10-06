// Agendas ministériels publiés derrière une protection anti-robots (Cloudflare) : lus avec un vrai navigateur.
// Ce sont des informations publiques, destinées à tous ; le script les consulte comme un visiteur, à faible cadence.
// Il tourne sur un poste avec écran (la protection refuse les navigateurs sans interface), puis dépose le résultat
// sur R2 (og.parlementeur.fr/donnees/agendas-navigateur.json), où le pipeline le récupère.
// Lancement : pnpm exec tsx scripts/agendas-navigateur.ts  (variables CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
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
for (const [key, fn] of Object.entries({ matignon })) {
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
