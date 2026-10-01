// Visuels des tuiles de l'accueil : mini-graphiques tirés des vraies données, et pictogrammes au trait.
// Tout est en SVG, rendu au build : aucune image à charger.
import { layoutHemicycle } from './hemicycle';

const f1 = (x: number) => x.toFixed(1);

/** Hémicycle miniature, un point par siège, dans l'ordre et la couleur des groupes. */
export function miniHemicycle(fills: string[]): string {
  const L = layoutHemicycle(fills.length, { radius: 100 });
  const dots = L.seats.map((s, i) => `<circle cx="${f1(s.x)}" cy="${f1(s.y)}" r="${f1(L.dot)}" fill="${fills[i]}"/>`).join('');
  return `<svg viewBox="0 0 ${f1(L.width)} ${f1(L.height)}" aria-hidden="true">${dots}</svg>`;
}

/** Nuage de points (carte des votes) en miniature. */
export function miniMap(pts: { x: number; y: number; c: string }[]): string {
  const W = 200, H = 140, P = 6;
  const dots = pts.map((p) => `<circle cx="${f1(P + ((p.x + 1) / 2) * (W - 2 * P))}" cy="${f1(H - P - ((p.y + 1) / 2) * (H - 2 * P))}" r="1.9" fill="${p.c}" fill-opacity=".8"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${dots}</svg>`;
}

/** Derniers votes solennels : une barre par vote, part du « pour » (vert) et du « contre » (vermillon). */
export function miniVotes(rows: { pour: number; contre: number }[]): string {
  const W = 200, H = 90, n = rows.length, bw = W / n;
  const body = rows
    .map((r, i) => {
      const t = r.pour + r.contre || 1;
      const hp = (r.pour / t) * H;
      return `<rect x="${f1(i * bw + 1.5)}" y="0" width="${f1(bw - 3)}" height="${f1(hp)}" rx="2" fill="var(--vote-pour)"/><rect x="${f1(i * bw + 1.5)}" y="${f1(hp)}" width="${f1(bw - 3)}" height="${f1(H - hp)}" rx="2" fill="var(--vote-contre)"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--bg)" stroke-width="1.5" stroke-dasharray="3 3"/></svg>`;
}

/** Composition de chaque législature depuis 1958 : colonnes empilées par famille politique. */
export function miniHistory(cols: { color: string; share: number }[][]): string {
  const W = 200, H = 90, bw = W / cols.length;
  const body = cols
    .map((parts, i) => {
      let y = 0;
      return parts.map((p) => { const h = p.share * H; const r = `<rect x="${f1(i * bw + 1)}" y="${f1(y)}" width="${f1(bw - 2)}" height="${f1(h + 0.2)}" fill="${p.color}"/>`; y += h; return r; }).join('');
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;
}

/** Semaine type : une case par jour, foncée quand il y a séance publique. */
export function miniWeek(days: { label: string; seance: number; reunions: number }[]): string {
  const W = 200, H = 70, cw = W / days.length;
  const max = Math.max(...days.map((d) => d.seance + d.reunions), 1);
  const body = days
    .map((d, i) => {
      const t = Math.round(((d.seance + d.reunions) / max) * 100);
      return `<rect x="${f1(i * cw + 2)}" y="16" width="${f1(cw - 4)}" height="${H - 16}" rx="4" fill="color-mix(in srgb, var(--ramp-to) ${t}%, var(--ink-8))"/><text x="${f1(i * cw + cw / 2)}" y="11" text-anchor="middle" font-size="10" fill="var(--ink-62)" font-family="var(--sans)">${d.label}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;
}

// Pictogrammes au trait (24 × 24), dessinés pour Parlementeur.
const ICONS: Record<string, string> = {
  pin: '<path d="M12 21.5s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11.2-6.5 11.2z"/><circle cx="12" cy="10.2" r="2.4"/>',
  handshake: '<path d="M1.5 8.5h3l3.2-2h3.6l2.4 1.6"/><path d="M22.5 8.5h-3l-3.4 2.3"/><path d="M4.5 8.5v6.2l5.6 4.3c.8.6 1.8.6 2.5 0l6.9-5.8V8.5"/><path d="M13.7 8.1l-3.5 2.6c-.9.7-.6 2 .5 2.1 1 .1 2-.4 2.8-1l2.6-1.9"/><path d="M8.3 15.6l1.8 1.4M10.6 13.9l2.3 1.8M13.4 12.6l2.2 1.7"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M9 7.5V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M3 12.5h18"/><path d="M10.5 12.5v2h3v-2"/>',
  network: '<circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18" r="2.2"/><circle cx="12" cy="10" r="1.6"/><path d="M6.8 7.2l3.8 2M17.2 7.2l-3.8 2M12 11.6v4.2M6.5 7.8l4.3 8.4M17.5 7.8l-4.3 8.4"/>',
  compare: '<circle cx="6.5" cy="8" r="2.6"/><path d="M2.5 18a4 4 0 0 1 8 0"/><circle cx="17.5" cy="8" r="2.6"/><path d="M13.5 18a4 4 0 0 1 8 0"/><path d="M10 5.5h4l-1.5-1.5M14 10h-4l1.5 1.5"/>',
  columns: '<path d="M3 9.5L12 4l9 5.5z"/><path d="M5 11v7M9.7 11v7M14.3 11v7M19 11v7"/><path d="M3 20.5h18"/>',
  arc: '<path d="M2.5 18a9.5 9.5 0 0 1 19 0"/><path d="M6.5 18a5.5 5.5 0 0 1 11 0"/><path d="M1.5 20.5h21"/>',
  doc: '<path d="M6 2.5h8l4 4v15H6z"/><path d="M14 2.5v4h4"/><path d="M9 11h6M9 14h6M9 17h4"/>',
  pipeline: '<rect x="2.5" y="4" width="6" height="5" rx="1"/><rect x="15.5" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M8.5 6.5h7M5.5 9v3.5h6.5V15M18.5 9v3.5H12"/>',
  stars: '<circle cx="12" cy="12" r="8.5"/><path d="M12 6.2l.8 1.6 1.7.3-1.2 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.2-1.2 1.7-.3z"/>',
};

export const icon = (name: keyof typeof ICONS | string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
