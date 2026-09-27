// Couleurs de Parlementeur. L'interface n'utilise que deux teintes par thème ; les autres servent aux données.

export const THEME = {
  light: { bg: '#FBFBF8', ink: '#16213A' },
  dark: { bg: '#0F1216', ink: '#E9E6DF' },
} as const;

/** Rampe velours pour les indicateurs continus. */
export const RAMP = {
  light: { from: '#EFE6E6', to: '#6A1424' },
  dark: { from: '#2A1418', to: '#D6455E' },
} as const;

export const VOTE = {
  pour: '#1B8A8C',
  contre: '#E5482E',
  abstention: '#8F7CC4',
} as const;

/**
 * Couleurs de partis, par sigle de groupe parlementaire.
 * Les groupes inconnus retombent sur la couleur fournie par l'Assemblée, puis sur un gris.
 */
export const GROUP_COLORS: Record<string, string> = {
  GDR: '#9E1B1B',
  'GDR-NUPES': '#9E1B1B',
  LFI: '#CC2443',
  'LFI-NFP': '#CC2443',
  'LFI-NUPES': '#CC2443',
  FI: '#CC2443',
  ECOS: '#3A9D4F',
  EcoS: '#3A9D4F',
  ECO: '#3A9D4F',
  'ECOLO-NUPES': '#3A9D4F',
  ECOLO: '#3A9D4F',
  SOC: '#F08DA9',
  'SOC-A': '#F08DA9',
  SRC: '#F08DA9',
  LIOT: '#D8B545',
  'LT': '#D8B545',
  EPR: '#F7CB15',
  RE: '#F7CB15',
  LREM: '#F7CB15',
  REN: '#F7CB15',
  DEM: '#F08A24',
  Dem: '#F08A24',
  MODEM: '#F08A24',
  HOR: '#45A9DA',
  AGIR: '#45A9DA',
  'UAI': '#7FB6D9',
  UDI: '#7FB6D9',
  'UDI-I': '#7FB6D9',
  DR: '#2A5DB8',
  LR: '#2A5DB8',
  UMP: '#2A5DB8',
  UDR: '#302C78',
  RN: '#0D2B52',
  NI: '#9A9A9A',
};

export function groupColor(sigle: string | undefined, fallback?: string): string {
  if (!sigle) return fallback ?? '#9A9A9A';
  return GROUP_COLORS[sigle] ?? GROUP_COLORS[sigle.toUpperCase()] ?? fallback ?? '#9A9A9A';
}

export function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(h: string): number[] {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
