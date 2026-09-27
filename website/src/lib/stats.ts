// Chiffres clés calculés sur l'ensemble des députés, partagés entre les pages et les images de partage.
import type { Depute, Groupe } from './data';
import { viewById } from './views';
import { RAMP, mix, THEME } from './colors';

export const median = (xs: number[]) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Couleur d'un siège en thème clair, en hexadécimal (pour les images de partage). */
export function fillHex(viewId: string, d: Depute, groupes: Groupe[]): string {
  const v = viewById(viewId);
  if (v.kind === 'groupe') return groupes.find((g) => g.sigle === d.groupe)?.couleur ?? '#9A9A9A';
  const x = v.value!(d);
  const ghost = mix(THEME.light.bg, THEME.light.ink, 0.08);
  if (x == null) return ghost;
  if (v.kind === 'binaire') return x ? RAMP.light.to : mix(THEME.light.bg, THEME.light.ink, 0.16);
  return mix(RAMP.light.from, RAMP.light.to, x as number);
}

/** Phrase-titre et chiffre clé de chaque vue. */
export function headline(viewId: string, deputes: Depute[], groupes: Groupe[]): { big: string; label: string } {
  const n = deputes.length;
  switch (viewId) {
    case 'age': {
      const m = median(deputes.map((d) => d.age!).filter((x) => x != null));
      return { big: `${Math.round(m ?? 0)} ans`, label: "d'âge médian dans l'hémicycle" };
    }
    case 'femmes': {
      const f = deputes.filter((d) => d.femme).length;
      return { big: `${Math.round((f / n) * 100)} %`, label: `de femmes, soit ${f} députées sur ${n}` };
    }
    case 'participation': {
      const xs = deputes.map((d) => d.participation).filter((x): x is number => x != null);
      const m = median(xs) ?? 0;
      return { big: `${Math.round(m * 100)} %`, label: 'des scrutins votés par le député médian. Qui fait mieux, qui fait moins bien ?' };
    }
    case 'solennels': {
      const xs = deputes.map((d) => d.participationSolennels).filter((x): x is number => x != null);
      const low = xs.filter((x) => x < 0.75).length;
      return { big: `${low}`, label: 'députés ont manqué plus d’un vote solennel sur quatre' };
    }
    case 'loyaute': {
      const xs = deputes.map((d) => d.loyaute).filter((x): x is number => x != null);
      const m = median(xs);
      return { big: `${Math.round((m ?? 0) * 100)} %`, label: 'des votes suivent la ligne du groupe (médiane)' };
    }
    case 'anciennete': {
      const first = deputes.filter((d) => d.legislatures === 1).length;
      return { big: `${first}`, label: `députés sur ${n} effectuent leur premier mandat` };
    }
    case 'revenus': {
      const k = deputes.filter((d) => (d.revenusAnnexes ?? 0) > 0).length;
      return { big: `${k}`, label: `députés déclarent des revenus en plus de leur mandat` };
    }
    default: {
      const top = [...groupes].sort((a, b) => b.effectif - a.effectif)[0];
      return { big: `${groupes.length} groupes`, label: `pour ${n} sièges. Le plus nombreux : ${top.sigle}, ${top.effectif} sièges` };
    }
  }
}
