import type { APIRoute } from 'astro';
import { load } from '../lib/data';

// Micro-fiches affichées au survol : nom, groupe, couleur, circonscription, âge, photo.
export const GET: APIRoute = () => {
  const { deputes, groupes } = load();
  const g = new Map(groupes.map((x) => [x.sigle, x]));
  const out = Object.fromEntries(
    deputes.map((d) => [d.slug, [`${d.prenom} ${d.nom}`, d.groupe, g.get(d.groupe)?.nom ?? d.groupe, g.get(d.groupe)?.couleur ?? '#9A9A9A', d.circonscription ?? '', d.age ?? null, d.photo ? 1 : 0]]),
  );
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
};
