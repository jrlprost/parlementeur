export type Lobbying = {
  depuis: string;
  organisations: number;
  actions: number;
  domaines: { nom: string; n: number }[];
  categories: { nom: string; n: number; depenseMin: number }[];
  decisions: { nom: string; n: number }[];
  beneficiaires: { nom: string; n: number; via: string[] }[];
  top: Org[];
  gros: Org[];
  recentes: { organisation: string; objet: string; date: string; domaines: string[]; actions: string[] }[];
  source: string;
};
type Org = { nom: string; categorie: string; activites: number; depense: string | null; depenseMin: number; domaines: string[]; site: string | null; fiche: string; derniere: string | null };
