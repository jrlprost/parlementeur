// Questions et réponses chiffrées sous l'hémicycle : chaque thématique est découpée en blocs lisibles,
// avec la liste des députés derrière chaque chiffre.
import type { Depute, Groupe } from './data';
import { fmtEur, fmtPct } from './data';
import { median } from './stats';

export type Name = { s: string; n: string; g: string; v?: string };
export type Row = { label: string; value: number; display: string; share?: number; color?: string; names?: Name[] };
export type Block =
  | { kind: 'bars'; question: string; answer: string; rows: Row[]; max?: number; note?: string; marker?: { value: number; label: string } }
  | { kind: 'split'; question: string; answer: string; parts: { label: string; value: number; color: string }[]; note?: string }
  | { kind: 'names'; question: string; answer: string; names: Name[]; note?: string }
  | { kind: 'pairs'; question: string; answer: string; legend: [string, string]; colors: [string, string]; rows: { label: string; a: number; b: number; color?: string }[]; note?: string };

const pct = (x: number, n: number) => (n ? Math.round((x / n) * 100) : 0);
const name = (d: Depute, v?: string): Name => ({ s: d.slug, n: `${d.prenom} ${d.nom}`, g: d.groupe, v });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

function buckets(ds: Depute[], defs: { label: string; test: (d: Depute) => boolean; v?: (d: Depute) => string }[]): Row[] {
  return defs.map((b) => {
    const sel = ds.filter(b.test);
    return { label: b.label, value: sel.length, display: plural(sel.length, 'député', 'députés'), share: sel.length / ds.length, names: sel.map((d) => name(d, b.v?.(d))) };
  });
}

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

export function insights(view: string, ds: Depute[], gs: Groupe[]): Block[] {
  const N = ds.length;
  // Les classements individuels écartent les députés arrivés trop tard pour que leur taux ait du sens.
  const assez = (d: Depute) => (d.scrutinsPossibles ?? 0) >= 1000;
  switch (view) {
    case 'groupes': {
      const order = [...gs].sort((a, b) => a.ordre - b.ordre);
      const bloc = (sigles: string[]) => ds.filter((d) => sigles.includes(d.groupe)).length;
      const gauche = bloc(['GDR', 'LFI-NFP', 'EcoS', 'SOC']);
      const centre = bloc(['EPR', 'Dem', 'HOR']);
      const droite = bloc(['DR', 'UDR', 'RN']);
      const autres = N - gauche - centre - droite;
      const changed = ds.filter((d) => (d.groupesSuccessifs ?? 1) > 1);
      return [
        {
          kind: 'bars',
          question: 'Quel groupe pèse combien ?',
          answer: `Aucun groupe n'approche seul de la majorité absolue de ${Math.floor(N / 2) + 1} sièges.`,
          rows: order.map((g) => ({ label: g.sigle, value: g.effectif, display: `${g.effectif} sièges`, share: g.effectif / N, color: g.couleur, names: ds.filter((d) => d.groupe === g.sigle).map((d) => name(d)) })),
          marker: { value: Math.floor(N / 2) + 1, label: 'majorité absolue' },
        },
        {
          kind: 'bars',
          question: 'Et si les blocs votaient ensemble ?',
          answer: `Gauche : ${gauche} sièges. Centre : ${centre}. Droite et extrême droite : ${droite}. Aucun bloc n'atteint ${Math.floor(N / 2) + 1}.`,
          rows: [
            { label: 'Gauche (GDR, LFI, EcoS, SOC)', value: gauche, display: `${gauche} sièges`, share: gauche / N, color: '#CC2443' },
            { label: 'Centre (EPR, Dem, HOR)', value: centre, display: `${centre} sièges`, share: centre / N, color: '#F7CB15' },
            { label: 'Droite et extrême droite (DR, UDR, RN)', value: droite, display: `${droite} sièges`, share: droite / N, color: '#0D2B52' },
            { label: 'LIOT et non-inscrits', value: autres, display: `${autres} sièges`, share: autres / N, color: '#9A9A9A' },
          ],
          max: N,
          marker: { value: Math.floor(N / 2) + 1, label: 'majorité absolue' },
          note: "Regroupement indicatif par position dans l'hémicycle : les groupes d'un même bloc ne votent pas toujours ensemble.",
        },
        {
          kind: 'names',
          question: 'Qui a changé de groupe depuis 2024 ?',
          answer: changed.length ? `${plural(changed.length, 'député a', 'députés ont')} changé de groupe au cours de la législature.` : "Aucun changement de groupe n'est enregistré.",
          names: changed.map((d) => name(d, `${d.groupesSuccessifs} groupes`)),
        },
      ];
    }
    case 'age': {
      const ages = ds.map((d) => d.age).filter((x): x is number => x != null);
      const m = median(ages) ?? 0;
      const young = ds.filter((d) => (d.age ?? 99) < 40).length;
      const old = ds.filter((d) => (d.age ?? 0) >= 65).length;
      const defs = [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75].map((a) => ({ label: `${a}–${a + 4} ans`, test: (d: Depute) => d.age != null && d.age >= a && d.age < a + 5, v: (d: Depute) => `${d.age} ans` }));
      defs[defs.length - 1] = { label: '75 ans et plus', test: (d) => (d.age ?? 0) >= 75, v: (d) => `${d.age} ans` };
      return [
        { kind: 'bars', question: 'Quel âge ont les députés ?', answer: `La moitié des députés a plus de ${Math.round(m)} ans. ${young} ont moins de 40 ans, ${old} ont 65 ans ou plus.`, rows: buckets(ds, defs) },
        { kind: 'bars', question: 'Quel groupe est le plus jeune ?', answer: 'Âge médian de chaque groupe.', rows: byGroup(ds, gs, (m) => median(m.map((d) => d.age!).filter((x) => x != null)), (x) => `${Math.round(x)} ans`) },
        { kind: 'names', question: 'Les dix plus jeunes', answer: 'Les benjamins de l\'Assemblée.', names: top(ds, (d) => d.age, 10, 'asc', (x) => `${x} ans`) },
        { kind: 'names', question: 'Les dix doyens', answer: 'Les députés les plus âgés.', names: top(ds, (d) => d.age, 10, 'desc', (x) => `${x} ans`) },
      ];
    }
    case 'sexe': {
      const f = ds.filter((d) => d.femme).length;
      const h = N - f;
      const rows = [...gs]
        .sort((a, b) => a.ordre - b.ordre)
        .map((g) => {
          const m = ds.filter((d) => d.groupe === g.sigle);
          return { label: g.sigle, a: m.filter((d) => d.femme).length, b: m.filter((d) => !d.femme).length, color: g.couleur };
        });
      const paritaires = rows.filter((r) => Math.abs(r.a - r.b) <= Math.max(1, Math.round((r.a + r.b) * 0.1))).map((r) => r.label);
      return [
        { kind: 'split', question: "Combien de femmes, combien d'hommes ?", answer: `${f} femmes et ${h} hommes siègent à l'Assemblée : il manque ${Math.ceil(N / 2) - f} femmes pour atteindre la parité.`, parts: [ { label: 'Femmes', value: f, color: 'var(--ramp-to)' }, { label: 'Hommes', value: h, color: 'var(--ink-62)' } ] },
        { kind: 'pairs', question: 'Femmes et hommes dans chaque groupe', answer: paritaires.length ? `Groupes proches de la parité (écart de 10 % au plus) : ${paritaires.join(', ')}.` : "Aucun groupe n'est à la parité.", legend: ['Femmes', 'Hommes'], colors: ['var(--ramp-to)', 'var(--ink-62)'], rows },
      ];
    }
    case 'participation': {
      const defs = [
        { label: 'Moins de 10 %', test: (d: Depute) => d.participation != null && d.participation < 0.1 },
        { label: 'De 10 à 25 %', test: (d: Depute) => d.participation != null && d.participation >= 0.1 && d.participation < 0.25 },
        { label: 'De 25 à 50 %', test: (d: Depute) => d.participation != null && d.participation >= 0.25 && d.participation < 0.5 },
        { label: '50 % et plus', test: (d: Depute) => d.participation != null && d.participation >= 0.5 },
      ].map((b) => ({ ...b, v: (d: Depute) => fmtPct(d.participation!) }));
      const rows = buckets(ds, defs);
      return [
        { kind: 'bars', question: 'Combien de députés votent rarement ?', answer: `${rows[0].value} députés ont pris part à moins d'un scrutin sur dix depuis leur élection.`, rows, note: "La plupart des scrutins portent sur des amendements, souvent tard le soir, avec peu de députés en séance : un taux faible ne signifie pas forcément une absence totale de travail." },
        { kind: 'bars', question: 'Quel groupe vote le plus ?', answer: 'Présence médiane aux scrutins, par groupe.', rows: byGroup(ds, gs, (m) => median(m.map((d) => d.participation!).filter((x) => x != null)), fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix qui votent le plus', answer: 'Part des scrutins votés, parmi les députés présents depuis au moins 1 000 scrutins.', names: top(ds.filter(assez), (d) => d.participation, 10, 'desc', fmtPct) },
        { kind: 'names', question: 'Les dix qui votent le moins', answer: "Même règle. La présidence de l'Assemblée, qui ne vote pas, est exclue.", names: top(ds.filter(assez), (d) => d.participation, 10, 'asc', fmtPct) },
      ];
    }
    case 'solennels': {
      const defs = [
        { label: 'Tous (100 %)', test: (d: Depute) => d.participationSolennels === 1 },
        { label: 'De 75 à 99 %', test: (d: Depute) => d.participationSolennels != null && d.participationSolennels >= 0.75 && d.participationSolennels < 1 },
        { label: 'De 50 à 75 %', test: (d: Depute) => d.participationSolennels != null && d.participationSolennels >= 0.5 && d.participationSolennels < 0.75 },
        { label: 'Moins de la moitié', test: (d: Depute) => d.participationSolennels != null && d.participationSolennels < 0.5 },
      ].map((b) => ({ ...b, v: (d: Depute) => fmtPct(d.participationSolennels!) }));
      const rows = buckets(ds, defs);
      return [
        { kind: 'bars', question: 'Qui vote sur les grands textes ?', answer: `${rows[0].value} députés n'ont manqué aucun vote solennel ; ${rows[3].value} en ont manqué plus de la moitié.`, rows },
        { kind: 'bars', question: 'Par groupe', answer: 'Présence médiane aux votes solennels.', rows: byGroup(ds, gs, (m) => median(m.map((d) => d.participationSolennels!).filter((x) => x != null)), fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
      ];
    }
    case 'loyaute': {
      const defs = [
        { label: 'Toujours ou presque (98 % et plus)', test: (d: Depute) => d.loyaute != null && d.loyaute >= 0.98 },
        { label: 'De 90 à 98 %', test: (d: Depute) => d.loyaute != null && d.loyaute >= 0.9 && d.loyaute < 0.98 },
        { label: 'De 80 à 90 %', test: (d: Depute) => d.loyaute != null && d.loyaute >= 0.8 && d.loyaute < 0.9 },
        { label: 'Moins de 80 %', test: (d: Depute) => d.loyaute != null && d.loyaute < 0.8 },
      ].map((b) => ({ ...b, v: (d: Depute) => fmtPct(d.loyaute!) }));
      const rows = buckets(ds, defs);
      return [
        { kind: 'bars', question: 'Les députés votent-ils comme leur groupe ?', answer: `${rows[3].value} députés s'écartent de la position de leur groupe plus d'une fois sur cinq.`, rows, note: 'Loyauté : part des votes identiques à la position majoritaire du groupe au moment du vote.' },
        { kind: 'bars', question: 'Quel groupe est le plus soudé ?', answer: 'Loyauté médiane de chaque groupe. Plus elle est haute, plus le groupe vote d\'une seule voix.', rows: byGroup(ds, gs, (m) => median(m.map((d) => d.loyaute!).filter((x) => x != null)), fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix plus indépendants de leur groupe', answer: 'Les loyautés les plus basses.', names: top(ds.filter(assez), (d) => d.loyaute, 10, 'asc', fmtPct) },
      ];
    }
    case 'amendements': {
      const zero = ds.filter((d) => d.amendements === 0);
      const defs = [
        { label: 'Aucun', test: (d: Depute) => d.amendements === 0 },
        { label: 'De 1 à 20', test: (d: Depute) => d.amendements >= 1 && d.amendements <= 20 },
        { label: 'De 21 à 100', test: (d: Depute) => d.amendements > 20 && d.amendements <= 100 },
        { label: 'De 101 à 500', test: (d: Depute) => d.amendements > 100 && d.amendements <= 500 },
        { label: 'Plus de 500', test: (d: Depute) => d.amendements > 500 },
      ].map((b) => ({ ...b, v: (d: Depute) => `${d.amendements} amendements` }));
      const tot = ds.reduce((a, d) => a + d.amendements, 0);
      const top10 = [...ds].sort((a, b) => b.amendements - a.amendements).slice(0, Math.round(N / 10)).reduce((a, d) => a + d.amendements, 0);
      return [
        { kind: 'bars', question: 'Qui propose de modifier les lois ?', answer: `${zero.length} députés n'ont déposé aucun amendement en premier signataire. À l'inverse, les 10 % les plus actifs en ont déposé ${pct(top10, tot)} % à eux seuls.`, rows: buckets(ds, defs) },
        { kind: 'bars', question: 'Quels amendements passent ?', answer: 'Part des amendements adoptés, par groupe.', rows: byGroup(ds, gs, (m) => { const d = m.reduce((a, x) => a + x.amendements, 0); return d ? m.reduce((a, x) => a + x.amendementsAdoptes, 0) / d : null; }, fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix plus gros déposants', answer: "Nombre d'amendements déposés en premier signataire.", names: top(ds, (d) => d.amendements, 10, 'desc', (x) => `${x.toLocaleString('fr-FR')}`) },
      ];
    }
    case 'anciennete': {
      const defs = [1, 2, 3, 4, 5].map((n) => ({ label: n === 1 ? 'Premier mandat' : `${n}e mandat`, test: (d: Depute) => d.legislatures === n, v: (d: Depute) => `${d.legislatures} législatures` }));
      defs.push({ label: '6e mandat ou plus', test: (d) => (d.legislatures ?? 0) >= 6, v: (d) => `${d.legislatures} législatures` });
      const rows = buckets(ds, defs);
      return [
        { kind: 'bars', question: "Renouvellement ou carrière ?", answer: `${rows[0].value} députés effectuent leur premier mandat, ${rows[5].value} en sont au sixième ou plus.`, rows },
        { kind: 'bars', question: 'Quel groupe compte le plus de nouveaux ?', answer: 'Part de députés en premier mandat, par groupe.', rows: byGroup(ds, gs, (m) => (m.length ? m.filter((d) => d.legislatures === 1).length / m.length : null), fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix plus anciens', answer: 'Nombre de législatures effectuées.', names: top(ds, (d) => d.legislatures, 10, 'desc', (x) => `${x} législatures`) },
      ];
    }
    case 'revenus': {
      const known = ds.filter((d) => d.revenusAnnexes != null);
      const defs = [
        { label: 'Aucun', test: (d: Depute) => d.revenusAnnexes === 0 },
        { label: 'Moins de 10 000 €', test: (d: Depute) => (d.revenusAnnexes ?? 0) > 0 && d.revenusAnnexes! < 10000 },
        { label: 'De 10 000 à 50 000 €', test: (d: Depute) => (d.revenusAnnexes ?? 0) >= 10000 && d.revenusAnnexes! < 50000 },
        { label: 'De 50 000 à 100 000 €', test: (d: Depute) => (d.revenusAnnexes ?? 0) >= 50000 && d.revenusAnnexes! < 100000 },
        { label: '100 000 € et plus', test: (d: Depute) => (d.revenusAnnexes ?? 0) >= 100000 },
        { label: 'Déclaration non rapprochée', test: (d: Depute) => d.revenusAnnexes == null },
      ].map((b) => ({ ...b, v: (d: Depute) => (d.revenusAnnexes == null ? '' : fmtEur(d.revenusAnnexes)) }));
      const rows = buckets(ds, defs);
      const some = known.filter((d) => d.revenusAnnexes! > 0).length;
      return [
        { kind: 'bars', question: 'Combien gagnent-ils en plus du mandat ?', answer: `${some} députés sur ${known.length} dont la déclaration est connue perçoivent des revenus en plus de leur indemnité. ${rows[4].value} déclarent 100 000 € ou plus sur un an.`, rows, note: "Activités conservées pendant le mandat et autres mandats électifs, année la plus récente déclarée. L'indemnité de député (7 637 € brut par mois) n'est pas comptée." },
        { kind: 'bars', question: 'Dans quels groupes ?', answer: 'Part des députés de chaque groupe qui déclarent des revenus annexes.', rows: byGroup(ds, gs, (m) => { const k = m.filter((d) => d.revenusAnnexes != null); return k.length ? k.filter((d) => d.revenusAnnexes! > 0).length / k.length : null; }, fmtPct).map((r) => ({ ...r, share: r.value })), max: 1 },
        { kind: 'names', question: 'Les dix plus hauts revenus annexes', answer: 'Montants déclarés à la HATVP.', names: top(ds, (d) => d.revenusAnnexes, 10, 'desc', fmtEur) },
      ];
    }
  }
  return [];
}
