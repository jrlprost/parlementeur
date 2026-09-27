import type { APIRoute } from 'astro';
import { readOptional, fmtInt, fmtDate } from '../../lib/data';
import type { Lobbying } from '../../lib/lobbying';
import { RAMP } from '../../lib/colors';
import { frame, textBlock, wrap, toPng, pngResponse, INK, ink, esc } from '../../lib/og';

export const GET: APIRoute = () => {
  const l = readOptional<Lobbying>('lobbying.json')!;
  const doms = l.domaines.slice(0, 6);
  const max = doms[0].n;
  const title = wrap('Qui cherche à influencer les parlementaires', 44, 500, 0.47, 3);
  const bars = doms
    .map((d, i) => {
      const y = 160 + i * 58;
      const w = (d.n / max) * 330;
      return `<text x="640" y="${y}" font-family="Public Sans" font-weight="600" font-size="18" fill="${INK}">${esc(d.nom)}</text>
        <rect x="640" y="${y + 10}" width="${w.toFixed(1)}" height="16" rx="2" fill="${RAMP.light.to}"/>
        <text x="${(648 + w).toFixed(1)}" y="${y + 24}" font-family="Public Sans" font-size="16" fill="${ink(0.62)}">${fmtInt(d.n)}</text>`;
    })
    .join('');
  const inner = `
    ${textBlock(title, 64, 190, 44, 1.1, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="${190 + title.length * 48 + 64}" font-family="Spectral" font-weight="600" font-size="80" fill="${INK}">${fmtInt(l.actions)}</text>
    ${textBlock(wrap(`actions déclarées par ${fmtInt(l.organisations)} organisations depuis le ${fmtDate(l.depuis)}`, 22, 500, 0.52, 3), 64, 190 + title.length * 48 + 104, 22, 1.35, `font-family="Public Sans" fill="${ink(0.8)}"`)}
    ${bars}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Lobbying', source: "Source : HATVP, répertoire des représentants d'intérêts" })));
};
