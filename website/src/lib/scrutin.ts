import type { Depute, Scrutin, VoteCode } from './data';
import { VOTE, THEME, mix } from './colors';

export type SeatVote = VoteCode | 'nonVotant' | 'horsMandat';

export const VOTE_LABEL: Record<SeatVote, string> = {
  pour: 'Pour',
  contre: 'Contre',
  abstention: 'Abstention',
  absent: 'Absent',
  nonVotant: "Présent, n'a pas voté",
  horsMandat: 'Pas encore élu',
};

/** Vote de chaque siège de l'hémicycle actuel sur un scrutin donné. */
export function seatVotes(s: Scrutin, deputes: Depute[]): SeatVote[] {
  const map = { p: 'pour', c: 'contre', a: 'abstention', n: 'nonVotant' } as const;
  return deputes.map((d) => {
    const v = s.votes[d.id];
    if (v) return map[v];
    return d.debut > s.date ? 'horsMandat' : 'absent';
  });
}

const CSS: Record<SeatVote, string> = {
  pour: 'var(--vote-pour)',
  contre: 'var(--vote-contre)',
  abstention: 'var(--vote-abstention)',
  nonVotant: 'var(--ink-16)',
  absent: 'var(--ink-4)',
  horsMandat: 'var(--ink-4)',
};

export function scrutinFills(s: Scrutin, deputes: Depute[]) {
  const codes = seatVotes(s, deputes);
  return { codes, fills: codes.map((c) => CSS[c]) };
}

export function scrutinFillsHex(s: Scrutin, deputes: Depute[]) {
  const ghost = mix(THEME.light.bg, THEME.light.ink, 0.06);
  const hex: Record<SeatVote, string> = {
    pour: VOTE.pour,
    contre: VOTE.contre,
    abstention: VOTE.abstention,
    nonVotant: mix(THEME.light.bg, THEME.light.ink, 0.16),
    absent: ghost,
    horsMandat: ghost,
  };
  return seatVotes(s, deputes).map((c) => hex[c]);
}

const CODE: Record<SeatVote, string> = { pour: 'p', contre: 'c', abstention: 'a', nonVotant: 'n', absent: 'x', horsMandat: 'h' };

/** Un caractère par siège, pour le rendu côté navigateur. */
export function seatCodes(s: Scrutin, deputes: Depute[]): string {
  return seatVotes(s, deputes).map((c) => CODE[c]).join('');
}
