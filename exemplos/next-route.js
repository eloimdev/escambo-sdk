// Next.js (App Router): app/escambo/[...rota]/route.js — npm i github:eloimdev/escambo-sdk#v0.6.0
import {criarEscambo} from '@rande/escambo';

const escambo = criarEscambo();
export const dynamic = 'force-dynamic';
export async function GET(request) {
  return (await escambo.responder(request)) ?? new Response('Not found', {status: 404});
}
export const POST = GET; // /fim e /revogar chegam por POST
