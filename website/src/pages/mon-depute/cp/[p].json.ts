import type { APIRoute } from 'astro';
import { communes } from '../../../lib/communes';

// Codes postaux regroupés par leurs deux premiers chiffres : { "75011": [["Paris 11", [slugs]]] }.
export function getStaticPaths() {
  const c = communes();
  return [...new Set(Object.keys(c?.cp ?? {}).map((k) => k.slice(0, 2)))].map((p) => ({ params: { p } }));
}

export const GET: APIRoute = ({ params }) => {
  const c = communes()!;
  const out = Object.fromEntries(Object.entries(c.cp).filter(([k]) => k.startsWith(params.p!)));
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
};
