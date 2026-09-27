import type { APIRoute } from 'astro';
import { readOptional } from '../lib/data';

// Données de la page Agenda, chargées par le navigateur.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(readOptional('travail.json') ?? []), { headers: { 'Content-Type': 'application/json' } });
