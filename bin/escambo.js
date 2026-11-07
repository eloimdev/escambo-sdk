#!/usr/bin/env node
// CLI do Escambo: configurar, conferir o DNS, testar a rota e pingar.
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import {createHmac, randomBytes} from 'node:crypto';
import {criarEscambo, PROTOCOLO, VERSAO} from '../src/index.js';

const [, , comando, ...args] = process.argv;
const flag = (nome) => {const i = args.indexOf('--' + nome); return i >= 0 ? args[i + 1] : undefined;};
const ok = (m) => console.log('✓ ' + m), erro = (m) => {console.error('✗ ' + m); process.exitCode = 1;};

// Lê .env da pasta atual (sem sobrescrever o que já está no ambiente).
function carregarEnv() {
  const arq = path.resolve('.env');
  if (!fs.existsSync(arq)) return;
  for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const ajuda = `escambo ${VERSAO}

  escambo init --app esc_app_... --token esc_sk_...     grava as chaves no .env (sem apagar nada)
  escambo dns seu-dominio.com                           confere o registro TXT _escambo
  escambo testar https://seu-dominio.com                faz o mesmo pedido que o Escambo faz à sua rota
  escambo ping                                          avisa o Escambo que o SDK está no ar
`;

async function main() {
  if (comando === 'init') {
    const app = flag('app'), segredo = flag('token') || flag('segredo'), caminho = flag('caminho');
    if (!app || !segredo) return erro('Use: escambo init --app esc_app_... --token esc_sk_...');
    const arq = path.resolve('.env');
    const atual = fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8') : '';
    const linhas = [];
    const ids = atual.match(/^ESCAMBO_APP_ID=(.*)$/m), sks = atual.match(/^ESCAMBO_SEGREDO=(.*)$/m);
    if (ids && sks) {
      // Outro SaaS no mesmo site: entra na lista (mesma ordem nas duas variáveis).
      const lista = ids[1].split(',').map((x) => x.trim()).filter(Boolean);
      if (lista.includes(app)) return ok('.env já tem o App ' + app + '. Para trocar o token, edite o arquivo.');
      const novo = atual.replace(/^ESCAMBO_APP_ID=.*$/m, 'ESCAMBO_APP_ID=' + [...lista, app].join(','))
        .replace(/^ESCAMBO_SEGREDO=.*$/m, 'ESCAMBO_SEGREDO=' + [...sks[1].split(',').map((x) => x.trim()).filter(Boolean), segredo].join(','));
      fs.writeFileSync(arq, novo);
      return ok('App ' + app + ' adicionado à lista em .env (agora são ' + (lista.length + 1) + ' SaaS neste servidor).');
    }
    if (!ids) linhas.push('ESCAMBO_APP_ID=' + app);
    if (!sks) linhas.push('ESCAMBO_SEGREDO=' + segredo);
    if (caminho && !/^ESCAMBO_CAMINHO=/m.test(atual)) linhas.push('ESCAMBO_CAMINHO=' + caminho);
    fs.appendFileSync(arq, (atual && !atual.endsWith('\n') ? '\n' : '') + '# Escambo\n' + linhas.join('\n') + '\n');
    ok('Chaves gravadas em .env. Confira se .env está no .gitignore.');
    const gi = path.resolve('.gitignore');
    if (!fs.existsSync(gi) || !/^\.env$/m.test(fs.readFileSync(gi, 'utf8'))) console.log('  Atenção: .env não está no .gitignore.');
    return;
  }
  if (comando === 'dns') {
    const dominio = String(args[0] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (!dominio) return erro('Use: escambo dns seu-dominio.com');
    try {
      const regs = (await dns.resolveTxt('_escambo.' + dominio)).map((p) => p.join(''));
      const achou = regs.filter((r) => r.startsWith('escambo-verificacao='));
      if (!achou.length) return erro('Há TXT em _escambo.' + dominio + ', mas nenhum começa com escambo-verificacao=');
      ok('Registro encontrado: ' + achou.join(', '));
      console.log('  Agora toque em "Verificar domínio" no painel do Escambo.');
    } catch {erro('Nenhum TXT em _escambo.' + dominio + '. Crie o registro e espere alguns minutos.');}
    return;
  }
  carregarEnv();
  if (comando === 'testar') {
    const site = String(args[0] || '').replace(/\/+$/, '');
    if (!/^https?:\/\//.test(site)) return erro('Use: escambo testar https://seu-dominio.com');
    const caminho = (process.env.ESCAMBO_CAMINHO || '/escambo');
    const apps = String(process.env.ESCAMBO_APP_ID || '').split(',').map((x) => x.trim()).filter(Boolean);
    const sks = String(process.env.ESCAMBO_SEGREDO || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!apps.length || apps.length !== sks.length) return erro('Defina ESCAMBO_APP_ID e ESCAMBO_SEGREDO (ou rode escambo init).');
    for (let i = 0; i < apps.length; i++) if (!(await testar(site, caminho, apps[i], sks[i]))) return;
    return;
  }
  async function testar(site, caminho, app, segredo) {
    const desafio = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000);
    const assinatura = createHmac('sha256', segredo).update(PROTOCOLO.pedido(app, desafio, ts)).digest('hex');
    const alvo = site + caminho + '/status?desafio=' + desafio + '&ts=' + ts;
    let r;
    try {r = await fetch(alvo, {headers: {'X-Escambo-App': app, 'X-Escambo-Assinatura': assinatura}, redirect: 'manual', signal: AbortSignal.timeout(8000)});}
    catch (e) {erro('Não consegui abrir ' + alvo + ': ' + (e?.cause?.code || e.message)); return false;}
    const j = await r.json().catch(() => null);
    if (r.status === 404) {erro('404 em ' + caminho + '/status. O middleware do Escambo está montado?'); return false;}
    if (r.status !== 200) {erro(app + ': a rota respondeu ' + r.status + (j?.erro ? ' (' + j.erro + ')' : '') + '.'); return false;}
    const esperado = createHmac('sha256', segredo).update(PROTOCOLO.status(app, desafio, ts)).digest('hex');
    if (j?.prova !== esperado) {erro(app + ': a prova não confere. O servidor usa o mesmo ESCAMBO_SEGREDO?'); return false;}
    ok(app + ': ' + caminho + '/status respondeu certo (' + (j.sdk || 'sdk') + ').');
    return true;
  }
  if (comando === 'ping') {
    let esc;
    try {esc = criarEscambo();} catch (e) {return erro(e.message);}
    const r = await esc.ping();
    for (const x of r.apps || [r]) {
      if (x.ok) ok('Ping aceito' + (r.apps ? ' (' + x.appId + ')' : '') + '. Estado no Escambo: ' + x.estado + '. Próximo ping em ' + x.proximo_ping_s + ' s.');
      else erro('Ping recusado' + (r.apps ? ' (' + x.appId + ')' : '') + ': ' + x.erro);
    }
    return;
  }
  console.log(ajuda);
}
main().catch((e) => erro(e?.message || String(e)));
