// Génère les images de partage de tous les scrutins et envoie sur R2 celles qui ont changé.
// Variables : CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (les identifiants S3 de R2 en sont dérivés).
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { load, readOptional, type Scrutin, type ScrutinIndex } from '../src/lib/data';
import { scrutinHash, scrutinSvg } from '../src/lib/og-scrutin';
import { toPng } from '../src/lib/og';

const BUCKET = 'parlementeur-og';
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!account || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID et CLOUDFLARE_API_TOKEN sont requis.');

const verify = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${account}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: verify.result.id, secretAccessKey: crypto.createHash('sha256').update(token).digest('hex') },
});

let manifest: Record<string, string> = {};
try {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: 'manifest.json' }));
  manifest = JSON.parse(await r.Body!.transformToString());
} catch {
  console.log('aucun manifeste : génération complète');
}

const { deputes } = load();
const index = readOptional<ScrutinIndex[]>('scrutins.json') ?? [];
const todo: { s: Scrutin; h: string }[] = [];
for (const row of index) {
  const s = readOptional<Scrutin>(`scrutins/${row.numero}.json`)!;
  const h = scrutinHash(s, deputes);
  if (manifest[row.numero] !== h) todo.push({ s, h });
}
console.log(`${todo.length} images à produire sur ${index.length}`);

let done = 0;
const worker = async () => {
  while (todo.length) {
    const { s, h } = todo.shift()!;
    const png = toPng(scrutinSvg(s, deputes));
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `scrutin-${s.numero}.png`, Body: png, ContentType: 'image/png', CacheControl: 'public, max-age=86400' }));
    manifest[s.numero] = h;
    if (++done % 250 === 0) {
      console.log(`${done} envoyées`);
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'manifest.json', Body: JSON.stringify(manifest), ContentType: 'application/json' }));
    }
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'manifest.json', Body: JSON.stringify(manifest), ContentType: 'application/json' }));
console.log(`terminé : ${done} images envoyées`);
