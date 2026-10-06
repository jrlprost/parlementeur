import type { APIRoute } from 'astro';
import { load, readOptional, fmtInt } from '../../lib/data';
import { frame, textBlock, wrap, toPng, pngResponse, hbars, INK, ink } from '../../lib/og';
import { RAMP } from '../../lib/colors';

export const GET: APIRoute = () => {
  const { deputes } = load();
  const I = readOptional<{ societes: { nom: string; deputes: string[]; lobby: unknown }[] }>('interets.json')!;
  const holders = deputes.filter((d) => (d.participationsTotal ?? 0) > 0).length;
  const top = I.societes.filter((s) => s.deputes.length >= 3).slice(0, 6);
  const title = wrap('Ce que les députés détiennent et dirigent', 46, 520, 0.47, 3);
  const ty = 190 + title.length * 50;
  const inner = `
    ${textBlock(title, 64, 190, 46, 1.08, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${ty + 60}" font-family="Spectral" font-weight="600" font-size="80" fill="${INK}">${fmtInt(holders)}</text>
    ${textBlock(wrap(`députés déclarent des parts dans des sociétés, ${fmtInt(I.societes.filter((s) => s.lobby).length)} de ces sociétés font du lobbying`, 21, 520, 0.52, 3), 64, ty + 100, 21, 1.35, `font-family="Public Sans" fill="${ink(0.8)}"`)}
    <text x="660" y="160" font-family="Public Sans" font-weight="700" font-size="16" letter-spacing="1.4" fill="${ink(0.62)}">SOCIÉTÉS LES PLUS DÉTENUES</text>
    ${hbars(top.map((s) => ({ label: s.nom, value: s.deputes.length, display: `${s.deputes.length} députés`, color: RAMP.light.to })), 660, 200, 480, 52)}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Intérêts déclarés', source: "Source : HATVP, déclarations d'intérêts et d'activités" })));
};
