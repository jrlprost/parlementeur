import type { APIRoute } from 'astro';
import { VIEWS, viewById } from '../../lib/views';
import { load } from '../../lib/data';
import { fillHex, headline } from '../../lib/stats';
import { frame, hemicycleSvg, textBlock, wrap, toPng, pngResponse, INK, ink } from '../../lib/og';

export function getStaticPaths() {
  return VIEWS.map((v) => ({ params: { id: v.id } }));
}

export const GET: APIRoute = ({ params }) => {
  const { deputes, groupes, meta } = load();
  const v = viewById(params.id!);
  const fills = deputes.map((d) => fillHex(v.id, d, groupes));
  const h = headline(v.id, deputes, groupes);
  const hemi = hemicycleSvg(fills, 610, 150, 540);

  const title = wrap(v.titre, 50, 480, 0.47, 3);
  const label = wrap(h.label, 22, 480, 0.52, 3);
  const titleH = title.length * 50 * 1.08;
  const inner = `
    ${textBlock(title, 64, 190, 50, 1.08, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${190 + titleH + 72}" font-family="Spectral" font-weight="600" font-size="84" fill="${INK}">${h.big}</text>
    ${textBlock(label, 64, 190 + titleH + 112, 22, 1.35, `font-family="Public Sans" fill="${ink(0.8)}"`)}
    ${hemi.svg}
    <text x="880" y="${150 + hemi.height + 36}" text-anchor="middle" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">Chaque point est un député · ${meta.legislature}e législature</text>`;
  return pngResponse(toPng(frame(inner, { kicker: 'Assemblée nationale', source: `Source : ${v.source.label}` })));
};
