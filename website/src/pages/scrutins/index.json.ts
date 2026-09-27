import type { APIRoute } from 'astro';
import { readOptional, type ScrutinIndex } from '../../lib/data';

// Index compact de tous les scrutins, chargé par la recherche de la page Scrutins.
export const GET: APIRoute = () => {
  const idx = readOptional<ScrutinIndex[]>('scrutins.json') ?? [];
  const rows = idx.map((s) => [s.numero, s.date, s.titre, s.adopte ? 1 : 0, s.pour, s.contre, s.solennel ? 1 : 0]);
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
