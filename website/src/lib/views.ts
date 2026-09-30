// Les thématiques qui colorent l'hémicycle. Chaque vue a sa propre URL et sa propre image de partage.
import type { Depute } from './data';

export type ViewKind = 'groupe' | 'rampe' | 'binaire';

export type View = {
  id: string;
  label: string;
  titre: string;
  intro: string;
  kind: ViewKind;
  /** Valeur normalisée entre 0 et 1 pour les rampes, ou booléen pour les vues binaires. null = pas de donnée. */
  value?: (d: Depute) => number | boolean | null;
  legende?: [string, string];
  source: { label: string; url: string };
};

const AN = { label: 'Assemblée nationale, open data', url: 'https://data.assemblee-nationale.fr/' };
const HATVP = { label: "HATVP, déclarations d'intérêts", url: 'https://www.hatvp.fr/open-data/' };

const clamp = (x: number) => Math.max(0, Math.min(1, x));

export const VIEWS: View[] = [
  {
    id: 'groupes',
    label: 'Groupes',
    titre: "Qui siège dans l'hémicycle",
    intro: 'Chaque point est un député, placé dans son groupe politique, de la gauche à la droite.',
    kind: 'groupe',
    source: AN,
  },
  {
    id: 'age',
    label: 'Âge',
    titre: "Quel âge a l'hémicycle",
    intro: "Plus la couleur est intense, plus le député est âgé.",
    kind: 'rampe',
    value: (d) => (d.age == null ? null : clamp((d.age - 25) / (80 - 25))),
    legende: ['25 ans', '80 ans'],
    source: AN,
  },
  {
    id: 'sexe',
    label: 'Sexe',
    titre: "Femmes et hommes dans l'hémicycle",
    intro: 'Chaque point est un député : les femmes en rouge velours, les hommes en gris.',
    kind: 'binaire',
    value: (d) => d.femme,
    legende: ['Hommes', 'Femmes'],
    source: AN,
  },
  {
    id: 'participation',
    label: 'Présence aux votes',
    titre: 'Qui vote, qui ne vote pas',
    intro: "Part de tous les scrutins publics auxquels le député a pris part depuis son élection. Beaucoup de votes sur des amendements ont lieu avec peu de députés en séance : la médiane tourne autour d'un vote sur quatre.",
    kind: 'rampe',
    value: (d) => (d.participation == null ? null : clamp(d.participation / 0.6)),
    legende: ['0 %', '60 % et plus'],
    source: AN,
  },
  {
    id: 'solennels',
    label: 'Votes solennels',
    titre: 'Qui vote sur les grands textes',
    intro: "Part des votes solennels (le vote final sur un texte entier) auxquels le député a pris part. Ce sont les votes les plus importants, annoncés à l'avance.",
    kind: 'rampe',
    value: (d) => (d.participationSolennels == null ? null : clamp((d.participationSolennels - 0.4) / 0.6)),
    legende: ['40 % ou moins', '100 %'],
    source: AN,
  },
  {
    id: 'loyaute',
    label: 'Loyauté',
    titre: 'Qui vote comme son groupe',
    intro: 'Loyauté : part des votes où le député a suivi la position majoritaire de son groupe. Plus la couleur est pâle, plus il s\'en écarte.',
    kind: 'rampe',
    value: (d) => (d.loyaute == null ? null : clamp((d.loyaute - 0.7) / 0.3)),
    legende: ['70 % ou moins', '100 %'],
    source: AN,
  },
  {
    id: 'amendements',
    label: 'Amendements',
    titre: 'Qui propose de changer les textes',
    intro: "Nombre d'amendements déposés en premier signataire, en séance et en commission, depuis le début de la législature.",
    kind: 'rampe',
    value: (d) => clamp(Math.log10(1 + d.amendements) / Math.log10(1001)),
    legende: ['0', '1 000 et plus'],
    source: AN,
  },
  {
    id: 'anciennete',
    label: 'Ancienneté',
    titre: 'Nouveaux venus et vétérans',
    intro: "Nombre de législatures effectuées, celle-ci comprise. Pâle = premier mandat.",
    kind: 'rampe',
    value: (d) => (d.legislatures == null ? null : clamp((d.legislatures - 1) / 6)),
    legende: ['1er mandat', '7 mandats ou plus'],
    source: AN,
  },
  {
    id: 'revenus',
    label: 'Revenus annexes',
    titre: 'Qui déclare des revenus en plus de son mandat',
    intro: "Revenus déclarés à la HATVP pour les activités conservées pendant le mandat et les autres mandats électifs, sur la dernière année renseignée. L'indemnité de député n'est pas comptée. Pâle = aucun revenu déclaré.",
    kind: 'rampe',
    value: (d) => (d.revenusAnnexes == null ? null : d.revenusAnnexes <= 0 ? 0 : clamp(Math.log10(1 + d.revenusAnnexes / 1000) / Math.log10(201))),
    legende: ['0 €', '200 000 € et plus'],
    source: HATVP,
  },
  {
    id: 'participations',
    label: 'Participations',
    titre: 'Qui détient des parts de sociétés',
    intro: "Valeur totale des participations dans des sociétés déclarées à la HATVP (actions, parts sociales), telle que chaque député l'a évaluée. Pâle = aucune participation déclarée.",
    kind: 'rampe',
    value: (d) => (d.participationsTotal == null ? null : d.participationsTotal <= 0 ? 0 : clamp(Math.log10(1 + d.participationsTotal / 100) / Math.log10(100001))),
    legende: ['0 €', '10 M€ et plus'],
    source: HATVP,
  },
];

export const viewById = (id: string) => VIEWS.find((v) => v.id === id) ?? VIEWS[0];
