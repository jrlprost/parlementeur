// Copie les portraits produits par le pipeline dans public/, pour qu'ils soient servis par le site.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('../database/dist/photos');
const dest = path.resolve('public/photos');
if (!fs.existsSync(src)) {
  console.error('Aucune donnée : lancez le pipeline (cd ../database && uv run parlementeur).');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`photos copiées : ${fs.readdirSync(dest).length}`);
