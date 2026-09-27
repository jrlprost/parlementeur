import type { APIRoute } from 'astro';
import { load, readOptional, type ScrutinIndex } from '../lib/data';
import { VIEWS } from '../lib/views';
import type { Lobbying } from '../lib/lobbying';

// Index de la recherche globale : [type, libellé, détail, lien]. Chargé au premier usage de la recherche.
export const GET: APIRoute = () => {
  const { deputes, groupes } = load();
  const rows: [string, string, string, string][] = [];
  for (const d of deputes) rows.push(['Député', `${d.prenom} ${d.nom}`, `${d.groupe}${d.circonscription ? ' · ' + d.circonscription : ''}`, `/deputes/${d.slug}/`]);
  for (const g of groupes) rows.push(['Groupe', g.nom, `${g.sigle} · ${g.effectif} députés`, `/deputes/?groupe=${encodeURIComponent(g.sigle)}`]);
  for (const v of VIEWS) rows.push(['Thématique', v.titre, v.label, v.id === 'groupes' ? '/' : `/vue/${v.id}/`]);
  for (const [t, u] of [['Rejouer un vote', '/scrutins/'], ['Les 577 députés', '/deputes/'], ['Lobbying auprès des parlementaires', '/lobbying/'], ["L'hémicycle depuis 1958", '/histoire/'], ['Méthode et sources', '/methode/'], ['Coulisses du pipeline', '/coulisses/']])
    rows.push(['Page', t, '', u]);
  const lobby = readOptional<Lobbying>('lobbying.json');
  for (const o of lobby?.top ?? []) rows.push(['Lobbying', o.nom, `${o.activites} actions auprès des parlementaires`, o.fiche]);
  const scrutins = (readOptional<ScrutinIndex[]>('scrutins.json') ?? []).sort((a, b) => Number(b.solennel) - Number(a.solennel) || b.date.localeCompare(a.date));
  for (const s of scrutins) rows.push(['Scrutin', s.titre, `${s.date.split('-').reverse().join('/')} · ${s.adopte ? 'adopté' : 'rejeté'}${s.solennel ? ' · vote solennel' : ''}`, `/scrutins/${s.numero}/`]);
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
