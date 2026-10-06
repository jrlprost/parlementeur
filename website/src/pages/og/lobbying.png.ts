import type { APIRoute } from 'astro';
import { fmtInt, fmtDate } from '../../lib/data';
import { lobbying } from '../../lib/lobbying';
import { INST_HEX } from '../../lib/og-lobbying';
import { frame, textBlock, wrap, toPng, pngResponse, hbars, INK, ink } from '../../lib/og';

export const GET: APIRoute = () => {
  const l = lobbying()!;
  const title = wrap('Qui cherche à influencer les décideurs publics', 46, 520, 0.47, 3);
  const ty = 190 + title.length * 50;
  const inst = l.institutions.filter((i) => i.n > 0).sort((a, b) => b.n - a.n).slice(0, 6);
  const inner = `
    ${textBlock(title, 64, 190, 46, 1.08, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${ty + 60}" font-family="Spectral" font-weight="600" font-size="84" fill="${INK}">${fmtInt(l.actions)}</text>
    ${textBlock(wrap(`actions déclarées par ${fmtInt(l.organisations)} organisations depuis le ${fmtDate(l.depuis)}`, 22, 520, 0.52, 2), 64, ty + 100, 22, 1.35, `font-family="Public Sans" fill="${ink(0.8)}"`)}
    <text x="660" y="160" font-family="Public Sans" font-weight="700" font-size="16" letter-spacing="1.4" fill="${ink(0.62)}">QUI EST VISÉ</text>
    ${hbars(inst.map((i) => ({ label: i.nom, value: i.n, display: fmtInt(i.n), color: INST_HEX[i.code] })), 660, 200, 480, 58)}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Lobbying', source: "Source : HATVP, répertoire des représentants d'intérêts" })));
};
