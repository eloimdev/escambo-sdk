import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac, createHash, randomBytes} from 'node:crypto';
import {criarEscambo, PROTOCOLO} from '../src/index.js';

const appId = 'esc_app_' + 'a'.repeat(20);
const segredo = 'esc_sk_' + randomBytes(32).toString('base64url');
const assina = (m) => createHmac('sha256', segredo).update(m).digest('hex');

function servidor(esc) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => esc.middleware(req, res, () => {res.end('app');}));
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

test('responde ao desafio assinado com a prova certa', async () => {
  const esc = criarEscambo({appId, segredo});
  const s = await servidor(esc);
  const desafio = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000);
  const r = await fetch(`http://127.0.0.1:${s.address().port}/escambo/status?desafio=${desafio}&ts=${ts}`,
    {headers: {'X-Escambo-App': appId, 'X-Escambo-Assinatura': assina(PROTOCOLO.pedido(appId, desafio, ts))}});
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.prova, assina(PROTOCOLO.status(appId, desafio, ts)));
  s.close();
});

test('recusa pedido sem assinatura, com assinatura errada ou relógio velho', async () => {
  const esc = criarEscambo({appId, segredo});
  const s = await servidor(esc);
  const base = `http://127.0.0.1:${s.address().port}/escambo/status`;
  const desafio = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000);
  assert.equal((await fetch(`${base}?desafio=${desafio}&ts=${ts}`)).status, 401);
  assert.equal((await fetch(`${base}?desafio=${desafio}&ts=${ts}`, {headers: {'X-Escambo-App': appId, 'X-Escambo-Assinatura': 'f'.repeat(64)}})).status, 401);
  const velho = ts - 900;
  assert.equal((await fetch(`${base}?desafio=${desafio}&ts=${velho}`, {headers: {'X-Escambo-App': appId, 'X-Escambo-Assinatura': assina(PROTOCOLO.pedido(appId, desafio, velho))}})).status, 401);
  s.close();
});

test('fora da rota chama next()', async () => {
  const esc = criarEscambo({appId, segredo});
  const s = await servidor(esc);
  const r = await fetch(`http://127.0.0.1:${s.address().port}/qualquer`);
  assert.equal(await r.text(), 'app');
  s.close();
});

test('responder() funciona com Request e devolve null fora da rota', async () => {
  const esc = criarEscambo({appId, segredo});
  const desafio = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000);
  const req = new Request(`https://saas.test/escambo/status?desafio=${desafio}&ts=${ts}`,
    {headers: {'X-Escambo-App': appId, 'X-Escambo-Assinatura': assina(PROTOCOLO.pedido(appId, desafio, ts))}});
  const r = await esc.responder(req);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).prova, assina(PROTOCOLO.status(appId, desafio, ts)));
  assert.equal(await esc.responder(new Request('https://saas.test/outra')), null);
});

test('ping assina o corpo do jeito do protocolo', async () => {
  let recebido;
  const s = await new Promise((ok) => {
    const srv = http.createServer(async (req, res) => {
      let corpo = ''; for await (const c of req) corpo += c;
      recebido = {h: req.headers, corpo};
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, estado: 'conectado', proximo_ping_s: 3600}));
    });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
  const esc = criarEscambo({appId, segredo, base: `http://127.0.0.1:${s.address().port}/v1/escambo`});
  const r = await esc.ping();
  assert.equal(r.ok, true);
  const h = recebido.h;
  const esperado = assina(PROTOCOLO.ping(appId, h['x-escambo-ts'], h['x-escambo-nonce'], createHash('sha256').update(recebido.corpo).digest('hex')));
  assert.equal(h['x-escambo-assinatura'], esperado);
  assert.equal(esc.status().conectado, true);
  s.close();
});

test('recusa chaves inválidas', () => {
  assert.throws(() => criarEscambo({appId: 'x', segredo}));
  assert.throws(() => criarEscambo({appId, segredo: 'curto'}));
});
