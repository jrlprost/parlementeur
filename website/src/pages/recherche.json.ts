import type { APIRoute } from 'astro';
import { load, readOptional, type ScrutinIndex } from '../lib/data';
import { VIEWS } from '../lib/views';
import type { Lobbying } from '../lib/lobbying';
import { orgName } from '../lib/text';

// Index de la recherche globale : [type, libellé, détail, lien]. Chargé au premier usage de la recherche.
export const GET: APIRoute = () => {
  const { deputes, groupes } = load();
  const rows: [string, string, string, string][] = [];
  for (const d of deputes) rows.push(['Député', `${d.prenom} ${d.nom}`, `${d.groupe}${d.circonscription ? ' · ' + d.circonscription : ''}`, `/deputes/${d.slug}/`]);
  for (const g of groupes) rows.push(['Groupe', g.nom, `${g.sigle} · ${g.effectif} députés`, `/deputes/?groupe=${encodeURIComponent(g.sigle)}`]);
  for (const v of VIEWS) rows.push(['Thématique', v.titre, v.label, v.id === 'groupes' ? '/assemblee/' : `/vue/${v.id}/`]);
  for (const [t, u] of [['Trouver mon député (code postal, commune)', '/mon-depute/'], ['Qui vote avec qui', '/qui-vote-avec-qui/'], ['Comparer deux députés', '/comparer/'], ['Intérêts déclarés, participations, sociétés détenues', '/interets/'], ["L'agenda de l'Assemblée", '/agenda/'], ['Rejouer un vote', '/scrutins/'], ['Les 577 députés', '/deputes/'], ['Lobbying : qui influence qui', '/lobbying/'], ['Qui a rencontré qui', '/rencontres/'], ["L'hémicycle depuis 1958", '/histoire/'], ['Méthode et sources', '/methode/'], ['Coulisses du pipeline', '/coulisses/']])
    rows.push(['Page', t, '', u]);
  const lobby = readOptional<Lobbying>('lobbying.json');
  for (const [slug, nom, , n, elus] of lobby?.orgs ?? []) rows.push(['Lobbying', orgName(nom), `${n} actions déclarées${elus ? ` · ${elus} élus nommés` : ''}`, `/lobbying/${slug}/`]);
  const scrutins = (readOptional<ScrutinIndex[]>('scrutins.json') ?? []).sort((a, b) => Number(b.solennel) - Number(a.solennel) || b.date.localeCompare(a.date));
  for (const s of scrutins) rows.push(['Scrutin', s.titre, `${s.date.split('-').reverse().join('/')} · ${s.adopte ? 'adopté' : 'rejeté'}${s.solennel ? ' · vote solennel' : ''}`, `/scrutins/${s.numero}/`]);
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
