import type { APIRoute } from 'astro';
import { readOptional, type ScrutinIndex } from '../../lib/data';

// Scrutins dans l'ordre des lignes de votes : [numéro, date, titre court, solennel].
export const GET: APIRoute = () => {
  const order = readOptional<number[]>('votes/index.json') ?? [];
  const by = new Map((readOptional<ScrutinIndex[]>('scrutins.json') ?? []).map((s) => [s.numero, s]));
  const rows = order.map((n) => {
    const s = by.get(n)!;
    return [n, s.date, s.titre.length > 160 ? s.titre.slice(0, 157) + '…' : s.titre, s.solennel ? 1 : 0];
  });
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
