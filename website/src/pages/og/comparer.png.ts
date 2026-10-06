import type { APIRoute } from 'astro';
import { frame, textBlock, toPng, pngResponse, INK, ink } from '../../lib/og';
import { VOTE, RAMP } from '../../lib/colors';

export const GET: APIRoute = () => {
  const person = (x: number) => `<g transform="translate(${x} 170) scale(5)" fill="none" stroke="${RAMP.light.to}" stroke-width="1.3" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 21a7 7 0 0 1 14 0"/></g>`;
  const inner = `
    ${textBlock(['Comparer', 'deux députés'], 64, 230, 64, 1.05, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    <text x="64" y="380" font-family="Public Sans" font-size="23" fill="${ink(0.8)}">Votent-ils pareil ? Tous leurs votes, scrutin par scrutin.</text>
    <rect x="64" y="430" width="300" height="24" rx="4" fill="${VOTE.pour}"/><rect x="364" y="430" width="70" height="24" fill="${VOTE.abstention}"/><rect x="434" y="430" width="120" height="24" rx="4" fill="${VOTE.contre}"/>
    <text x="64" y="484" font-family="Public Sans" font-size="17" fill="${ink(0.62)}">identiques · partiels · opposés</text>
    ${person(650)}${person(950)}
    <g stroke="${INK}" stroke-width="4" stroke-linecap="round" fill="none"><path d="M800 228h120l-16-16M920 262h-120l16 16"/></g>`;
  return pngResponse(toPng(frame(inner, { kicker: 'Votes', source: 'Source : Assemblée nationale, scrutins publics' })));
};
