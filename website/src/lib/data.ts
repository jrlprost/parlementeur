// Chargement, au moment du build, des fichiers produits par le pipeline (database/dist).
import fs from 'node:fs';
import path from 'node:path';

export type Source = { label: string; url: string; date?: string };

export type Depute = {
  id: string;
  slug: string;
  prenom: string;
  nom: string;
  femme: boolean;
  naissance: string | null;
  age: number | null;
  groupe: string;
  departement: string | null;
  circonscription: string | null;
  profession: string | null;
  photo: string | null;
  legislatures: number | null;
  premiereElection: number | null;
  participation: number | null;
  participationSolennels: number | null;
  loyaute: number | null;
  votes: number | null;
  scrutinsPossibles?: number | null;
  commissions?: { convocations: number; presents: number; excuses: number; absents: number; minutes: number } | null;
  joursVote?: number;
  interventions?: number;
  partDelegation?: number | null;
  amendements: number;
  amendementsAdoptes: number;
  questions: number;
  revenusAnnexes: number | null;
  anneeRevenus: number | null;
  fonction: string | null;
  groupesSuccessifs?: number;
  place: string | null;
  urlAN: string;
  urlHATVP: string | null;
  participationsTotal?: number | null;
  participationsN?: number | null;
  directions?: number | null;
  /** Jours entre l'entrée en fonctions et le dépôt de la déclaration d'intérêts. */
  delaiDeclaration?: number | null;
  /** Début du mandat en cours (date de prise de fonction). */
  debut: string;
};

export type Groupe = {
  sigle: string;
  nom: string;
  couleur: string;
  effectif: number;
  ordre: number;
  urlAN?: string;
};

export type Meta = {
  legislature: number;
  generatedAt: string;
  sources: Record<string, Source & { records?: number }>;
};

const DIST = path.resolve(process.cwd(), '../database/dist');

function read<T>(file: string): T {
  const p = path.join(DIST, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Fichier de données manquant : ${p}. Lancez d'abord le pipeline (database/).`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

let cache: { deputes: Depute[]; groupes: Groupe[]; meta: Meta } | null = null;

export function load() {
  if (cache) return cache;
  const groupes = read<Groupe[]>('groupes.json').sort((a, b) => a.ordre - b.ordre);
  const order = new Map(groupes.map((g, i) => [g.sigle, i]));
  const deputes = read<Depute[]>('deputes.json').sort(
    (a, b) => (order.get(a.groupe) ?? 99) - (order.get(b.groupe) ?? 99) || a.nom.localeCompare(b.nom, 'fr'),
  );
  cache = { deputes, groupes, meta: read<Meta>('meta.json') };
  return cache;
}

export function readOptional<T>(file: string): T | null {
  const p = path.join(DIST, file);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : null;
}

export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
export const fmtInt = (n: number) => n.toLocaleString('fr-FR');
export const fmtEur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const fmtPct = (x: number) => `${Math.round(x * 100)} %`;

export type VoteCode = 'pour' | 'contre' | 'abstention' | 'absent';

export type DeputeDetail = Depute & {
  mandats: { legislature: number; debut: string; fin: string | null; circonscription: string | null }[];
  groupesHistorique: { sigle: string; nom: string; debut: string; fin: string | null }[];
  interets: {
    date: string;
    url: string;
    activites: { description: string; employeur: string | null; montants: { annee: number; montant: number }[] }[];
    participations: { societe: string; evaluation: number | null; parts: string | null; identifiable?: boolean; lobby?: { nom: string; actions: number; domaines: string[]; fiche: string } }[];
    mandatsElectifs: { description: string; montants: { annee: number; montant: number }[] }[];
    depot: string | null;
    modifications: number;
  } | null;
  votesCles: { numero: number; date: string; titre: string; vote: VoteCode; ligneGroupe: VoteCode | null }[];
  dissidences: number | null;
  questionsRepondues: number;
  condamnations: { date: string; definitive_depuis: string | null; juridiction: string; faits: string; peine: string; precision?: string; source: Source }[];
  presidentielles: { annee: number; tour1: number | null; tour2: number | null; elu: boolean; source: string }[];
  elections: { annee: number; tour: number; pct: number | null; voix: number; nuance: string; participation: number | null; adversaires: { nom: string; nuance: string; pct: number | null }[]; source: string }[];
  sources: Source[];
  rencontres?: {
    rapporteur: { organisation: string; registre: string[]; etoile: boolean; rapports: { titre: string; url: string }[] }[];
    commissions: { total: number; avecLobby: { date: string; organe: string; texte: string; registre: string[] }[] };
    amendements: { texte: string; n: number; groupes: number; exemple: string }[];
    amendementsTotal: number;
    ministres?: { date: string; ministre: string; ministere: string; texte: string; url: string }[];
  };
};

export type ScrutinIndex = {
  numero: number;
  date: string;
  titre: string;
  type: string;
  solennel: boolean;
  motion: boolean;
  adopte: boolean;
  pour: number;
  contre: number;
  abstention: number;
  votants: number;
  url: string;
};

export type Scrutin = ScrutinIndex & {
  demandeur: string | null;
  /** Vote de chaque député, par identifiant AN. Les absents ne figurent pas. */
  votes: Record<string, 'p' | 'c' | 'a' | 'n'>;
  groupes: { sigle: string; pour: number; contre: number; abstention: number; nonVotants: number; position: string }[];
};
