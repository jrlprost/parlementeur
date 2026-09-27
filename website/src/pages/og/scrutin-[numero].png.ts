import type { APIRoute } from 'astro';
import { load, readOptional, fmtDate, fmtInt, type Scrutin, type ScrutinIndex } from '../../lib/data';
import { scrutinFillsHex } from '../../lib/scrutin';
import { VOTE } from '../../lib/colors';
import { frame, hemicycleSvg, textBlock, wrap, toPng, pngResponse, INK, ink } from '../../lib/og';

export function getStaticPaths() {
  const idx = readOptional<ScrutinIndex[]>('scrutins.json') ?? [];
  return idx.filter((s) => s.solennel || s.motion).map((s) => ({ params: { numero: String(s.numero) } }));
}

export const GET: APIRoute = ({ params }) => {
  const { deputes } = load();
  const s = readOptional<Scrutin>(`scrutins/${params.numero}.json`)!;
  const hemi = hemicycleSvg(scrutinFillsHex(s, deputes), 640, 160, 500);

  const title = wrap(s.titre, 34, 520, 0.47, 4);
  const titleH = title.length * 34 * 1.15;
  const y = 196 + titleH + 40;
  const verdict = s.adopte ? 'Adopté' : 'Rejeté';
  const nums: [string, string, string][] = [
    [fmtInt(s.pour), 'pour', VOTE.pour],
    [fmtInt(s.contre), 'contre', VOTE.contre],
    [fmtInt(s.abstention), 'abstentions', VOTE.abstention],
  ];
  const inner = `
    <text x="64" y="150" font-family="Public Sans" font-weight="600" font-size="18" fill="${ink(0.62)}">Scrutin n° ${s.numero} · ${fmtDate(s.date)}</text>
    ${textBlock(title, 64, 196, 34, 1.15, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${y + 20}" font-family="Spectral" font-weight="600" font-size="46" fill="${s.adopte ? VOTE.pour : VOTE.contre}">${verdict}</text>
    ${nums
      .map(
        ([n, l, c], i) => `
      <text x="${64 + i * 170}" y="${y + 84}" font-family="Spectral" font-weight="600" font-size="40" fill="${c}">${n}</text>
      <text x="${64 + i * 170}" y="${y + 110}" font-family="Public Sans" font-size="17" fill="${ink(0.62)}">${l}</text>`,
      )
      .join('')}
    ${hemi.svg}
    <text x="890" y="${160 + hemi.height + 34}" text-anchor="middle" font-family="Public Sans" font-size="18" fill="${ink(0.62)}">Qui a voté quoi : le détail par député</text>`;
  return pngResponse(toPng(frame(inner, { kicker: 'Assemblée nationale', source: 'Source : Assemblée nationale, analyse du scrutin' })));
};
