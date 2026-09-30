import type { APIRoute } from 'astro';
import { communes, letter } from '../../../lib/communes';

// Noms de communes par première lettre : [["Orléans", "45000"], …].
export function getStaticPaths() {
  const c = communes();
  return [...new Set((c?.communes ?? []).map(([n]) => letter(n)))].filter((l) => /[a-z]/.test(l)).map((l) => ({ params: { l } }));
}

export const GET: APIRoute = ({ params }) => {
  const rows = communes()!.communes.filter(([n]) => letter(n) === params.l);
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
};
