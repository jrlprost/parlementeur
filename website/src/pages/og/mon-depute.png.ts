import type { APIRoute } from 'astro';
import { load } from '../../lib/data';
import { frame, hemicycleSvg, textBlock, toPng, pngResponse, INK, ink } from '../../lib/og';
import { RAMP } from '../../lib/colors';

export const GET: APIRoute = () => {
  const { deputes, groupes } = load();
  const gcol = new Map(groupes.map((g) => [g.sigle, g.couleur]));
  const hemi = hemicycleSvg(deputes.map((d) => gcol.get(d.groupe) ?? '#9A9A9A'), 660, 170, 480);
  const pin = `<g transform="translate(64 380) scale(3.2)" fill="none" stroke="${RAMP.light.to}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.5s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11.2-6.5 11.2z"/><circle cx="12" cy="10.2" r="2.4"/></g>`;
  const inner = `
    ${textBlock(['Qui me représente', "à l'Assemblée ?"], 64, 220, 60, 1.05, `font-family="Spectral" font-weight="600" fill="${INK}"`)}
    ${pin}
    <rect x="170" y="408" width="400" height="64" rx="32" fill="${'#FFFFFF'}" stroke="${ink(0.62)}" stroke-width="2"/>
    <text x="200" y="449" font-family="Public Sans" font-size="24" fill="${ink(0.62)}">Votre code postal</text>
    ${hemi.svg}
    <text x="900" y="${170 + hemi.height + 40}" text-anchor="middle" font-family="Public Sans" font-size="19" fill="${ink(0.8)}">Ses votes, sa présence, ses intérêts</text>`;
  return pngResponse(toPng(frame(inner, { kicker: 'Mon député', source: "Sources : ministère de l'Intérieur, La Poste, Assemblée nationale" })));
};
