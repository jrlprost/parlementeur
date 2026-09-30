import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { load } from '../../lib/data';

// Votes d'un député, un caractère par scrutin (voir database/src/parlementeur/proximite.py) : sert au comparateur.
const DIR = path.resolve(process.cwd(), '../database/dist/votes');

export function getStaticPaths() {
  return load().deputes.filter((d) => fs.existsSync(path.join(DIR, `${d.slug}.txt`))).map((d) => ({ params: { slug: d.slug } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(fs.readFileSync(path.join(DIR, `${params.slug}.txt`), 'utf8'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
