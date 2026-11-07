# Escambo SDK

Conecta o seu SaaS ao **Escambo**, o lugar onde donos de SaaS trocam assinaturas entre si.

O SDK faz duas coisas:

1. **Responde ao Escambo** em `GET /escambo/status`. O Escambo manda um desafio assinado e o SDK devolve uma prova, feita com o seu segredo. Assim o Escambo sabe que o seu site está no ar e que a integração é sua.
2. **Avisa o Escambo** com um ping assinado. Até conectar, o ping é frequente: a cada 30 s nos primeiros 5 min, depois a cada 5 min. Depois de conectar, é 1 vez por hora no primeiro dia e 1 vez por dia daí em diante.

Ele não tem dependências e funciona no Node 18.17 ou mais novo.

> Esta versão (0.1) cuida só da conexão. O resgate das figurinhas (liberar o plano para quem trocou) chega na 0.2.

## Passo a passo

### 1. Cadastre o SaaS

1. Entre em **https://dev.rande.dev/apps/escambo/** com a sua conta Rande ID.
2. Vá em **Painel → Adicionar SaaS** e cole o link do seu site. A leitura monta a ficha com os planos.
3. Revise e publique. O app segue direto para a verificação.

### 2. Verifique o domínio

O app mostra um registro **TXT** para criar no DNS do seu domínio (nome `_escambo`, valor `escambo-verificacao=...`). O passo a passo por provedor (Cloudflare, Registro.br, Vercel, Hostinger, Route 53…) está em **[docs/DNS.md](docs/DNS.md)**. O app também tem um botão que copia um prompt pronto para você mandar para a sua IA.

O Escambo checa sozinho a cada minuto e tem o botão **Checar agora**. Quando o domínio é verificado:

- o SaaS entra no catálogo;
- você ganha conchas de bônus;
- o app gera o **App ID** e o **token** do SDK. O token fica só no seu painel.

### 3. Instale

```bash
npm i github:eloimdev/escambo-sdk
```

Grave as chaves no `.env`. O comando não apaga nada que já estiver lá:

```bash
npx escambo init --app esc_app_xxxxxxxx --token esc_sk_xxxxxxxx
```

### 4. Monte a rota

**Express / Connect / Node http**

```js
import express from 'express';
import {criarEscambo} from '@rande/escambo';

const app = express();
const escambo = criarEscambo();   // lê ESCAMBO_APP_ID e ESCAMBO_SEGREDO
app.use(escambo.middleware);      // responde em /escambo/status
escambo.iniciar();                // começa a pingar o Escambo
```

**Next.js (App Router)**: crie `app/escambo/status/route.js`:

```js
import {criarEscambo} from '@rande/escambo';
const escambo = criarEscambo();
export const dynamic = 'force-dynamic';
export async function GET(request) {
  return (await escambo.responder(request)) ?? new Response('Not found', {status: 404});
}
```

Em serverless (Vercel, Netlify, Workers), não use `iniciar()`, porque o processo não fica vivo. Chame `await escambo.ping()` num cron de hora em hora. O Escambo também checa o seu site sozinho, então a conexão aparece mesmo sem ping.

**Hono, Bun, Deno ou qualquer runtime com `Request`/`Response`**: use `escambo.responder(request)`. Ele devolve `null` fora da rota.

### 5. Teste

```bash
npx escambo testar https://seu-dominio.com   # faz o mesmo pedido que o Escambo
npx escambo ping                             # avisa o Escambo agora
```

No app, o passo **Conecte o SDK** muda para **Conectado** assim que chega o primeiro ping.

## API

| | |
|---|---|
| `criarEscambo({appId, segredo, caminho, base, log})` | Cria o cliente. Os valores padrão vêm de `ESCAMBO_APP_ID`, `ESCAMBO_SEGREDO`, `ESCAMBO_CAMINHO` (`/escambo`) e `ESCAMBO_BASE`. |
| `escambo.middleware(req, res, next)` | Responde em `{caminho}/status` e chama `next()` no resto. |
| `escambo.responder(request)` | Mesma coisa para `Request`. Devolve `Response` ou `null`. |
| `escambo.ping()` | Manda um ping assinado. Devolve `{ok, estado, proximo_ping_s}`. |
| `escambo.iniciar()` / `parar()` | Liga ou desliga os pings automáticos. |
| `escambo.status()` | Estado local: `conectado`, `ultimoPing`, `proximoPing` e `ultimoErro`. |

Se usar outro caminho, por exemplo `/api/escambo`, informe o mesmo no painel em **Caminho do SDK**.

## Segurança

- O segredo nunca sai do seu servidor. As mensagens levam só a assinatura HMAC-SHA256.
- Pedidos com mais de 5 min de diferença de relógio são recusados, e o Escambo recusa nonce repetido.
- O SDK responde 401 a qualquer pedido sem assinatura válida.
- O protocolo está em [PROTOCOLO.md](PROTOCOLO.md), para implementar em outra linguagem.

## Licença

MIT
