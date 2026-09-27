import type { APIRoute } from 'astro';
import { load } from '../lib/data';

// Slug, nom et groupe de chaque siège, dans l'ordre de l'hémicycle : sert aux pages de scrutin.
export const GET: APIRoute = () => {
  const rows = load().deputes.map((d) => [d.slug, `${d.prenom} ${d.nom}`, d.groupe]);
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
