import type { APIRoute } from 'astro';
import { load, readOptional } from '../../lib/data';
import { frame, textBlock, wrap, toPng, pngResponse, INK, ink, esc } from '../../lib/og';

type Prox = { groupes: string[]; accord: number[][]; scrutins: number[][]; carte: { points: Record<string, [number, number]> } };

export const GET: APIRoute = () => {
  const p = readOptional<Prox>('proximite.json')!;
  const { deputes, groupes } = load();
  const gcol = new Map(groupes.map((g) => [g.sigle, g.couleur]));
  const grp = new Map(deputes.map((d) => [d.slug, d.groupe]));
  // Carte des votes, à droite.
  const X = (v: number) => 640 + ((v + 1) / 2) * 500, Y = (v: number) => 470 - ((v + 1) / 2) * 330;
  const dots = Object.entries(p.carte.points).map(([s, [x, y]]) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="4" fill="${gcol.get(grp.get(s) ?? '') ?? '#999'}" fill-opacity=".8"/>`).join('');
  // Deux faits : les deux groupes distincts les plus proches, et les plus éloignés.
  const pairs: [string, string, number][] = [];
  p.groupes.forEach((a, i) => p.groupes.forEach((b, j) => { if (i < j && p.scrutins[i][j] >= 200 && a !== 'NI' && b !== 'NI') pairs.push([a, b, p.accord[i][j]]); }));
  pairs.sort((a, b) => b[2] - a[2]);
  const best = pairs[0], worst = pairs[pairs.length - 1];
  const pc = (x: number) => `${Math.round(x * 100)} %`;
  const title = wrap('Qui vote avec qui', 58, 520, 0.47, 2);
  const inner = `
    ${textBlock(title, 64, 220, 58, 1.05, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${230 + title.length * 62}" font-family="Public Sans" font-size="21" fill="${ink(0.8)}">La carte de tous les votes de l'Assemblée</text>
    <text x="64" y="400" font-family="Spectral" font-weight="600" font-size="44" fill="${INK}">${pc(best[2])}</text>
    <text x="64" y="430" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">${esc(`${best[0]} et ${best[1]} votent pareil`)}</text>
    <text x="330" y="400" font-family="Spectral" font-weight="600" font-size="44" fill="${INK}">${pc(worst[2])}</text>
    <text x="330" y="430" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">${esc(`${worst[0]} et ${worst[1]}, au plus loin`)}</text>
    ${dots}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Votes', source: 'Source : Assemblée nationale, scrutins publics' })));
};
