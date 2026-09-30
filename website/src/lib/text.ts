// Mise en forme des noms publiés en capitales (répertoire HATVP, déclarations) : « FEDERATION NATIONALE DES
// SYNDICATS D'EXPLOITANTS AGRICOLES (FNSEA) » → « Fédération… des syndicats… (FNSEA) », sans casser les sigles.
const SMALL = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'pour', 'sur', 'par', 'a', 'à', 'dans', 'sous', 'ou', 'un', 'une', "d'", "l'"]);

// Mots courts qui ne sont pas des sigles.
const WORDS = new Set(['que', 'qui', 'nos', 'vos', 'ses', 'mon', 'ton', 'son', 'bio', 'art', 'eau', 'air', 'vie', 'sol', 'mer']);
const isSigle = (w: string) => w.length <= 3 && !SMALL.has(w.toLowerCase()) && !WORDS.has(w.toLowerCase());

const KNOWN: Record<string, string> = { TOTALENERGIES: 'TotalEnergies', LOREAL: "L'Oréal", "L'OREAL": "L'Oréal", BNP: 'BNP' };

export function orgName(s: string): string {
  const k = s?.trim().replace(/\s+(SE|SA|SAS)$/, '');
  if (k && KNOWN[k]) return KNOWN[k];
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  const words = s.trim().split(/\s+/);
  // Un seul mot court : c'est un sigle (FNSEA, MEDEF, SNCF).
  if (words.length === 1 && words[0].length <= 6) return s;
  let inParen = false;
  return words
    .map((w, i) => {
      if (w.startsWith('(')) inParen = true;
      const keep = inParen || /\d/.test(w) || (isSigle(w) && !/^[A-Z]'/.test(w));
      if (w.endsWith(')')) inParen = false;
      if (keep) return w;
      const low = w.toLowerCase();
      if (i > 0 && SMALL.has(low)) return low;
      // D'EXPLOITANTS → d'Exploitants ; L'INDUSTRIE → l'Industrie.
      const m = low.match(/^([dl]['’])(.+)$/);
      if (m) return (i > 0 ? m[1] : m[1].toUpperCase()) + m[2].charAt(0).toUpperCase() + m[2].slice(1);
      // Segments de trait d'union : UFC-QUE CHOISIR → UFC-Que Choisir.
      return w.split('-').map((seg) => (isSigle(seg) && w.includes('-') ? seg : seg.charAt(0) + seg.slice(1).toLowerCase())).join('-');
    })
    .join(' ');
}

/** Accord simple : 1 amendement adopté, 2 amendements adoptés. */
export const plural = (n: number, one: string, many: string) => (Math.abs(n) >= 2 ? many : one);
