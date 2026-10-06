// Répertoire des représentants d'intérêts (HATVP) tel que publié par le pipeline (database/src/parlementeur/lobbying.py).
import { readOptional } from './data';

export type N = { nom: string; n: number };
export type OrgTop = { slug: string; nom: string; actions: number; depense: string | null; depenseMin: number; famille: string };

export type Lobbying = {
  depuis: string;
  organisations: number;
  actions: number;
  actionsParlement: number;
  institutions: { code: string; nom: string; n: number }[];
  familles: { code: string; nom: string; organisations: number; actions: number }[];
  flux: { de: string; vers: string; n: number }[];
  ministeres: N[];
  autorites: N[];
  domaines: N[];
  moyens: N[];
  decisions: N[];
  trimestres: { t: string; n: number }[];
  top: OrgTop[];
  topFamilles: Record<string, OrgTop[]>;
  gros: OrgTop[];
  beneficiaires: { nom: string; n: number; via: string[] }[];
  registre: string[];
  /** [slug, nom, famille, actions, élus nommés, budget annuel déclaré (borne basse)] */
  orgs: [string, string, string, number, number, number][];
  liens: { auditions: number; commissions: number; ministres: number; detenteurs: number; organisationsReliees: number };
  agendas: { sources: Record<string, { label: string; url: string; records: number; dernier?: string | null }>; rencontres: number; avecOrganisation: number; avecDepute: number };
  source: string;
};

export type Action = {
  date: string;
  objet: string;
  domaines: string[];
  cibles: string[];
  ministeres: string[];
  autorites: string[];
  moyens: string[];
  decisions: string[];
  tiers: string[];
  fiche: string | null;
};

export type Org = {
  slug: string;
  nom: string;
  nomLong: string | null;
  denomination: string;
  siren: string | null;
  categorie: string;
  famille: string;
  secteurs: string[];
  ville: string | null;
  site: string | null;
  fiche: string;
  dirigeants: { nom: string; fonction: string | null }[];
  affiliations: { nom: string; slug: string | null }[];
  clients: string[];
  exercices: { debut: string; fin: string; depense: string | null; depenseMin: number; salaries: number | null; activites: number }[];
  depense: string | null;
  depenseMin: number;
  salaries: number | null;
  actions: Action[];
  nommes: number;
  liens: {
    auditions: { date: string | null; titre: string; url: string; deputes: string[]; qui: string }[];
    commissions: { date: string; organe: string; texte: string; presents: string[] }[];
    ministres: { date: string; heure: string | null; ministre: string; ministere: string; texte: string; url: string }[];
    detenteurs: string[];
  };
};

// Couleurs des institutions visées : lisibles sur fond clair comme sombre.
export const INST_COLORS: Record<string, string> = {
  parlement: 'var(--ramp-to)',
  gouvernement: '#2A5DB8',
  elysee: '#8F7CC4',
  hauts: '#5E7FA8',
  administration: '#1B8A8C',
  autorites: '#C9A227',
  local: '#F08A24',
};

export const FAM_COLORS: Record<string, string> = {
  entreprises: '#2A5DB8',
  federations: 'var(--ramp-to)',
  associations: '#3A9D4F',
  cabinets: '#8F7CC4',
  autres: '#9A9A9A',
};

export const lobbying = () => readOptional<Lobbying>('lobbying.json');
export const org = (slug: string) => readOptional<Org>(`lobbying/orgs/${slug}.json`);

/** « ≥ 3 500 000 € et < 3 750 000 € » → « 3,5 à 3,75 M€ » ; « < 10 000 € » → « moins de 10 k€ ». */
export function budget(s: string | null): string | null {
  if (!s) return null;
  const nums = [...s.matchAll(/\d[\d\s  ]*/g)].map((m) => Number(m[0].replace(/\D/g, ''))).filter((n) => n > 0);
  const u = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M€` : `${Math.round(n / 1000).toLocaleString('fr-FR')} k€`);
  if (s.trim().startsWith('<') && nums.length) return `moins de ${u(nums[0])}`;
  if (nums.length >= 2) {
    const [a, b] = nums;
    const same = (a >= 1e6) === (b >= 1e6);
    return same ? `${u(a).replace(/ (M|k)€$/, '')} à ${u(b)}` : `${u(a)} à ${u(b)}`;
  }
  return nums.length ? `${u(nums[0])} et plus` : s;
}
