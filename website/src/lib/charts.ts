// Graphiques rendus en SVG au build. Chaque point porte data-n (nom), data-g (groupe), data-v (valeur), data-s (slug) :
// un petit script commun affiche le député touché, sur mobile comme sur ordinateur.

export type Pt = { v: number; s: string; n: string; g: string; c?: string; label?: string };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f1 = (x: number) => x.toFixed(1);
const dot = (x: number, y: number, r: number, fill: string, p: Pt, extra = '') =>
  `<circle cx="${f1(x)}" cy="${f1(y)}" r="${r}" fill="${fill}" data-n="${esc(p.n)}" data-g="${esc(p.g)}" data-v="${esc(p.label ?? String(p.v))}" data-s="${p.s}"${extra}/>`;

/** Place des points sur un axe sans chevauchement (essaim), renvoie leur décalage vertical. */
function dodge(xs: number[], r: number): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const placed: { x: number; y: number }[] = [];
  const ys = new Array(xs.length).fill(0);
  const d = r * 2 + 0.6;
  for (const [x, i] of order) {
    const near = placed.filter((p) => Math.abs(p.x - x) < d);
    let y = 0;
    for (let k = 0; k < 400; k++) {
      y = k === 0 ? 0 : Math.ceil(k / 2) * (d * 0.87) * (k % 2 ? 1 : -1);
      if (near.every((p) => Math.hypot(p.x - x, p.y - y) >= d)) break;
    }
    placed.push({ x, y });
    ys[i] = y;
  }
  return ys;
}

type Axis = { min: number; max: number; ticks: number[]; fmt: (v: number) => string; log?: boolean };

function scaleX(ax: Axis, x0: number, x1: number) {
  const t = (v: number) => (ax.log ? Math.log10(Math.max(v, 1)) : v);
  const a = t(ax.min), b = t(ax.max);
  return (v: number) => x0 + ((Math.min(Math.max(t(v), a), b) - a) / (b - a)) * (x1 - x0);
}

/** Essaim de points par groupe : une ligne par groupe, un point par député, trait = médiane. */
export function swarm(rows: { label: string; color: string; points: Pt[] }[], ax: Axis, refs: { v: number; label: string }[] = []): string {
  const W = 360, L = 58, R = 12, r = 2.9;
  const x = scaleX(ax, L, W - R);
  let y = 26;
  let body = '';
  for (const row of rows) {
    const xs = row.points.map((p) => x(p.v));
    const ys = dodge(xs, r);
    const half = Math.max(8, Math.max(0, ...ys.map(Math.abs)) + r + 2);
    const cy = y + half;
    const med = [...row.points].map((p) => p.v).sort((a, b) => a - b)[Math.floor(row.points.length / 2)];
    body += `<text x="0" y="${f1(cy + 4)}" class="rl">${esc(row.label)}</text>`;
    body += `<line x1="${L}" x2="${W - R}" y1="${f1(cy)}" y2="${f1(cy)}" class="base"/>`;
    body += row.points.map((p, i) => dot(xs[i], cy + ys[i], r, row.color, p)).join('');
    if (med != null) body += `<line x1="${f1(x(med))}" x2="${f1(x(med))}" y1="${f1(cy - half + 2)}" y2="${f1(cy + half - 2)}" class="med"/>`;
    y = cy + half + 6;
  }
  const H = y + 4;
  const ticks = ax.ticks.map((t) => `<line x1="${f1(x(t))}" x2="${f1(x(t))}" y1="18" y2="${f1(H - 4)}" class="grid"/><text x="${f1(x(t))}" y="12" class="tk" text-anchor="middle">${esc(ax.fmt(t))}</text>`).join('');
  // Repères : étiquettes alternées en haut et en bas pour ne pas se chevaucher.
  const ref = refs.map((rf, i) => `<line x1="${f1(x(rf.v))}" x2="${f1(x(rf.v))}" y1="18" y2="${f1(H - 4)}" class="ref"/><text x="${f1(x(rf.v) + 3)}" y="${f1(i % 2 ? H - 6 : 26)}" class="rt">${esc(rf.label)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${f1(H)}" class="chart swarm" role="img">${ticks}${ref}${body}</svg>`;
}

/** Pyramide des âges : femmes à gauche, hommes à droite. */
export function pyramid(bins: { label: string; f: number; h: number }[], colors: [string, string]): string {
  const W = 360, mid = W / 2, gap = 22, rowH = 17;
  const max = Math.max(...bins.flatMap((b) => [b.f, b.h]), 1);
  const w = (n: number) => (n / max) * (mid - gap - 26);
  const rows = [...bins].reverse();
  const body = rows
    .map((b, i) => {
      const y = 22 + i * rowH;
      return `<rect x="${f1(mid - gap - w(b.f))}" y="${y}" width="${f1(w(b.f))}" height="${rowH - 3}" fill="${colors[0]}" rx="1.5"/>` +
        `<rect x="${mid + gap}" y="${y}" width="${f1(w(b.h))}" height="${rowH - 3}" fill="${colors[1]}" rx="1.5"/>` +
        `<text x="${mid}" y="${y + 11}" text-anchor="middle" class="tk">${esc(b.label)}</text>` +
        (b.f ? `<text x="${f1(mid - gap - w(b.f) - 3)}" y="${y + 11}" text-anchor="end" class="vl">${b.f}</text>` : '') +
        (b.h ? `<text x="${f1(mid + gap + w(b.h) + 3)}" y="${y + 11}" class="vl">${b.h}</text>` : '');
    })
    .join('');
  const H = 22 + rows.length * rowH + 4;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><text x="${mid - gap}" y="12" text-anchor="end" class="hd">Femmes</text><text x="${mid + gap}" y="12" class="hd">Hommes</text>${body}</svg>`;
}

/** Grille d'unités : un carré par député. */
export function waffle(cells: { color: string; p: Pt }[], perRow = 29): string {
  const s = 12.2, g = 0.8;
  const rows = Math.ceil(cells.length / perRow);
  const body = cells
    .map((c, i) => `<rect x="${f1((i % perRow) * s)}" y="${f1(Math.floor(i / perRow) * s)}" width="${f1(s - g * 2)}" height="${f1(s - g * 2)}" rx="2" fill="${c.color}" data-n="${esc(c.p.n)}" data-g="${esc(c.p.g)}" data-v="${esc(c.p.label ?? '')}" data-s="${c.p.s}"/>`)
    .join('');
  return `<svg viewBox="0 0 ${f1(perRow * s)} ${f1(rows * s)}" class="chart waffle" role="img">${body}</svg>`;
}

/** Nuage de points à deux variables, avec les médianes qui découpent quatre zones commentées. */
export function scatter(pts: (Pt & { y: number })[], ax: Axis, ay: Axis, quad: [string, string, string, string]): string {
  const W = 360, H = 330, L = 34, B = 26, T = 10, R = 8;
  const x = scaleX(ax, L, W - R);
  const yS = scaleX(ay, H - B, T);
  const mx = [...pts].map((p) => p.v).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  const my = [...pts].map((p) => p.y).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
  const grid =
    ax.ticks.map((t) => `<line x1="${f1(x(t))}" x2="${f1(x(t))}" y1="${T}" y2="${H - B}" class="grid"/><text x="${f1(x(t))}" y="${H - 8}" text-anchor="middle" class="tk">${esc(ax.fmt(t))}</text>`).join('') +
    ay.ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${f1(yS(t))}" y2="${f1(yS(t))}" class="grid"/><text x="${L - 4}" y="${f1(yS(t) + 3)}" text-anchor="end" class="tk">${esc(ay.fmt(t))}</text>`).join('');
  const med = `<line x1="${f1(x(mx))}" x2="${f1(x(mx))}" y1="${T}" y2="${H - B}" class="ref"/><line x1="${L}" x2="${W - R}" y1="${f1(yS(my))}" y2="${f1(yS(my))}" class="ref"/>`;
  const q = `<text x="${W - R - 2}" y="${T + 10}" text-anchor="end" class="qt">${esc(quad[0])}</text><text x="${L + 3}" y="${T + 10}" class="qt">${esc(quad[1])}</text><text x="${L + 3}" y="${H - B - 5}" class="qt">${esc(quad[2])}</text><text x="${W - R - 2}" y="${H - B - 5}" text-anchor="end" class="qt">${esc(quad[3])}</text>`;
  const dots = pts.map((p) => dot(x(p.v), yS(p.y), 2.6, p.c ?? 'var(--ink)', p, ' fill-opacity=".85"')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart scatter" role="img">${grid}${med}${q}${dots}</svg>`;
}

/** Courbe de concentration : part cumulée d'un total, députés classés du plus au moins actif. */
export function lorenz(values: number[], marks: number[]): { svg: string; at: Record<number, number> } {
  const W = 360, H = 250, L = 34, B = 26, T = 10, R = 10;
  const sorted = [...values].sort((a, b) => b - a);
  const tot = sorted.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  const pts = sorted.map((v, i) => { acc += v; return [(i + 1) / sorted.length, acc / tot] as const; });
  const x = (p: number) => L + p * (W - L - R);
  const y = (p: number) => H - B - p * (H - B - T);
  const path = 'M' + [[0, 0] as const, ...pts].map(([a, b]) => `${f1(x(a))},${f1(y(b))}`).join('L');
  const at: Record<number, number> = {};
  let ann = '';
  for (const m of marks) {
    const share = pts[Math.max(0, Math.round(m * pts.length) - 1)][1];
    at[m] = share;
    // Étiquette sous le point, alignée à droite quand le point est dans la moitié droite du graphique.
    const right = x(m) > W * 0.45;
    ann += `<circle cx="${f1(x(m))}" cy="${f1(y(share))}" r="4" class="mk"/><text x="${f1(x(m) + (right ? -2 : 6))}" y="${f1(y(share) + 16)}" text-anchor="${right ? 'end' : 'start'}" class="an">${Math.round(m * 100)} % des députés → ${Math.round(share * 100)} % du total</text>`;
  }
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${L}" x2="${W - R}" y1="${f1(y(t))}" y2="${f1(y(t))}" class="grid"/><text x="${L - 4}" y="${f1(y(t) + 3)}" text-anchor="end" class="tk">${t * 100}%</text><text x="${f1(x(t))}" y="${H - 8}" text-anchor="middle" class="tk">${t * 100}%</text>`).join('');
  const eq = `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="ref"/><text x="${f1(x(0.62))}" y="${f1(y(0.55))}" class="qt">répartition égale</text>`;
  return { svg: `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${eq}<path d="${path}" class="curve"/>${ann}</svg>`, at };
}

/** Colonnes dans le temps (années), avec les pics annotés. */
export function columns(items: { k: number; n: number }[], note: (k: number) => string | null): string {
  const W = 360, H = 190, L = 6, B = 22, T = 18;
  const min = Math.min(...items.map((i) => i.k)), max = Math.max(...items.map((i) => i.k));
  const n = max - min + 1;
  const bw = (W - L * 2) / n;
  const top = Math.max(...items.map((i) => i.n), 1);
  const byK = new Map(items.map((i) => [i.k, i.n]));
  let body = '';
  for (let k = min; k <= max; k++) {
    const v = byK.get(k) ?? 0;
    const h = (v / top) * (H - B - T);
    const x = L + (k - min) * bw;
    if (v) body += `<rect x="${f1(x + 0.6)}" y="${f1(H - B - h)}" width="${f1(bw - 1.2)}" height="${f1(h)}" rx="1" class="col"/>`;
    const lab = note(k);
    if (lab && v) body += `<text x="${f1(x + bw / 2)}" y="${f1(H - B - h - 4)}" text-anchor="middle" class="an">${esc(lab)}</text>`;
    if ((k - min) % 10 === 0 || k === max) body += `<text x="${f1(x + bw / 2)}" y="${H - 6}" text-anchor="middle" class="tk">${k}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img"><line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" class="base"/>${body}</svg>`;
}
