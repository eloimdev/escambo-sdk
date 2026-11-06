// Escambo SDK para Node.js — conecta o seu SaaS ao Escambo.
// Sem dependências. Protocolo v1 descrito em PROTOCOLO.md.
import {createHmac, createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const VERSAO = '0.1.0';
const SDK = 'escambo-node/' + VERSAO;
const BASE_PADRAO = 'https://dev.rande.dev/v1/escambo';

const MIN = 60_000, HORA = 60 * MIN;
const hmac = (segredo, msg) => createHmac('sha256', segredo).update(msg).digest('hex');
const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const iguais = (a, b) => {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && timingSafeEqual(A, B);
};

export const PROTOCOLO = {
  pedido: (app, desafio, ts) => `escambo-pedido.v1.${app}.${desafio}.${ts}`,
  status: (app, desafio, ts) => `escambo-status.v1.${app}.${desafio}.${ts}`,
  ping: (app, ts, nonce, corpoHash) => `escambo-ping.v1.${app}.${ts}.${nonce}.${corpoHash}`,
};

/**
 * Cria o cliente do Escambo.
 * @param {object} [opcoes]
 * @param {string} [opcoes.appId]   ESCAMBO_APP_ID (mostrado no painel depois de verificar o domínio)
 * @param {string} [opcoes.segredo] ESCAMBO_SEGREDO (mostrado uma única vez)
 * @param {string} [opcoes.caminho] onde o SDK responde no seu site; padrão "/escambo"
 * @param {string} [opcoes.base]    API do Escambo; padrão https://dev.rande.dev/v1/escambo
 * @param {(evento: string, dados?: object) => void} [opcoes.log]
 */
export function criarEscambo(opcoes = {}) {
  const env = typeof process !== 'undefined' ? process.env : {};
  const appId = opcoes.appId || env.ESCAMBO_APP_ID;
  const segredo = opcoes.segredo || env.ESCAMBO_SEGREDO;
  const caminho = (opcoes.caminho || env.ESCAMBO_CAMINHO || '/escambo').replace(/\/+$/, '');
  const base = (opcoes.base || env.ESCAMBO_BASE || BASE_PADRAO).replace(/\/+$/, '');
  const log = opcoes.log || (() => {});
  if (!/^esc_app_[0-9a-f]{20}$/.test(String(appId || ''))) throw new Error('Escambo: ESCAMBO_APP_ID ausente ou inválido.');
  if (!/^esc_sk_[A-Za-z0-9_-]{40,}$/.test(String(segredo || ''))) throw new Error('Escambo: ESCAMBO_SEGREDO ausente ou inválido.');
  if (!/^\/[A-Za-z0-9/_-]*$/.test(caminho)) throw new Error('Escambo: caminho inválido.');

  const estado = {conectado: false, ultimoPing: null, ultimoErro: null, proximoPing: null, inicio: null, timer: null, serverEstado: null};

  // ---------- Escambo -> seu SaaS: GET {caminho}/status ----------
  function responderStatus(url, headers) {
    const desafio = url.searchParams.get('desafio') || '';
    const ts = Number(url.searchParams.get('ts'));
    const app = headers['x-escambo-app'];
    const ass = headers['x-escambo-assinatura'];
    const agora = Math.floor(Date.now() / 1000);
    if (app !== appId || !/^[0-9a-f]{32}$/.test(desafio) || !Number.isInteger(ts) || !/^[0-9a-f]{64}$/.test(String(ass || '')))
      return {status: 401, corpo: {sdk: SDK, montado: true, erro: 'pedido_sem_assinatura'}};
    if (Math.abs(agora - ts) > 300) return {status: 401, corpo: {sdk: SDK, montado: true, erro: 'relogio'}};
    if (!iguais(ass, hmac(segredo, PROTOCOLO.pedido(appId, desafio, ts)))) return {status: 401, corpo: {sdk: SDK, montado: true, erro: 'assinatura'}};
    estado.conectado = true;
    log('status', {ts});
    return {status: 200, corpo: {app_id: appId, sdk: SDK, ts, prova: hmac(segredo, PROTOCOLO.status(appId, desafio, ts))}};
  }
  const ehRota = (pathname) => pathname === caminho + '/status';
  const lerHeaders = (h) => {
    const out = {};
    if (typeof h?.get === 'function') {for (const k of ['x-escambo-app', 'x-escambo-assinatura']) out[k] = h.get(k) || undefined;}
    else for (const k of ['x-escambo-app', 'x-escambo-assinatura']) out[k] = Array.isArray(h?.[k]) ? h[k][0] : h?.[k];
    return out;
  };

  /** Middleware para Node http, Express, Connect e Fastify (via middie). Chama next() fora da rota. */
  function middleware(req, res, next) {
    const url = new URL(req.originalUrl || req.url || '/', 'http://local');
    if (!ehRota(url.pathname) || req.method !== 'GET') {
      if (next) return next();
      res.statusCode = 404; res.end(); return;
    }
    const r = responderStatus(url, lerHeaders(req.headers));
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(r.corpo));
  }

  /** Para runtimes com Request/Response (Next.js App Router, Hono, Bun, Deno, Workers). Devolve null fora da rota. */
  async function responder(request) {
    const url = new URL(request.url);
    if (!ehRota(url.pathname) || request.method !== 'GET') return null;
    const r = responderStatus(url, lerHeaders(request.headers));
    return new Response(JSON.stringify(r.corpo), {status: r.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}});
  }

  // ---------- seu SaaS -> Escambo: ping assinado ----------
  async function ping() {
    const corpo = JSON.stringify({sdk: SDK, node: typeof process !== 'undefined' ? process.version : undefined});
    const ts = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(18).toString('base64url');
    const assinatura = hmac(segredo, PROTOCOLO.ping(appId, ts, nonce, sha256(corpo)));
    let r;
    try {
      r = await fetch(base + '/sdk/ping', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Escambo-App': appId, 'X-Escambo-Ts': String(ts), 'X-Escambo-Nonce': nonce, 'X-Escambo-Assinatura': assinatura},
        body: corpo, signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      estado.ultimoErro = 'rede: ' + (e?.message || e);
      log('ping_falhou', {erro: estado.ultimoErro});
      return {ok: false, erro: estado.ultimoErro};
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      estado.ultimoErro = j.message || 'HTTP ' + r.status;
      log('ping_falhou', {status: r.status, erro: estado.ultimoErro});
      return {ok: false, status: r.status, erro: estado.ultimoErro};
    }
    estado.conectado = true; estado.ultimoPing = Date.now(); estado.ultimoErro = null; estado.serverEstado = j.estado;
    log('ping', {estado: j.estado, proximo_ping_s: j.proximo_ping_s});
    return {ok: true, ...j};
  }

  // Ritmo: antes de conectar, pinga com frequência e vai espaçando; depois, segue o intervalo que o Escambo mandar
  // (1 h no primeiro dia, 1 dia depois). Falhou estando conectado: tenta de novo em 5 min.
  function intervaloAntes() {
    const desde = Date.now() - estado.inicio;
    if (desde < 5 * MIN) return 30_000;
    if (desde < HORA) return 5 * MIN;
    return HORA;
  }
  function agendar(ms) {
    clearTimeout(estado.timer);
    estado.proximoPing = Date.now() + ms;
    estado.timer = setTimeout(rodada, ms);
    estado.timer.unref?.();
  }
  async function rodada() {
    const r = await ping();
    if (r.ok) agendar(Math.max(60, Number(r.proximo_ping_s) || 3600) * 1000);
    else agendar(estado.ultimoPing ? 5 * MIN : intervaloAntes());
  }
  /** Começa a pingar o Escambo em segundo plano (servidores de longa duração). Em serverless, use ping() num cron. */
  function iniciar() {
    if (estado.inicio) return;
    estado.inicio = Date.now();
    agendar(0);
  }
  function parar() {clearTimeout(estado.timer); estado.timer = null; estado.inicio = null;}
  const status = () => ({appId, caminho, base, conectado: estado.conectado, estado: estado.serverEstado, ultimoPing: estado.ultimoPing, proximoPing: estado.proximoPing, ultimoErro: estado.ultimoErro});

  return {middleware, responder, ping, iniciar, parar, status, caminho, appId};
}

export default criarEscambo;
