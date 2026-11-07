// Escambo SDK para Node.js — conecta o seu SaaS ao Escambo.
// Sem dependências. Protocolo v1 descrito em PROTOCOLO.md.
import {createHmac, createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const VERSAO = '0.6.0';
const SDK = 'escambo-node/' + VERSAO;
const BASE_PADRAO = 'https://dev.rande.dev/v1/escambo';

const MIN = 60_000;
const LIMITE_CORPO = 16384; // bytes aceitos no corpo de /fim e /revogar
const hmac = (segredo, msg) => createHmac('sha256', segredo).update(msg).digest('hex');
const sha256 = (v) => createHash('sha256').update(v).digest('hex'); // string (UTF-8) ou Buffer: mesmo hash para os mesmos bytes
const iguais = (a, b) => {
  const A = Buffer.from(String(a || '')), B = Buffer.from(String(b || ''));
  return A.length === B.length && timingSafeEqual(A, B);
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const PROTOCOLO = {
  pedido: (app, desafio, ts) => `escambo-pedido.v1.${app}.${desafio}.${ts}`,
  status: (app, desafio, ts) => `escambo-status.v1.${app}.${desafio}.${ts}`,
  ping: (app, ts, nonce, corpoHash) => `escambo-ping.v1.${app}.${ts}.${nonce}.${corpoHash}`,
  chamada: (acao, app, ts, nonce, corpoHash) => `escambo-${acao}.v1.${app}.${ts}.${nonce}.${corpoHash}`,
  situacao: (app, assinatura, usuario, desafio, ts) => `escambo-situacao.v1.${app}.${assinatura}.${usuario}.${desafio}.${ts}`,
  situacaoResp: (app, assinatura, situacao, desafio, ts) => `escambo-situacao-resp.v1.${app}.${assinatura}.${situacao}.${desafio}.${ts}`,
  conversao: (app, assinatura, usuario, desafio, ts) => `escambo-conversao.v1.${app}.${assinatura}.${usuario}.${desafio}.${ts}`,
  conversaoResp: (app, assinatura, resultado, desafio, ts) => `escambo-conversao-resp.v1.${app}.${assinatura}.${resultado}.${desafio}.${ts}`,
  fim: (app, ts, nonce, corpoHash) => `escambo-fim.v1.${app}.${ts}.${nonce}.${corpoHash}`,
  fimResp: (app, nonce) => `escambo-fim-resp.v1.${app}.${nonce}`,
  revogar: (app, ts, nonce, corpoHash) => `escambo-revogar.v1.${app}.${ts}.${nonce}.${corpoHash}`,
  revogarResp: (app, nonce) => `escambo-revogar-resp.v1.${app}.${nonce}`,
};
export const MOTIVOS_REVOGAR = ['denuncia', 'resgate_falhou', 'reembolso'];

/**
 * Cria o cliente do Escambo. Um mesmo site pode ter vários SaaS no Escambo (cada um com o seu App ID):
 * passe `apps: [{appId, segredo, resgatar?, situacao?}]`. Com um só, basta `appId` + `segredo` (ou as variáveis de ambiente).
 * @param {object} [opcoes]
 * @param {Array<{appId: string, segredo?: string, token?: string, resgatar?: Function, situacao?: Function, depoisDoResgate?: string}>} [opcoes.apps]
 * @param {string} [opcoes.appId]   ESCAMBO_APP_ID (vários? separe por vírgula, na mesma ordem de ESCAMBO_SEGREDO)
 * @param {string} [opcoes.segredo] ESCAMBO_SEGREDO (o "token" do painel)
 * @param {string} [opcoes.caminho] onde o SDK responde no seu site; padrão "/escambo"
 * @param {string} [opcoes.base]    API do Escambo
 * @param {(ctx: object) => Promise<object>} [opcoes.resgatar]  libera o plano para quem abriu o link de resgate (ctx.appId diz qual SaaS)
 * @param {(ctx: object) => Promise<string>} [opcoes.situacao]  diz se a assinatura continua ativa ('ativa' | 'cancelada')
 * @param {(ctx: object) => Promise<boolean|string>} [opcoes.conversao]  (0.4) depois que a troca acaba: essa conta virou cliente pagante? true/false
 * @param {(ctx: object) => Promise<void>} [opcoes.fimDaTroca]  (0.5) a troca desta conta está acabando (momento 'perto', 7 dias antes) ou acabou no prazo ('fim'); traz a oferta de saída do dono, se ele quiser mostrar no seu app.
 *   Encerramento antecipado (denúncia, resgate que falhou, reembolso) NÃO vem por aqui: vem por revogar().
 * @param {(ctx: object) => Promise<void>} [opcoes.revogar]  (0.6) a troca foi encerrada antes do prazo (o comprador denunciou ou disse que o resgate falhou):
 *   tire o plano daquela conta. Recebe {appId, assinatura, usuario, plano, plano_id, motivo}. Seja idempotente; se lançar erro o Escambo tenta de novo.
 * @param {{tem: (chave: string) => Promise<boolean>|boolean, guardar: (chave: string, ttlMs: number) => Promise<void>|void}} [opcoes.nonces]
 *   (0.6) onde guardar os nonces já usados em /fim e /revogar. Padrão: memória do processo (some ao reiniciar). Em serverless ou com vários processos, use Redis/KV/banco.
 * @param {string} [opcoes.depoisDoResgate] para onde mandar a pessoa depois de liberar; padrão "/"
 * @param {(evento: string, dados?: object) => void} [opcoes.log]
 */
export function criarEscambo(opcoes = {}) {
  const env = typeof process !== 'undefined' ? process.env : {};
  const caminho = (opcoes.caminho || env.ESCAMBO_CAMINHO || '/escambo').replace(/\/+$/, '');
  const base = (opcoes.base || env.ESCAMBO_BASE || BASE_PADRAO).replace(/\/+$/, '');
  const log = opcoes.log || (() => {});
  if (!/^\/[A-Za-z0-9/_-]*$/.test(caminho)) throw new Error('Escambo: caminho inválido.');

  // Lista de SaaS atendidos por este servidor. Começa com um; cada SaaS do mesmo domínio entra com o seu App ID.
  let lista = opcoes.apps;
  if (!lista) {
    const ids = String(opcoes.appId || env.ESCAMBO_APP_ID || '').split(',').map((x) => x.trim()).filter(Boolean);
    const sks = String(opcoes.segredo || opcoes.token || env.ESCAMBO_SEGREDO || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (ids.length !== sks.length) throw new Error('Escambo: ESCAMBO_APP_ID e ESCAMBO_SEGREDO precisam ter a mesma quantidade de itens.');
    lista = ids.map((appId, i) => ({appId, segredo: sks[i]}));
  }
  if (!Array.isArray(lista) || !lista.length) throw new Error('Escambo: ESCAMBO_APP_ID ausente ou inválido.');
  const apps = new Map();
  for (const a of lista) {
    const appId = a?.appId, segredo = a?.segredo || a?.token;
    if (!/^esc_app_[0-9a-f]{20}$/.test(String(appId || ''))) throw new Error('Escambo: App ID inválido (' + String(appId || 'vazio') + ').');
    if (!/^esc_sk_[A-Za-z0-9_-]{40,}$/.test(String(segredo || ''))) throw new Error('Escambo: segredo ausente ou inválido para ' + appId + '.');
    if (apps.has(appId)) throw new Error('Escambo: App ID repetido (' + appId + ').');
    const resgatar = a.resgatar || opcoes.resgatar, situacao = a.situacao || opcoes.situacao, conversao = a.conversao || opcoes.conversao, fimDaTroca = a.fimDaTroca || opcoes.fimDaTroca, revogar = a.revogar || opcoes.revogar;
    apps.set(appId, {appId, segredo, resgatar, situacao, conversao, fimDaTroca, revogar, depois: a.depoisDoResgate || opcoes.depoisDoResgate || '/',
      recursos: ['ping', ...(resgatar ? ['resgate'] : []), ...(situacao ? ['situacao'] : []), ...(conversao ? ['conversao'] : []), ...(fimDaTroca ? ['fim'] : []), ...(revogar ? ['revogar'] : [])],
      estado: {conectado: false, ultimoPing: null, ultimoErro: null, serverEstado: null}});
  }
  const unico = apps.size === 1 ? [...apps.values()][0] : null;
  const recursos = [...new Set([...apps.values()].flatMap((a) => a.recursos))];
  const estado = {proximoPing: null, inicio: null, timer: null, falhandoDesde: null};
  // Nonces já usados em /fim e /revogar. Padrão em memória; passe opcoes.nonces para persistir (serverless, reinício, vários processos).
  const memoria = new Map();
  const nonces = opcoes.nonces || {
    tem: (k) => (memoria.get(k) || 0) > Date.now(),
    guardar: (k, ttl) => {
      memoria.set(k, Date.now() + ttl);
      if (memoria.size > 5000) for (const [c, v] of memoria) if (v <= Date.now()) memoria.delete(c);
    },
  };
  if (typeof nonces.tem !== 'function' || typeof nonces.guardar !== 'function') throw new Error('Escambo: nonces precisa de tem(chave) e guardar(chave, ttlMs).');

  // ---------- chamada assinada do seu servidor para o Escambo ----------
  async function chamar(app, acao, rota, dados) {
    const corpo = JSON.stringify(dados);
    const ts = Math.floor(Date.now() / 1000), nonce = randomBytes(18).toString('base64url');
    const assinatura = hmac(app.segredo, PROTOCOLO.chamada(acao, app.appId, ts, nonce, sha256(corpo)));
    const r = await fetch(base + rota, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Escambo-App': app.appId, 'X-Escambo-Ts': String(ts), 'X-Escambo-Nonce': nonce, 'X-Escambo-Assinatura': assinatura},
      body: corpo, signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || 'Escambo respondeu ' + r.status), {status: r.status, codigo: j.error});
    return j;
  }

  // ---------- rotas que o SDK atende no seu site ----------
  // GET {caminho}/status — o Escambo confere se o SDK está no ar (assinado nos dois sentidos).
  function rotaStatus(url, h) {
    const desafio = url.searchParams.get('desafio') || '', ts = Number(url.searchParams.get('ts'));
    const app = apps.get(h['x-escambo-app']);
    if (!app || !/^[0-9a-f]{32}$/.test(desafio) || !Number.isInteger(ts) || !/^[0-9a-f]{64}$/.test(String(h['x-escambo-assinatura'] || '')))
      return json(401, {sdk: SDK, montado: true, recursos, erro: app || !h['x-escambo-app'] ? 'pedido_sem_assinatura' : 'app_desconhecido'});
    if (Math.abs(Date.now() / 1000 - ts) > 300) return json(401, {sdk: SDK, montado: true, erro: 'relogio'});
    if (!iguais(h['x-escambo-assinatura'], hmac(app.segredo, PROTOCOLO.pedido(app.appId, desafio, ts)))) return json(401, {sdk: SDK, montado: true, erro: 'assinatura'});
    app.estado.conectado = true;
    return json(200, {app_id: app.appId, sdk: SDK, recursos: app.recursos, ts, prova: hmac(app.segredo, PROTOCOLO.status(app.appId, desafio, ts))});
  }
  // GET {caminho}/situacao — o Escambo pergunta se a assinatura continua ativa para aquela conta.
  async function rotaSituacao(url, h) {
    const desafio = url.searchParams.get('desafio') || '', ts = Number(url.searchParams.get('ts'));
    const assinatura = url.searchParams.get('assinatura') || '', usuario = url.searchParams.get('usuario') || '';
    const app = apps.get(h['x-escambo-app']);
    if (!app || !/^[0-9a-f]{32}$/.test(desafio) || !Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300 ||
      !iguais(h['x-escambo-assinatura'], hmac(app.segredo, PROTOCOLO.situacao(app.appId, assinatura, usuario, desafio, ts))))
      return json(401, {erro: 'assinatura'});
    if (!app.situacao) return json(501, {erro: 'situacao_nao_configurada'});
    let sit = 'desconhecida';
    try { sit = await app.situacao({appId: app.appId, assinatura, usuario}); } catch (e) { log('situacao_erro', {app: app.appId, erro: e?.message}); }
    if (!['ativa', 'cancelada', 'desconhecida'].includes(sit)) sit = 'desconhecida';
    return json(200, {situacao: sit, prova: hmac(app.segredo, PROTOCOLO.situacaoResp(app.appId, assinatura, sit, desafio, ts))});
  }
  // GET {caminho}/conversao (0.4) — depois que a troca acaba, o Escambo pergunta se aquela conta virou cliente pagante.
  // Só responde sim/não: nenhum dado da pessoa sai do seu servidor.
  async function rotaConversao(url, h) {
    const desafio = url.searchParams.get('desafio') || '', ts = Number(url.searchParams.get('ts'));
    const assinatura = url.searchParams.get('assinatura') || '', usuario = url.searchParams.get('usuario') || '';
    const app = apps.get(h['x-escambo-app']);
    if (!app || !/^[0-9a-f]{32}$/.test(desafio) || !Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300 ||
      !iguais(h['x-escambo-assinatura'], hmac(app.segredo, PROTOCOLO.conversao(app.appId, assinatura, usuario, desafio, ts))))
      return json(401, {erro: 'assinatura'});
    if (!app.conversao) return json(501, {erro: 'conversao_nao_configurada'});
    let resultado = 'desconhecida';
    try {
      const v = await app.conversao({appId: app.appId, assinatura, usuario});
      resultado = v === true || v === 'pagante' ? 'pagante' : v === false || v === 'nao' ? 'nao' : 'desconhecida';
    } catch (e) { log('conversao_erro', {app: app.appId, erro: e?.message}); }
    return json(200, {resultado, prova: hmac(app.segredo, PROTOCOLO.conversaoResp(app.appId, assinatura, resultado, desafio, ts))});
  }
  // GET {caminho}/resgatar?app=…&token=… — a pessoa abre o link que recebeu no Escambo, logada no seu SaaS.
  // 1) confere o token no Escambo  2) chama a sua função resgatar()  3) confirma no Escambo (o token morre aí).
  // "app" diz qual dos SaaS deste domínio vai liberar o plano.
  async function rotaResgatar(url, req) {
    const app = apps.get(url.searchParams.get('app') || '') || (url.searchParams.get('app') ? null : unico);
    if (!app) return pagina(400, 'Link inválido', 'Este link de resgate não é de nenhum SaaS deste site. Abra de novo pelo app do Escambo.');
    if (!app.resgatar) return pagina(501, 'Resgate ainda não configurado', 'Este SaaS ainda não configurou o resgate do Escambo.');
    const token = url.searchParams.get('token') || '';
    if (!/^esc_rg_[A-Za-z0-9_-]{30,40}$/.test(token)) return pagina(400, 'Link inválido', 'Este link de resgate está incompleto. Abra de novo pelo app do Escambo.');
    let info;
    // O Escambo reserva o link por alguns minutos: outra aba com o mesmo link não libera o plano de novo.
    try { info = await chamar(app, 'resgate-consultar', '/sdk/resgate/consultar', {token, reservar: true}); }
    catch (e) { return pagina(e.status === 409 ? 409 : 400, e.codigo === 'ESCAMBO_TOKEN_EM_USO' ? 'Link em uso' : e.status === 409 ? 'Link já usado' : 'Não deu para resgatar', e.message); }
    const reserva = info.reserva || undefined;
    const liberar = () => chamar(app, 'resgate-liberar', '/sdk/resgate/liberar', {token, reserva}).catch(() => {});
    let r;
    // Use ctx.token como chave de idempotência ao liberar o plano: se a confirmação falhar e a pessoa tentar de novo,
    // a sua função não deve dar o plano duas vezes.
    try { r = await app.resgatar({...info.assinatura, appId: app.appId, token, req}); }
    catch (e) { await liberar(); log('resgatar_erro', {app: app.appId, erro: e?.message}); return pagina(500, 'Não deu para liberar o plano', e?.message || 'Tente de novo.'); }
    if (r?.redirecionar) { await liberar(); return {status: 302, headers: {Location: r.redirecionar, 'Cache-Control': 'no-store'}, corpo: ''}; }
    if (!r?.usuario) { await liberar(); return pagina(500, 'Não deu para liberar o plano', 'A função resgatar() precisa devolver { usuario } ou { redirecionar }.'); }
    try { await chamar(app, 'resgate-confirmar', '/sdk/resgate/confirmar', {token, reserva, usuario: String(r.usuario)}); }
    catch (e) { return pagina(400, 'Não deu para confirmar', e.message); }
    log('resgatado', {app: app.appId, assinatura: info.assinatura.id, teste: info.assinatura.teste});
    if (info.assinatura.teste) return pagina(200, 'Resgate de teste funcionou', 'A integração está certa. Pode voltar para o Escambo.');
    return {status: 302, headers: {Location: r.destino || app.depois, 'Cache-Control': 'no-store'}, corpo: ''};
  }
  const json = (status, o) => ({status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}, corpo: JSON.stringify(o)});
  const pagina = (status, titulo, texto) => ({status, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'},
    corpo: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(titulo) + '</title>' +
      '<body style="font-family:system-ui,sans-serif;background:#0B0B0C;color:#F5F7FA;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px">' +
      '<main style="max-width:420px"><h1 style="font-size:22px">' + esc(titulo) + '</h1><p style="color:#C3CAD2;line-height:1.5">' + esc(texto) + '</p></main></body>'});
  const lerHeaders = (h) => {
    const out = {};
    for (const k of ['x-escambo-app', 'x-escambo-assinatura']) out[k] = typeof h?.get === 'function' ? h.get(k) || undefined : (Array.isArray(h?.[k]) ? h[k][0] : h?.[k]);
    return out;
  };
  // ---------- POST assinados (Escambo → SaaS): /fim (0.5) e /revogar (0.6) ----------
  // Autentica o que dá antes de ler o corpo (app, relógio de ±5 min, formato do nonce e nonce inédito), lê no máximo 16 KB
  // em bytes, confere o HMAC do sha256 desses bytes e só então gasta o nonce.
  const resp413 = () => { const r = json(413, {erro: 'corpo_grande'}); r.headers.Connection = 'close'; return r; };
  async function lerCorpo(req, cl) {
    if (Number(cl) > LIMITE_CORPO) return {resp: resp413()};
    const pronto = (b) => b.length > LIMITE_CORPO ? {resp: resp413()} : {buf: b};
    if (req?.rawBody != null) return pronto(Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody), 'utf8'));
    if (typeof req?.text === 'function') { // Request (fetch): lê em pedaços até o limite
      if (req.bodyUsed) return {resp: json(400, {erro: 'corpo_consumido'})};
      const leitor = req.body?.getReader?.(), partes = [];
      let n = 0;
      if (leitor) for (;;) {
        const {done, value} = await leitor.read();
        if (done) break;
        n += value.length;
        if (n > LIMITE_CORPO) { leitor.cancel().catch(() => {}); return {resp: resp413()}; }
        partes.push(Buffer.from(value));
      }
      return {buf: Buffer.concat(partes, n)};
    }
    if (Buffer.isBuffer(req?.body) || typeof req?.body === 'string') return pronto(Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body, 'utf8')); // express.raw / express.text
    if ((req?.body && typeof req.body === 'object') || req?.readableEnded)
      return {resp: json(400, {erro: 'corpo_consumido', dica: 'monte o middleware do Escambo antes do express.json()'})};
    return new Promise((ok) => { // Node http: junta Buffers e decodifica uma vez só
      const partes = [];
      let n = 0;
      const sair = (v) => { req.off('data', dado); req.off('end', fim); req.off('error', erro); ok(v); };
      const dado = (c) => {
        c = Buffer.isBuffer(c) ? c : Buffer.from(c);
        n += c.length;
        if (n > LIMITE_CORPO) { req.pause?.(); sair({resp: resp413()}); } else partes.push(c);
      };
      const fim = () => sair({buf: Buffer.concat(partes, n)});
      const erro = () => sair({resp: json(400, {erro: 'corpo'})});
      req.on('data', dado); req.on('end', fim); req.on('error', erro);
    });
  }
  async function postAssinado(tipo, h, req) {
    const app = apps.get(h['x-escambo-app']), ts = Number(h['x-escambo-ts']), nonce = String(h['x-escambo-nonce'] || ''), sig = String(h['x-escambo-assinatura'] || '');
    if (!app || !/^[0-9a-f]{16,64}$/.test(nonce) || !Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300 || !/^[0-9a-f]{64}$/.test(sig))
      return {resp: json(401, {erro: 'assinatura'})};
    const chave = 'escambo:' + app.appId + ':' + nonce;
    if (await nonces.tem(chave)) return {resp: json(409, {erro: 'repetido'})};
    const c = await lerCorpo(req, h['content-length']);
    if (c.resp) return c;
    if (!iguais(sig, hmac(app.segredo, PROTOCOLO[tipo](app.appId, ts, nonce, sha256(c.buf))))) return {resp: json(401, {erro: 'assinatura'})};
    if (await nonces.tem(chave)) return {resp: json(409, {erro: 'repetido'})};
    await nonces.guardar(chave, 10 * MIN);
    let info;
    try { info = JSON.parse(c.buf.toString('utf8') || '{}'); } catch { return {resp: json(400, {erro: 'json'})}; }
    return {app, nonce, info: info && typeof info === 'object' ? info : {}};
  }
  // POST {caminho}/fim (0.5) — a troca de uma conta está acabando (momento 'perto') ou acabou no prazo ('fim').
  // A sua função recebe {appId, assinatura, usuario, plano, plano_id, meses, expira, momento, oferta}. Encerramento antecipado vem por /revogar.
  async function rotaFim(h, req) {
    const r = await postAssinado('fim', h, req);
    if (r.resp) return r.resp;
    const {app, info} = r;
    if (!app.fimDaTroca) return json(501, {erro: 'fim_nao_configurado'});
    try { await app.fimDaTroca({appId: app.appId, assinatura: info.assinatura, usuario: info.usuario, plano: info.plano, plano_id: info.plano_id,
      meses: info.meses, expira: info.expira, momento: info.momento === 'fim' ? 'fim' : 'perto', oferta: info.oferta || null}); }
    catch (e) { log('fim_erro', {app: app.appId, erro: e?.message}); }
    return json(200, {ok: true, prova: hmac(app.segredo, PROTOCOLO.fimResp(app.appId, r.nonce))});
  }
  // POST {caminho}/revogar (0.6) — a troca foi encerrada antes do prazo (denúncia do comprador, resgate que falhou ou reembolso).
  // Vale para os dois lados: o dono deixa de receber e o comprador perde o plano. A sua função tira o plano da conta.
  // Erro na sua função = 500 e o Escambo tenta de novo (com ts e nonce novos): seja idempotente.
  async function rotaRevogar(h, req) {
    const r = await postAssinado('revogar', h, req);
    if (r.resp) return r.resp;
    const {app, info} = r;
    if (!app.revogar) return json(501, {erro: 'revogar_nao_configurado'});
    if (typeof info.assinatura !== 'string' || !info.assinatura) return json(400, {erro: 'assinatura_ausente'});
    const motivo = MOTIVOS_REVOGAR.includes(info.motivo) ? info.motivo : 'denuncia';
    try { await app.revogar({appId: app.appId, assinatura: info.assinatura, usuario: info.usuario == null ? null : String(info.usuario), plano: info.plano ?? null, plano_id: info.plano_id ?? null, motivo}); }
    catch (e) { log('revogar_erro', {app: app.appId, erro: e?.message}); return json(500, {erro: 'revogar_falhou'}); }
    log('revogado', {app: app.appId, assinatura: info.assinatura, motivo});
    return json(200, {ok: true, prova: hmac(app.segredo, PROTOCOLO.revogarResp(app.appId, r.nonce))});
  }
  async function atender(method, url, headers, req) {
    if (method === 'POST' && (url.pathname === caminho + '/fim' || url.pathname === caminho + '/revogar')) {
      const h = lerHeaders(headers);
      for (const k of ['x-escambo-ts', 'x-escambo-nonce', 'content-length']) h[k] = typeof headers?.get === 'function' ? headers.get(k) || undefined : (Array.isArray(headers?.[k]) ? headers[k][0] : headers?.[k]);
      return url.pathname === caminho + '/fim' ? rotaFim(h, req) : rotaRevogar(h, req);
    }
    if (method !== 'GET') return null;
    if (url.pathname === caminho + '/status') return rotaStatus(url, lerHeaders(headers));
    if (url.pathname === caminho + '/situacao') return rotaSituacao(url, lerHeaders(headers));
    if (url.pathname === caminho + '/conversao') return rotaConversao(url, lerHeaders(headers));
    if (url.pathname === caminho + '/resgatar') return rotaResgatar(url, req);
    return null;
  }

  /** Middleware para Node http, Express, Connect. Chama next() fora das rotas do Escambo. */
  function middleware(req, res, next) {
    const url = new URL(req.originalUrl || req.url || '/', 'http://local');
    atender(req.method, url, req.headers, req).then((r) => {
      if (!r) { if (next) return next(); res.statusCode = 404; res.end(); return; }
      res.statusCode = r.status;
      for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
      res.end(r.corpo);
    }, (e) => { if (next) next(e); else { res.statusCode = 500; res.end(); } });
  }
  /** Para runtimes com Request/Response (Next.js App Router, Hono, Bun, Deno, Workers). Devolve null fora das rotas. */
  async function responder(request) {
    const r = await atender(request.method, new URL(request.url), request.headers, request);
    return r ? new Response(r.corpo || null, {status: r.status, headers: r.headers}) : null;
  }

  // ---------- batimento: avisa o Escambo que o SaaS está no ar (um por App ID) ----------
  async function pingApp(app) {
    try {
      const j = await chamar(app, 'ping', '/sdk/ping', {sdk: SDK, recursos: app.recursos, node: typeof process !== 'undefined' ? process.version : undefined});
      Object.assign(app.estado, {conectado: true, ultimoPing: Date.now(), ultimoErro: null, serverEstado: j.estado});
      log('ping', {app: app.appId, estado: j.estado, proximo_ping_s: j.proximo_ping_s});
      // Saiu versão nova do SDK: avisa no log do servidor (uma vez por dia). Mais de 30 dias numa versão velha = dormência.
      if (j.atualizar && Date.now() - (estado.avisouVersao || 0) > 24 * 60 * MIN) {
        estado.avisouVersao = Date.now();
        const tag = /^\d+\.\d+\.\d+$/.test(String(j.sdk_ultima || '')) ? '#v' + j.sdk_ultima : '#v<versão>';
        const msg = 'Escambo: saiu o SDK ' + j.sdk_ultima + ' (você usa ' + VERSAO + '). Atualize fixando a tag: npm i github:eloimdev/escambo-sdk' + tag;
        log('atualizacao', {atual: VERSAO, ultima: j.sdk_ultima});
        if (!opcoes.log) console.warn(msg);
      }
      if (j.dormente) log('dormente', {app: app.appId});
      return {appId: app.appId, ok: true, ...j};
    } catch (e) {
      app.estado.ultimoErro = e.message || String(e);
      log('ping_falhou', {app: app.appId, status: e.status, erro: app.estado.ultimoErro});
      return {appId: app.appId, ok: false, status: e.status, erro: app.estado.ultimoErro};
    }
  }
  /** Manda um batimento de cada App ID. Com um só, devolve o resultado dele; com vários, {ok, apps:[…]}. */
  async function ping() {
    const r = await Promise.all([...apps.values()].map(pingApp));
    if (unico) return r[0];
    return {ok: r.every((x) => x.ok), proximo_ping_s: Math.min(...r.map((x) => Number(x.proximo_ping_s) || 60)), apps: r};
  }
  // Ritmo: o Escambo pede um batimento por minuto. Se o seu servidor parar, em 3 min ele aparece como instável
  // e em 10 min como desconectado. Se o ping falhar (ex.: Escambo fora do ar), tenta de novo a cada 1 min por 10 min,
  // depois a cada 30 min e, passados 40 min, de hora em hora. No primeiro ping aceito, volta para 60 s.
  function agendar(ms) {
    clearTimeout(estado.timer);
    estado.proximoPing = Date.now() + ms;
    estado.timer = setTimeout(rodada, ms);
    estado.timer.unref?.();
  }
  function espera(r) {
    if (r.ok) { estado.falhandoDesde = null; return Math.max(30, Number(r.proximo_ping_s) || 60) * 1000; }
    estado.falhandoDesde ??= Date.now();
    const parado = Date.now() - estado.falhandoDesde;
    return parado < 10 * MIN ? MIN : parado < 40 * MIN ? 30 * MIN : 60 * MIN;
  }
  async function rodada() { agendar(espera(await ping())); }
  /** Começa o batimento em segundo plano (servidor sempre ligado). Em serverless, chame ping() num cron de 1 min. */
  function iniciar() { if (estado.inicio) return; estado.inicio = Date.now(); agendar(0); }
  function parar() { clearTimeout(estado.timer); estado.timer = null; estado.inicio = null; }
  const umStatus = (a) => ({appId: a.appId, recursos: a.recursos, conectado: a.estado.conectado, estado: a.estado.serverEstado, ultimoPing: a.estado.ultimoPing, ultimoErro: a.estado.ultimoErro});
  const status = () => ({...(unico ? umStatus(unico) : {}), caminho, base, recursos, proximoPing: estado.proximoPing, apps: [...apps.values()].map(umStatus)});
  const appIds = [...apps.keys()];

  return {middleware, responder, ping, iniciar, parar, status, caminho, appId: appIds[0], appIds, recursos};
}

export default criarEscambo;
