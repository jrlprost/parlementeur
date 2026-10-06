import type { APIRoute } from 'astro';
import { fmtInt } from '../../../lib/data';
import { lobbying, org, budget } from '../../../lib/lobbying';
import { INST_HEX } from '../../../lib/og-lobbying';
import { orgName } from '../../../lib/text';
import { frame, textBlock, wrap, toPng, pngResponse, hbars, INK, ink, esc } from '../../../lib/og';

export function getStaticPaths() {
  return (lobbying()?.orgs ?? []).map(([slug]) => ({ params: { slug } }));
}

export const GET: APIRoute = ({ params }) => {
  const l = lobbying()!;
  const o = org(params.slug!)!;
  const INST = Object.fromEntries(l.institutions.map((i) => [i.code, i.nom]));
  const FAM = Object.fromEntries(l.familles.map((f) => [f.code, f.nom]));
  // Les noms longs passent sur trois lignes, en plus petit, plutôt que d'être tronqués.
  const full = orgName(o.nom);
  const fs = full.length > 60 ? 36 : full.length > 28 ? 44 : 54;
  const name = wrap(full, fs, 540, 0.5, fs === 54 ? 2 : 3);
  const nameH = name.length * fs * 1.05;
  const counts = new Map<string, number>();
  o.actions.forEach((a) => a.cibles.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
  const inst = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const mins = new Map<string, number>();
  o.actions.forEach((a) => a.ministeres.forEach((m) => mins.set(m, (mins.get(m) ?? 0) + 1)));
  const topMin = [...mins.entries()].filter(([m]) => m !== 'Autre ministère').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m);
  const elus = new Set(o.liens.auditions.flatMap((a) => a.deputes)).size + new Set(o.liens.ministres.map((m) => m.ministre)).size;
  const kpis: [string, string][] = [
    [fmtInt(o.actions.length), 'actions déclarées'],
    [budget(o.depense) ?? '–', 'budget annuel'],
    [String(elus), 'élus nommés'],
  ];
  const ky = 200 + nameH + 90;
  const inner = `
    <text x="64" y="157" font-family="Public Sans" font-weight="600" font-size="20" fill="${ink(0.8)}">${esc(FAM[o.famille] ?? '')}</text>
    ${textBlock(name, 64, 230, fs, 1.05, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    ${kpis
      .map(([v, k], i) => `
      <rect x="${64 + i * 180}" y="${ky - 44}" width="164" height="2" fill="${INK}"/>
      <text x="${64 + i * 180}" y="${ky}" font-family="Spectral" font-weight="600" font-size="${v.length > 9 ? 24 : 36}" fill="${INK}">${esc(v)}</text>
      <text x="${64 + i * 180}" y="${ky + 28}" font-family="Public Sans" font-size="16" fill="${ink(0.62)}">${esc(k)}</text>`)
      .join('')}
    <text x="680" y="160" font-family="Public Sans" font-weight="700" font-size="16" letter-spacing="1.4" fill="${ink(0.62)}">QUI ILS VISENT</text>
    ${hbars(inst.map(([c, n]) => ({ label: INST[c], value: n, display: fmtInt(n), color: INST_HEX[c] })), 680, 200, 460, 58)}
    ${topMin.length ? textBlock(wrap(`Ministères : ${topMin.join(', ')}`, 17, 450, 0.52, 2), 680, 200 + inst.length * 58 + 22, 17, 1.4, `font-family="Public Sans" fill="${ink(0.62)}"`) : ''}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Lobbying', source: "Sources : HATVP, Assemblée nationale, agendas ministériels" })));
};
