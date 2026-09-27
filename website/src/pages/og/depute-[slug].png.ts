import type { APIRoute } from 'astro';
import { load, fmtPct, fmtEur } from '../../lib/data';
import { mix, THEME } from '../../lib/colors';
import { frame, hemicycleSvg, textBlock, wrap, toPng, pngResponse, INK, ink, esc } from '../../lib/og';

export function getStaticPaths() {
  return load().deputes.map((d) => ({ params: { slug: d.slug } }));
}

export const GET: APIRoute = ({ params }) => {
  const { deputes, groupes } = load();
  const d = deputes.find((x) => x.slug === params.slug)!;
  const g = groupes.find((x) => x.sigle === d.groupe);
  const col = g?.couleur ?? '#9A9A9A';
  const idx = deputes.indexOf(d);
  const ghost = mix(THEME.light.bg, THEME.light.ink, 0.08);
  const fills = deputes.map((x) => (x.groupe === d.groupe ? mix(col, THEME.light.bg, 0.55) : ghost));
  fills[idx] = col;
  const hemi = hemicycleSvg(fills, 660, 170, 480, idx);

  const name = wrap(`${d.prenom} ${d.nom}`, 58, 540, 0.47, 2);
  const nameH = name.length * 58 * 1.05;
  const sub = wrap(`${g?.nom ?? d.groupe}${d.circonscription ? ' · ' + d.circonscription : ''}`, 22, 540, 0.52, 2);
  const kpis: [string, string][] = [
    [d.participation != null ? fmtPct(d.participation) : '–', 'des scrutins votés'],
    [d.loyaute != null ? fmtPct(d.loyaute) : '–', 'alignés sur le groupe'],
    [d.revenusAnnexes != null ? (d.revenusAnnexes > 0 ? fmtEur(d.revenusAnnexes) : '0 €') : '–', 'revenus annexes déclarés'],
  ];
  const ky = 190 + nameH + sub.length * 30 + 70;
  const inner = `
    <circle cx="72" cy="150" r="8" fill="${col}"/>
    <text x="90" y="157" font-family="Public Sans" font-weight="600" font-size="20" fill="${ink(0.8)}">${esc(d.groupe)}</text>
    ${textBlock(name, 64, 190 + 42, 58, 1.05, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    ${textBlock(sub, 64, 190 + nameH + 30, 22, 1.35, `font-family="Public Sans" fill="${ink(0.8)}"`)}
    ${kpis
      .map(
        ([v, l], i) => `
      <rect x="${64 + i * 188}" y="${ky - 44}" width="170" height="2" fill="${INK}"/>
      <text x="${64 + i * 188}" y="${ky}" font-family="Spectral" font-weight="600" font-size="36" fill="${INK}">${esc(v)}</text>
      <text x="${64 + i * 188}" y="${ky + 28}" font-family="Public Sans" font-size="16" fill="${ink(0.62)}">${esc(l)}</text>`,
      )
      .join('')}
    ${hemi.svg}
    <text x="900" y="${170 + hemi.height + 34}" text-anchor="middle" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">Votes, intérêts et parcours sur la fiche</text>`;
  return pngResponse(toPng(frame(inner, { kicker: d.femme ? 'Députée' : 'Député', source: 'Sources : Assemblée nationale, HATVP' })));
};
