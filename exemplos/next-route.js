// Next.js (App Router): app/escambo/status/route.js
import {criarEscambo} from '@rande/escambo';

const escambo = criarEscambo();
export const dynamic = 'force-dynamic';
export async function GET(request) {
  return (await escambo.responder(request)) ?? new Response('Not found', {status: 404});
}
