// Géométrie de l'hémicycle en arcs, partagée entre le rendu navigateur et les images de partage.

export type Seat = { x: number; y: number; angle: number; row: number };

export type HemicycleLayout = {
  seats: Seat[];
  radius: number;
  dot: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
};

/** Nombre de rangs adapté à la taille de l'assemblée (577 → 12 rangs, 348 → 10…). */
export function rowsFor(total: number): number {
  return Math.max(4, Math.round(Math.sqrt(total / 4)));
}

/**
 * Répartit `total` sièges sur des rangs concentriques, du bord gauche au bord droit.
 * Les sièges sont triés par angle décroissant : on remplit ensuite les groupes dans l'ordre gauche → droite.
 */
export function layoutHemicycle(total: number, opts: { radius?: number; inner?: number } = {}): HemicycleLayout {
  const radius = opts.radius ?? 300;
  const inner = opts.inner ?? 0.38;
  const rows = rowsFor(total);
  const radii = Array.from({ length: rows }, (_, i) => inner + ((1 - inner) * i) / Math.max(1, rows - 1));
  const sum = radii.reduce((a, b) => a + b, 0);
  const counts = radii.map((r) => Math.floor((total * r) / sum));
  let rest = total - counts.reduce((a, b) => a + b, 0);
  for (let i = rows - 1; rest > 0; i = (i - 1 + rows) % rows, rest--) counts[i]++;

  const pad = 12;
  const cx = radius + pad;
  const cy = radius + pad;
  const seats: Seat[] = [];
  radii.forEach((r, row) => {
    const n = counts[row];
    for (let j = 0; j < n; j++) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * j) / (n - 1);
      seats.push({ angle, row, x: cx + radius * r * Math.cos(angle), y: cy - radius * r * Math.sin(angle) });
    }
  });
  seats.sort((a, b) => b.angle - a.angle || a.row - b.row);

  const rowGap = rows > 1 ? (radius * (1 - inner)) / (rows - 1) : radius;
  const arcGap = counts[0] > 1 ? (Math.PI * radius * inner) / (counts[0] - 1) : rowGap;
  const dot = Math.min(rowGap, arcGap) * 0.42;
  return { seats, radius, dot, width: 2 * cx, height: cy + pad + dot, cx, cy };
}
