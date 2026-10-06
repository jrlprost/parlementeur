import type { APIRoute } from 'astro';
import { load, readOptional, fmtInt, type ScrutinIndex } from '../../lib/data';
import { lobbying } from '../../lib/lobbying';
import { frame, hemicycleSvg, textBlock, toPng, pngResponse, INK, ink, esc } from '../../lib/og';

// Accueil : le titre, l'hémicycle et trois chiffres qui mènent chacun vers un outil.
export const GET: APIRoute = () => {
  const { deputes, groupes } = load();
  const gcol = new Map(groupes.map((g) => [g.sigle, g.couleur]));
  const hemi = hemicycleSvg(deputes.map((d) => gcol.get(d.groupe) ?? '#9A9A9A'), 640, 150, 500);
  const n = (readOptional<ScrutinIndex[]>('scrutins.json') ?? []).length;
  const l = lobbying();
  const tiles: [string, string][] = [
    [fmtInt(deputes.length), 'députés'],
    [fmtInt(n), 'votes à rejouer'],
    [fmtInt(l?.actions ?? 0), 'actions de lobbying'],
  ];
  const inner = `
    ${textBlock(['Ce que font', 'vos élus'], 64, 225, 72, 1.02, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="345" font-family="Public Sans" font-size="23" fill="${ink(0.8)}">En chiffres, et chaque chiffre avec sa source.</text>
    ${tiles
      .map(([v, k], i) => `
      <rect x="${64 + i * 182}" y="400" width="168" height="120" rx="14" fill="${ink(0.05)}" stroke="${ink(0.16)}"/>
      <text x="${82 + i * 182}" y="456" font-family="Spectral" font-weight="600" font-size="38" fill="${INK}">${esc(v)}</text>
      <text x="${82 + i * 182}" y="490" font-family="Public Sans" font-size="16" fill="${ink(0.62)}">${esc(k)}</text>`)
      .join('')}
    ${hemi.svg}
    <text x="890" y="${150 + hemi.height + 40}" text-anchor="middle" font-family="Public Sans" font-weight="600" font-size="20" fill="${ink(0.8)}">Trouvez votre député par code postal</text>`;
  return pngResponse(toPng(frame(inner, { kicker: 'Élus · votes · lobbying', source: 'Données publiques officielles, mises à jour chaque nuit' })));
};
