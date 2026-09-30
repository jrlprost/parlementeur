// Code postal → communes → députés, découpé en petits fichiers chargés à la demande.
import { readOptional } from './data';

export type Communes = { cp: Record<string, [string, string[]][]>; communes: [string, string][]; sources: string[] };

export const communes = () => readOptional<Communes>('communes.json');

/** Clé de découpage d'un nom de commune : première lettre sans accent. */
export const letter = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toLowerCase();
