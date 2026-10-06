import type { APIRoute } from 'astro';
import { readOptional } from '../../../lib/data';
import { lobbying } from '../../../lib/lobbying';

// Registre des actions d'un trimestre, chargé à la demande par la page Lobbying.
export function getStaticPaths() {
  return (lobbying()?.registre ?? []).map((q) => ({ params: { q } }));
}

export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(readOptional(`lobbying/registre/${params.q}.json`) ?? []), { headers: { 'Content-Type': 'application/json' } });
