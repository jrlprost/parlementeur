// Questions et réponses chiffrées sous l'hémicycle : chaque thématique est découpée en blocs lisibles,
// avec la liste des députés derrière chaque chiffre.
import type { Depute, Groupe } from './data';
import { fmtEur, fmtPct } from './data';
import { median } from './stats';
import { swarm, pyramid, waffle, scatter, lorenz, columns, type Pt } from './charts';

export type Name = { s: string; n: string; g: string; v?: string };
export type Row = { label: string; value: number; display: string; share?: number; color?: string; names?: Name[] };
export type Block =
  | { kind: 'bars'; question: string; answer: string; rows: Row[]; max?: number; note?: string; marker?: { value: number; label: string } }
  | { kind: 'split'; question: string; answer: string; parts: { label: string; value: number; color: string }[]; note?: string }
  | { kind: 'names'; question: string; answer: string; names: Name[]; note?: string }
  | { kind: 'svg'; question: string; answer: string; svg: string; legend?: { label: string; color: string }[]; note?: string }
  | { kind: 'coalition'; question: string; answer: string; groups: { sigle: string; nom: string; n: number; color: string }[]; total: number; note?: string }
  | { kind: 'pairs'; question: string; answer: string; legend: [string, string]; colors: [string, string]; rows: { label: string; a: number; b: number; color?: string }[]; note?: string };

const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
const name = (d: Depute, v?: string): Name => ({ s: d.slug, n: `${d.prenom} ${d.nom}`, g: d.groupe, v });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function byGroup(ds: Depute[], gs: Groupe[], agg: (members: Depute[]) => number | null, fmt: (x: number) => string): Row[] {
  return gs
    .map((g) => {
      const m = ds.filter((d) => d.groupe === g.sigle);
      const v = agg(m);
      return v == null ? null : { label: g.sigle, value: v, display: fmt(v), color: g.couleur };
    })
    .filter((r): r is Row => r != null)
    .sort((a, b) => b.value - a.value);
}

function top(ds: Depute[], key: (d: Depute) => number | null, n: number, dir: 'asc' | 'desc', fmt: (x: number) => string): Name[] {
  return ds
    .filter((d) => key(d) != null)
    .sort((a, b) => (dir === 'desc' ? key(b)! - key(a)! : key(a)! - key(b)!))
    .slice(0, n)
    .map((d) => name(d, fmt(key(d)!)));
}

const pt = (d: Depute, v: number, label: string, c?: string): Pt => ({ v, s: d.slug, n: `${d.prenom} ${d.nom}`, g: d.groupe, label, c });

/** Un essaim par groupe, groupes triés par médiane. */
function groupSwarm(ds: Depute[], gs: Groupe[], val: (d: Depute) => number | null, label: (v: number) => string) {
  return [...gs]
    .map((g) => ({ label: g.sigle, color: g.couleur, points: ds.filter((d) => d.groupe === g.sigle && val(d) != null).map((d) => pt(d, val(d)!, label(val(d)!))) }))
    .filter((r) => r.points.length)
    .sort((a, b) => (median(b.points.map((p) => p.v)) ?? 0) - (median(a.points.map((p) => p.v)) ?? 0));
}
const TAP = 'Touchez un point pour voir le député.';

export function insights(view: string, ds: Depute[], gs: Groupe[]): Block[] {
  const N = ds.length;
  const MAJ = Math.floor(N / 2) + 1;
  // Les classements individuels écartent les députés arrivés trop tard pour que leur taux ait du sens.
  const assez = (d: Depute) => (d.scrutinsPossibles ?? 0) >= 1000;
  const order = [...gs].sort((a, b) => a.ordre - b.ordre);
  const pctAxis = { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1], fmt: (v: number) => `${Math.round(v * 100)} %` };

  switch (view) {
    case 'groupes': {
      const changed = ds.filter((d) => (d.groupesSuccessifs ?? 1) > 1);
      return [
        {
          kind: 'coalition',
          question: 'Qui peut gouverner avec qui ?',
          answer: `Aucun groupe n'a la majorité absolue de ${MAJ} sièges. Composez une coalition en touchant les groupes.`,
          groups: order.map((g) => ({ sigle: g.sigle, nom: g.nom, n: g.effectif, color: g.couleur })),
          total: N,
          note: "Une majorité absolue n'est nécessaire que pour certains votes ; la plupart des textes passent à la majorité des suffrages exprimés.",
        },
        {
          kind: 'names',
          question: 'Qui a changé de groupe depuis 2024 ?',
          answer: changed.length ? `${plural(changed.length, 'député a', 'députés ont')} changé de groupe au cours de la législature.` : "Aucun changement de groupe n'est enregistré.",
          names: changed.map((d) => name(d, `${d.groupesSuccessifs} groupes`)),
          note: "Reconstitué à partir du groupe enregistré à chaque vote.",
        },
      ];
    }
    case 'age': {
      const ages = ds.map((d) => d.age).filter((x): x is number => x != null);
      const m = median(ages) ?? 0;
      const bins = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75].map((a, i, arr) => {
        const hi = i === arr.length - 1 ? 200 : a + 5;
        const sel = ds.filter((d) => d.age != null && d.age >= a && d.age < hi);
        return { label: i === arr.length - 1 ? '75+' : `${a}–${a + 4}`, f: sel.filter((d) => d.femme).length, h: sel.filter((d) => !d.femme).length };
      });
      const young = ds.filter((d) => (d.age ?? 99) < 40);
      const sw = groupSwarm(ds, gs, (d) => d.age, (v) => `${v} ans`).reverse();
      return [
        { kind: 'svg', question: "La pyramide des âges de l'Assemblée", answer: `La moitié des députés a plus de ${Math.round(m)} ans. Les moins de 40 ans sont ${young.length}, dont ${young.filter((d) => d.femme).length} femmes.`, svg: pyramid(bins, ['var(--ramp-to)', 'var(--ink-62)']) },
        { kind: 'svg', question: 'Chaque groupe, député par député', answer: `Le groupe le plus jeune est ${sw[0].label}, avec un âge médian de ${Math.round(median(sw[0].points.map((p) => p.v)) ?? 0)} ans. Le trait vertical marque l'âge médian du groupe.`, svg: swarm(sw, { min: 25, max: 85, ticks: [30, 40, 50, 60, 70, 80], fmt: (v) => `${v}` }), note: TAP },
        { kind: 'names', question: 'Les dix plus jeunes', answer: "Les benjamins de l'Assemblée.", names: top(ds, (d) => d.age, 10, 'asc', (x) => `${x} ans`) },
        { kind: 'names', question: 'Les dix doyens', answer: 'Les députés les plus âgés.', names: top(ds, (d) => d.age, 10, 'desc', (x) => `${x} ans`) },
      ];
    }
    case 'sexe': {
      const f = ds.filter((d) => d.femme);
      const h = ds.filter((d) => !d.femme);
      const cells = [...f.map((d) => ({ color: 'var(--ramp-to)', p: pt(d, 1, 'femme') })), ...h.map((d) => ({ color: 'var(--ink-62)', p: pt(d, 0, 'homme') }))];
      const rows = order.map((g) => {
        const m = ds.filter((d) => d.groupe === g.sigle);
        return { label: g.sigle, a: m.filter((d) => d.femme).length, b: m.filter((d) => !d.femme).length, color: g.couleur };
      });
      const paritaires = rows.filter((r) => Math.abs(r.a - r.b) <= Math.max(1, Math.round((r.a + r.b) * 0.1))).map((r) => r.label);
      return [
        { kind: 'svg', question: "Combien de femmes, combien d'hommes ?", answer: `${f.length} femmes et ${h.length} hommes : un carré par député. Il manque ${Math.ceil(N / 2) - f.length} femmes pour la parité.`, svg: waffle(cells), legend: [{ label: `${f.length} femmes`, color: 'var(--ramp-to)' }, { label: `${h.length} hommes`, color: 'var(--ink-62)' }], note: TAP },
        { kind: 'pairs', question: 'Femmes et hommes dans chaque groupe', answer: paritaires.length ? `Groupes proches de la parité (écart de 10 % au plus) : ${paritaires.join(', ')}.` : "Aucun groupe n'est à la parité.", legend: ['Femmes', 'Hommes'], colors: ['var(--ramp-to)', 'var(--ink-62)'], rows },
      ];
    }
    case 'participation': {
      const sw = groupSwarm(ds.filter(assez), gs, (d) => d.participation, fmtPct);
      const low = ds.filter((d) => assez(d) && (d.participation ?? 1) < 0.1);
      return [
        { kind: 'svg', question: 'Qui vote, groupe par groupe', answer: `${sw[0].label} est le groupe le plus présent aux scrutins, ${sw[sw.length - 1].label} le moins. ${low.length} députés votent moins d'une fois sur dix.`, svg: swarm(sw, { ...pctAxis, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8] }), note: `${TAP} Députés présents depuis au moins 1 000 scrutins. La plupart des scrutins portent sur des amendements, souvent tard le soir.` },
        { kind: 'names', question: 'Les dix qui votent le plus', answer: 'Part des scrutins votés.', names: top(ds.filter(assez), (d) => d.participation, 10, 'desc', fmtPct) },
        { kind: 'names', question: 'Les dix qui votent le moins', answer: "La présidence de l'Assemblée, qui ne vote pas, est exclue.", names: top(ds.filter(assez), (d) => d.participation, 10, 'asc', fmtPct) },
      ];
    }
    case 'solennels': {
      const sw = groupSwarm(ds, gs, (d) => d.participationSolennels, fmtPct);
      const all = ds.filter((d) => d.participationSolennels === 1).length;
      const half = ds.filter((d) => d.participationSolennels != null && d.participationSolennels < 0.5);
      return [
        { kind: 'svg', question: 'Les grands votes, groupe par groupe', answer: `${all} députés n'ont manqué aucun vote solennel. ${half.length} en ont manqué plus de la moitié.`, svg: swarm(sw, { ...pctAxis, min: 0.2, ticks: [0.25, 0.5, 0.75, 1] }), note: TAP },
        { kind: 'names', question: 'Ils ont manqué plus de la moitié des votes solennels', answer: `${half.length} députés.`, names: half.sort((a, b) => a.participationSolennels! - b.participationSolennels!).map((d) => name(d, fmtPct(d.participationSolennels!))) },
      ];
    }
    case 'loyaute': {
      const pts = ds.filter((d) => assez(d) && d.loyaute != null && d.participation != null).map((d) => ({ ...pt(d, d.participation!, `vote ${fmtPct(d.participation!)} · loyauté ${fmtPct(d.loyaute!)}`, gs.find((g) => g.sigle === d.groupe)?.couleur), y: d.loyaute! }));
      const sw = groupSwarm(ds.filter(assez), gs, (d) => d.loyaute, fmtPct);
      return [
        { kind: 'svg', question: 'Présents et fidèles, ou absents et libres ?', answer: "Chaque point est un député : à droite ceux qui votent le plus, en haut ceux qui suivent le plus leur groupe. Les traits pointillés marquent les médianes.", svg: scatter(pts, { ...pctAxis, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8] }, { min: 0.6, max: 1, ticks: [0.6, 0.7, 0.8, 0.9, 1], fmt: (v) => `${Math.round(v * 100)}%` }, ['Présents et fidèles', 'Rares mais fidèles', 'Rares et libres', 'Présents et libres']), note: TAP },
        { kind: 'svg', question: 'Quel groupe vote d\'une seule voix ?', answer: `${sw[0].label} est le groupe le plus soudé, ${sw[sw.length - 1].label} le plus divisé.`, svg: swarm(sw, { min: 0.6, max: 1, ticks: [0.6, 0.7, 0.8, 0.9, 1], fmt: (v) => `${Math.round(v * 100)} %` }), note: TAP },
        { kind: 'names', question: 'Les dix plus indépendants de leur groupe', answer: 'Les loyautés les plus basses.', names: top(ds.filter(assez), (d) => d.loyaute, 10, 'asc', fmtPct) },
      ];
    }
    case 'amendements': {
      const zero = ds.filter((d) => d.amendements === 0);
      const lz = lorenz(ds.map((d) => d.amendements), [0.1, 0.5]);
      const sw = groupSwarm(ds, gs, (d) => d.amendements + 1, (v) => `${v - 1} amendements`);
      return [
        { kind: 'svg', question: 'Une poignée de députés écrit la plupart des amendements', answer: `Les 10 % de députés les plus actifs ont déposé ${Math.round(lz.at[0.1] * 100)} % des amendements. ${zero.length} n'en ont déposé aucun.`, svg: lz.svg },
        { kind: 'svg', question: 'Groupe par groupe', answer: "Nombre d'amendements déposés en premier signataire, sur une échelle logarithmique : chaque graduation multiplie par dix.", svg: swarm(sw, { min: 1, max: 3000, ticks: [1, 11, 101, 1001], fmt: (v) => `${v - 1}`, log: true }), note: TAP },
        { kind: 'names', question: "Ceux qui n'ont déposé aucun amendement", answer: `${zero.length} députés.`, names: zero.map((d) => name(d)) },
        { kind: 'names', question: 'Les dix plus gros déposants', answer: "Nombre d'amendements déposés en premier signataire.", names: top(ds, (d) => d.amendements, 10, 'desc', (x) => `${x.toLocaleString('fr-FR')}`) },
      ];
    }
    case 'anciennete': {
      const years = new Map<number, number>();
      for (const d of ds) if (d.premiereElection) years.set(d.premiereElection, (years.get(d.premiereElection) ?? 0) + 1);
      const items = [...years.entries()].map(([k, n]) => ({ k, n }));
      const peaks = new Set([...items].sort((a, b) => b.n - a.n).slice(0, 4).map((i) => i.k));
      const first = ds.filter((d) => d.legislatures === 1);
      return [
        { kind: 'svg', question: 'Quand sont-ils arrivés ?', answer: `Année de première élection des députés actuels. ${first.length} sont entrés à l'Assemblée en 2024 ou depuis.`, svg: columns(items, (k) => (peaks.has(k) ? `${k} : ${years.get(k)}` : null)) },
        { kind: 'bars', question: 'Quel groupe compte le plus de nouveaux ?', answer: 'Part de députés en premier mandat, par groupe.', rows: byGroup(ds, gs, (m) => (m.length ? m.filter((d) => d.legislatures === 1).length / m.length : null), fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix plus anciens', answer: 'Nombre de législatures effectuées.', names: top(ds, (d) => d.legislatures, 10, 'desc', (x) => `${x} législatures`) },
      ];
    }
    case 'revenus': {
      const SMIC = 17735, MEDIAN = 26280;
      const known = ds.filter((d) => d.revenusAnnexes != null);
      const some = known.filter((d) => d.revenusAnnexes! > 0);
      const aboveMedian = some.filter((d) => d.revenusAnnexes! >= MEDIAN);
      const sw = groupSwarm(some, gs, (d) => d.revenusAnnexes, fmtEur);
      return [
        { kind: 'svg', question: 'Combien gagnent-ils en plus de leur mandat ?', answer: `${some.length} députés déclarent des revenus annexes. ${aboveMedian.length} d'entre eux gagnent ainsi, en plus de leur indemnité, plus qu'un salarié médian en un an.`, svg: swarm(sw, { min: 100, max: 200000, ticks: [100, 1000, 10000, 100000], fmt: (v) => (v >= 1000 ? `${v / 1000} k€` : `${v} €`), log: true }, [{ v: SMIC, label: 'Smic' }, { v: MEDIAN, label: 'médiane' }]), note: `${TAP} Repères annuels nets : Smic 17 700 € (service-public.fr, 2026), salaire médian 26 300 € (INSEE, 2024). Les montants sont ceux déclarés à la HATVP, parfois en brut. L'indemnité de député (7 637 € brut par mois) n'est pas comptée.` },
        { kind: 'names', question: 'Les dix plus hauts revenus annexes', answer: 'Montants déclarés à la HATVP.', names: top(ds, (d) => d.revenusAnnexes, 10, 'desc', fmtEur) },
        { kind: 'names', question: 'Ils ne déclarent aucun revenu annexe', answer: `${known.length - some.length} députés sur ${known.length} dont la déclaration est connue.`, names: known.filter((d) => d.revenusAnnexes === 0).map((d) => name(d)) },
      ];
    }
  }
  return [];
}
