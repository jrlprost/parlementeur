import type { APIRoute } from 'astro';
import { readOptional } from '../../lib/data';
import { layoutHemicycle } from '../../lib/hemicycle';
import { frame, toPng, pngResponse, INK, ink, esc } from '../../lib/og';

const COLORS: Record<string, string> = {
  communiste: '#9E1B1B', 'gauche-radicale': '#CC2443', socialiste: '#F08DA9', ecologiste: '#3A9D4F', 'centre-gauche': '#E7B8C8',
  divers: '#D8B545', centre: '#F08A24', droite: '#2A5DB8', 'extreme-droite': '#0D2B52', 'non-inscrits': '#9A9A9A', vacant: '#E4E4E0',
};

// Six législatures clés en petits hémicycles : 1958, 1981, 1986, 2002, 2017, 2024.
export const GET: APIRoute = () => {
  const legs = readOptional<{ numero: number; election: string; sieges: number; groupes: { sieges: number; famille: string }[] }[]>('legislatures.json') ?? [];
  const pick = [1, 7, 8, 12, 15, 17].map((n) => legs.find((l) => l.numero === n)).filter(Boolean) as typeof legs;
  const cells = pick
    .map((l, i) => {
      const L = layoutHemicycle(l.sieges, { radius: 100 });
      const fills: string[] = [];
      for (const g of l.groupes) for (let k = 0; k < g.sieges; k++) fills.push(COLORS[g.famille] ?? '#9A9A9A');
      const x0 = 90 + (i % 3) * 360, y0 = 160 + Math.floor(i / 3) * 196;
      const k = 250 / L.width;
      const dots = L.seats.map((s, j) => `<circle cx="${(x0 + s.x * k).toFixed(1)}" cy="${(y0 + s.y * k).toFixed(1)}" r="${(L.dot * k).toFixed(2)}" fill="${fills[j] ?? '#9A9A9A'}"/>`).join('');
      return `${dots}<text x="${x0 + 125}" y="${y0 + L.height * k + 24}" text-anchor="middle" font-family="Public Sans" font-weight="600" font-size="18" fill="${INK}">${esc(new Date(l.election).getFullYear().toString())}</text>`;
    })
    .join('');
  const inner = `<text x="64" y="138" font-family="Spectral" font-weight="600" font-size="30" fill="${INK}">L'hémicycle de 1958 à aujourd'hui</text>${cells}`;
  return pngResponse(toPng(frame(inner, { kicker: 'Depuis 1958', source: 'Sources : Assemblée nationale, composition au début de chaque législature' })));
};
