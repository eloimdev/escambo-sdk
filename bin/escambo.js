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
    if (!/^ESCAMBO_APP_ID=/m.test(atual)) linhas.push('ESCAMBO_APP_ID=' + app);
    if (!/^ESCAMBO_SEGREDO=/m.test(atual)) linhas.push('ESCAMBO_SEGREDO=' + segredo);
    if (caminho && !/^ESCAMBO_CAMINHO=/m.test(atual)) linhas.push('ESCAMBO_CAMINHO=' + caminho);
    if (!linhas.length) return ok('.env já tem as chaves do Escambo. Para trocar, edite o arquivo.');
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
    const app = process.env.ESCAMBO_APP_ID, segredo = process.env.ESCAMBO_SEGREDO, caminho = (process.env.ESCAMBO_CAMINHO || '/escambo');
    if (!app || !segredo) return erro('Defina ESCAMBO_APP_ID e ESCAMBO_SEGREDO (ou rode escambo init).');
    const desafio = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000);
    const assinatura = createHmac('sha256', segredo).update(PROTOCOLO.pedido(app, desafio, ts)).digest('hex');
    const alvo = site + caminho + '/status?desafio=' + desafio + '&ts=' + ts;
    let r;
    try {r = await fetch(alvo, {headers: {'X-Escambo-App': app, 'X-Escambo-Assinatura': assinatura}, redirect: 'manual', signal: AbortSignal.timeout(8000)});}
    catch (e) {return erro('Não consegui abrir ' + alvo + ': ' + (e?.cause?.code || e.message));}
    const j = await r.json().catch(() => null);
    if (r.status === 404) return erro('404 em ' + caminho + '/status. O middleware do Escambo está montado?');
    if (r.status !== 200) return erro('A rota respondeu ' + r.status + (j?.erro ? ' (' + j.erro + ')' : '') + '.');
    const esperado = createHmac('sha256', segredo).update(PROTOCOLO.status(app, desafio, ts)).digest('hex');
    if (j?.prova !== esperado) return erro('A prova não confere. O servidor usa o mesmo ESCAMBO_SEGREDO?');
    ok('Rota ' + caminho + '/status respondeu certo (' + (j.sdk || 'sdk') + '). O Escambo vai conseguir checar o seu site.');
    return;
  }
  if (comando === 'ping') {
    let esc;
    try {esc = criarEscambo();} catch (e) {return erro(e.message);}
    const r = await esc.ping();
    if (r.ok) ok('Ping aceito. Estado no Escambo: ' + r.estado + '. Próximo ping em ' + r.proximo_ping_s + ' s.');
    else erro('Ping recusado: ' + r.erro);
    return;
  }
  console.log(ajuda);
}
main().catch((e) => erro(e?.message || String(e)));
