import type { APIRoute } from 'astro';
import { lobbying } from '../../lib/lobbying';

// Index des organisations pour la recherche : [slug, nom, famille, actions, élus nommés].
export const GET: APIRoute = () => new Response(JSON.stringify(lobbying()?.orgs ?? []), { headers: { 'Content-Type': 'application/json' } });
