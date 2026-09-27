import type { APIRoute } from 'astro';
import { load, readOptional, fmtDate } from '../lib/data';

type Rap = { titre: string; url: string; organisation: string | null; detail: string | null; etoile: boolean; registre: string[]; type: string; rapporteurs: string[] };
type Com = { date: string; organe: string; texte: string; registre: string[]; presents: string[] };

// Index de recherche de la page « Qui a rencontré qui » : [source, texte cherché, affichage, lien].
export const GET: APIRoute = () => {
  const r = readOptional<{ rapports: Rap[]; commissions: Com[] }>('rencontres.json')!;
  const who = new Map(load().deputes.map((d) => [d.slug, `${d.prenom} ${d.nom}`]));
  const names = (xs: string[]) => xs.map((s) => who.get(s)).filter(Boolean).join(', ');
  const rows = [
    ...r.rapports.filter((x) => x.type !== 'contribution').map((x) => [
      'Rapport',
      `${x.organisation ?? ''} ${x.detail ?? ''} ${x.registre.join(' ')} ${names(x.rapporteurs)} ${x.titre}`,
      `${names(x.rapporteurs) || 'Le rapporteur'} a entendu : ${x.organisation ? x.organisation + ' — ' : ''}${x.detail ?? ''}${x.etoile ? ' ★' : ''} · ${x.titre}`,
      x.url,
    ]),
    ...r.commissions.map((x) => [
      'Commission',
      `${x.texte} ${x.registre.join(' ')} ${names(x.presents)}`,
      `${fmtDate(x.date)} · ${x.organe} : ${x.texte.slice(0, 220)} (${x.presents.length} députés présents)`,
      '/agenda/',
    ]),
  ];
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
