// 0.6: POST {caminho}/revogar e o endurecimento de /fim (autenticar antes de ler o corpo, limite de 16 KB, nonces plugáveis).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac, createHash, randomBytes} from 'node:crypto';
import {criarEscambo, PROTOCOLO, VERSAO} from '../src/index.js';

const appId = 'esc_app_' + 'b'.repeat(20);
const segredo = 'esc_sk_' + randomBytes(32).toString('base64url');
const assina = (m) => createHmac('sha256', segredo).update(m).digest('hex');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const agora = () => Math.floor(Date.now() / 1000);

function servidor(esc) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => esc.middleware(req, res, () => res.end("app")));
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}
function cabecalhos(corpo, {tipo = 'revogar', ts = agora(), nonce = randomBytes(12).toString('hex'), app = appId, sig} = {}) {
  return {'Content-Type': 'application/json', 'X-Escambo-App': app, 'X-Escambo-Ts': String(ts), 'X-Escambo-Nonce': nonce,
    'X-Escambo-Assinatura': sig || assina(PROTOCOLO[tipo](app, ts, nonce, sha(corpo)))};
}
const corpoPadrao = JSON.stringify({assinatura: 'as_123', usuario: 'u-1', plano: 'Plano M', plano_id: 'm', motivo: 'denuncia'});

test('versão 0.6.0 e mensagens do protocolo', () => {
  assert.equal(VERSAO, '0.6.0');
  assert.equal(PROTOCOLO.revogar('A', 1, 'n', 'h'), 'escambo-revogar.v1.A.1.n.h');
  assert.equal(PROTOCOLO.revogarResp('A', 'n'), 'escambo-revogar-resp.v1.A.n');
});

test('revogar: assinatura válida chama o callback e devolve a prova; anuncia o recurso', async () => {
  let ctx;
  const esc = criarEscambo({appId, segredo, revogar: async (c) => { ctx = c; }});
  assert.ok(esc.recursos.includes('revogar'));
  const s = await servidor(esc);
  const h = cabecalhos(corpoPadrao);
  const r = await fetch(`http://127.0.0.1:${s.address().port}/escambo/revogar`, {method: 'POST', headers: h, body: corpoPadrao});
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.prova, assina(PROTOCOLO.revogarResp(appId, h['X-Escambo-Nonce'])));
  assert.deepEqual(ctx, {appId, assinatura: 'as_123', usuario: 'u-1', plano: 'Plano M', plano_id: 'm', motivo: 'denuncia'});
  s.close();
});

test('revogar: assinatura inválida, app errado, relógio velho e nonce mal formado = 401', async () => {
  let chamou = 0;
  const esc = criarEscambo({appId, segredo, revogar: async () => { chamou++; }});
  const s = await servidor(esc), url = `http://127.0.0.1:${s.address().port}/escambo/revogar`;
  const post = (headers) => fetch(url, {method: 'POST', headers, body: corpoPadrao}).then((r) => r.status);
  assert.equal(await post(cabecalhos(corpoPadrao, {sig: 'f'.repeat(64)})), 401);
  assert.equal(await post(cabecalhos(corpoPadrao, {tipo: 'fim'})), 401, 'assinatura de /fim não vale em /revogar');
  assert.equal(await post(cabecalhos(corpoPadrao, {app: 'esc_app_' + 'c'.repeat(20)})), 401);
  assert.equal(await post(cabecalhos(corpoPadrao, {ts: agora() - 900})), 401);
  assert.equal(await post(cabecalhos(corpoPadrao, {nonce: 'curto'})), 401);
  assert.equal(await post(cabecalhos('{"assinatura":"outra"}')), 401, 'corpo trocado');
  assert.equal(chamou, 0);
  s.close();
});

test('revogar: nonce repetido = 409; nonces plugáveis são usados', async () => {
  const guardados = new Map();
  const nonces = {tem: async (k) => guardados.has(k), guardar: async (k, ttl) => { guardados.set(k, ttl); }};
  const esc = criarEscambo({appId, segredo, revogar: async () => {}, nonces});
  const s = await servidor(esc), url = `http://127.0.0.1:${s.address().port}/escambo/revogar`;
  const h = cabecalhos(corpoPadrao);
  assert.equal((await fetch(url, {method: 'POST', headers: h, body: corpoPadrao})).status, 200);
  assert.equal((await fetch(url, {method: 'POST', headers: h, body: corpoPadrao})).status, 409);
  assert.equal(guardados.size, 1);
  assert.ok([...guardados.keys()][0].includes(h['X-Escambo-Nonce']));
  assert.ok([...guardados.values()][0] >= 600_000);
  s.close();
});

test('revogar: nonce é verificado antes de ler o corpo (repetido não lê nada)', async () => {
  let lidos = 0;
  const corpo = () => new ReadableStream({pull(c) { lidos++; c.enqueue(new TextEncoder().encode(corpoPadrao)); c.close(); }}, {highWaterMark: 0});
  const pedido = (h) => new Request('https://saas.test/escambo/revogar', {method: 'POST', headers: h, body: corpo(), duplex: 'half'});
  const repetido = criarEscambo({appId, segredo, revogar: async () => {}, nonces: {tem: () => true, guardar: () => {}}});
  assert.equal((await repetido.responder(pedido(cabecalhos(corpoPadrao)))).status, 409);
  const esc = criarEscambo({appId, segredo, revogar: async () => {}});
  assert.equal((await esc.responder(pedido(cabecalhos(corpoPadrao, {ts: agora() - 900})))).status, 401);
  assert.equal((await esc.responder(pedido(cabecalhos(corpoPadrao, {app: 'esc_app_' + 'd'.repeat(20)})))).status, 401);
  assert.equal(lidos, 0, 'nada do corpo foi lido');
  assert.equal((await esc.responder(pedido(cabecalhos(corpoPadrao)))).status, 200);
  assert.equal(lidos, 1);
});

test('revogar: corpo acima de 16 KB = 413 sem chamar o callback', async () => {
  let chamou = 0;
  const esc = criarEscambo({appId, segredo, revogar: async () => { chamou++; }});
  const s = await servidor(esc);
  const grande = JSON.stringify({assinatura: 'as_1', lixo: 'x'.repeat(17000)});
  const r = await fetch(`http://127.0.0.1:${s.address().port}/escambo/revogar`, {method: 'POST', headers: cabecalhos(grande), body: grande});
  assert.equal(r.status, 413);
  assert.equal(chamou, 0);
  // responder(Request) sem Content-Length confiável: limite aplicado na leitura
  const req = new Request('https://saas.test/escambo/revogar', {method: 'POST', headers: cabecalhos(grande), body: new Blob([grande]).stream(), duplex: 'half'});
  req.headers.delete('content-length');
  assert.equal((await esc.responder(req)).status, 413);
  s.close();
});

test('revogar: corpo já consumido por express.json() = 400 com dica; rawBody é aceito', async () => {
  const esc = criarEscambo({appId, segredo, revogar: async () => {}});
  const consumido = await new Promise((ok) => {
    const s = http.createServer(async (req, res) => {
      for await (const _ of req); // simula express.json(): leu o stream e deixou um objeto
      req.body = {assinatura: 'as_123'};
      esc.middleware(req, res, () => res.end('app'));
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
  const r = await fetch(`http://127.0.0.1:${consumido.address().port}/escambo/revogar`, {method: 'POST', headers: cabecalhos(corpoPadrao), body: corpoPadrao});
  const j = await r.json();
  assert.equal(r.status, 400);
  assert.equal(j.erro, 'corpo_consumido');
  assert.match(j.dica, /antes do express\.json/);
  consumido.close();

  const comRaw = await new Promise((ok) => {
    const s = http.createServer(async (req, res) => {
      const partes = []; for await (const c of req) partes.push(c);
      req.rawBody = Buffer.concat(partes); req.body = JSON.parse(req.rawBody.toString('utf8'));
      esc.middleware(req, res, () => res.end('app'));
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
  const r2 = await fetch(`http://127.0.0.1:${comRaw.address().port}/escambo/revogar`, {method: 'POST', headers: cabecalhos(corpoPadrao), body: corpoPadrao});
  assert.equal(r2.status, 200);
  comRaw.close();
});

test('revogar: callback com erro = 500 revogar_falhou; sem callback = 501', async () => {
  const esc = criarEscambo({appId, segredo, revogar: async () => { throw new Error('banco fora'); }});
  const r = await esc.responder(new Request('https://saas.test/escambo/revogar', {method: 'POST', headers: cabecalhos(corpoPadrao), body: corpoPadrao}));
  assert.equal(r.status, 500);
  assert.equal((await r.json()).erro, 'revogar_falhou');
  const sem = criarEscambo({appId, segredo});
  assert.ok(!sem.recursos.includes('revogar'));
  const r2 = await sem.responder(new Request('https://saas.test/escambo/revogar', {method: 'POST', headers: cabecalhos(corpoPadrao), body: corpoPadrao}));
  assert.equal(r2.status, 501);
});

test('revogar: UTF-8 multibyte assinado sobre os bytes', async () => {
  let ctx;
  const esc = criarEscambo({appId, segredo, revogar: async (c) => { ctx = c; }});
  const s = await servidor(esc);
  const corpo = JSON.stringify({assinatura: 'as_ç', usuario: 'joão', plano: 'Plano Médio ✓', motivo: 'resgate_falhou'});
  const r = await fetch(`http://127.0.0.1:${s.address().port}/escambo/revogar`, {method: 'POST', headers: cabecalhos(corpo), body: corpo});
  assert.equal(r.status, 200);
  assert.equal(ctx.plano, 'Plano Médio ✓');
  assert.equal(ctx.motivo, 'resgate_falhou');
  s.close();
});

test('fim continua funcionando com a leitura nova e recusa nonce repetido', async () => {
  let ctx;
  const esc = criarEscambo({appId, segredo, fimDaTroca: async (c) => { ctx = c; }});
  const s = await servidor(esc), url = `http://127.0.0.1:${s.address().port}/escambo/fim`;
  const corpo = JSON.stringify({assinatura: 'as_9', usuario: 'u', momento: 'fim', expira: 1, oferta: null});
  const h = cabecalhos(corpo, {tipo: 'fim'});
  const r = await fetch(url, {method: 'POST', headers: h, body: corpo});
  assert.equal(r.status, 200);
  assert.equal((await r.json()).prova, assina(PROTOCOLO.fimResp(appId, h['X-Escambo-Nonce'])));
  assert.equal(ctx.momento, 'fim');
  assert.equal((await fetch(url, {method: 'POST', headers: h, body: corpo})).status, 409);
  s.close();
});
