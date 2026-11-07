# Escambo SDK

Conecta o seu SaaS ao **Escambo**, o lugar onde donos de SaaS trocam assinaturas entre si.

O SDK cuida de tudo o que liga o seu SaaS ao Escambo, sempre assinado com o seu segredo (HMAC) e com proteção contra repetição:

1. **Batimento:** um ping a cada 60 s diz que o seu servidor está no ar. Sem ping há 3 min, o SaaS aparece instável; há 10 min, desconectado.
2. **Resgate:** quem pegou uma assinatura no Escambo abre o link de resgate (vale 72 h) logado no seu SaaS, e a sua função `resgatar()` libera o plano.
3. **Situação:** uma vez por semana o Escambo pergunta se a assinatura continua ativa (`situacao()`).
4. **Conversão (0.4):** depois que a troca acaba, o Escambo pergunta se aquela conta virou cliente pagante (`conversao()`, só sim/não).
5. **Fim da troca (0.5):** 7 dias antes do fim e quando acaba, o Escambo avisa o seu app e manda a sua oferta de saída (`fimDaTroca()`).

Ele não tem dependências e funciona no Node 18.17 ou mais novo.

> Versão atual: **0.5.0**. Mantenha o SDK atualizado: 30 dias numa versão velha deixam o SaaS em dormência.

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

### 4. Monte o SDK: batimento + resgate

O SDK cuida das rotas no seu site (`/escambo/status`, `/escambo/resgatar`, `/escambo/situacao` e, desde a 0.4, `/escambo/conversao`) e do batimento.

**Novo na 0.5 — fim da troca e oferta de saída no seu app.** Passe `fimDaTroca: async ({usuario, momento, expira, plano, oferta}) => {...}`. O Escambo avisa 7 dias antes do fim (`momento: "perto"`) e quando acaba (`"fim"`), uma vez cada, assinado. Se você cadastrou no painel uma oferta de saída marcada para "no seu app", ela vem em `oferta` (`{texto, codigo, link}`). O `texto` é o que você escreveu, do jeito que escreveu (o Escambo não interpreta percentuais): mostre na sua tela de renovação, e use `codigo`/`link` para aplicar o desconto no seu checkout. Rota: `POST {caminho}/fim` (no Next.js, exporte também o `POST`).

**Novo na 0.4 — conversão depois da troca.** Passe `conversao: async ({usuario}) => clientePagante(usuario)` (true/false). Uns dias depois que a troca termina, o Escambo pergunta (assinado) se aquela conta virou cliente pagante e mostra no seu painel quantas trocas viraram clientes. Só sai sim ou não do seu servidor.

**Express / Connect / Node http**

```js
import express from 'express';
import {criarEscambo} from '@rande/escambo';

const app = express();
const escambo = criarEscambo({
  // Quem pegou uma assinatura no Escambo abre /escambo/resgatar?token=… LOGADO no seu SaaS.
  // Libere o plano grátis pela duração e devolva o id da conta. Sem login? Mande para o login e volte.
  async resgatar({plano, meses, teste, req}) {
    const usuario = await usuarioLogado(req);              // a sua função de sessão
    if (!usuario) return {redirecionar: '/login?voltar=' + encodeURIComponent(req.originalUrl)};
    if (!teste) await liberarPlano(usuario.id, plano, meses); // ex.: plano Pro grátis por N meses
    return {usuario: usuario.id};                          // o Escambo guarda esse id
  },
  // Uma vez por semana o Escambo pergunta se a assinatura continua ativa para aquela conta.
  async situacao({usuario}) {
    return (await planoAtivo(usuario)) ? 'ativa' : 'cancelada';
  },
  // 0.4: depois que a troca acaba, essa conta virou cliente pagante?
  async conversao({usuario}) {
    return await clientePagante(usuario);                  // true/false
  },
  // 0.5: a troca está acabando ('perto') ou acabou ('fim'); oferta = a sua oferta de saída, se for para o app
  async fimDaTroca({usuario, momento, expira, oferta}) {
    await guardarAvisoDeRenovacao(usuario, {momento, expira, oferta}); // mostre na próxima vez que a pessoa entrar
  },
});
app.use(escambo.middleware);   // responde em /escambo/*
escambo.iniciar();             // batimento a cada 60 s
```

**Next.js (App Router)**: crie `app/escambo/[...rota]/route.js`:

```js
import {criarEscambo} from '@rande/escambo';
const escambo = criarEscambo({resgatar: async ({request}) => {/* ... */}, situacao: async () => 'ativa'});
export const dynamic = 'force-dynamic';
export async function GET(request) {
  return (await escambo.responder(request)) ?? new Response('Not found', {status: 404});
}
export const POST = GET; // 0.5: o aviso de fim da troca chega por POST {caminho}/fim
```

No `responder`, a sua função `resgatar` recebe o `Request` em `req`.

**Atualizações:** quando sai uma versão nova, o SDK avisa no log do servidor e o painel do Escambo mostra um prompt para a sua IA atualizar. Fique mais de 30 dias numa versão velha, ou mais de 3 dias desconectado, e o SaaS entra em dormência: sai do catálogo até você atualizar ou reconectar.

**Se cair:** a conexão volta sozinha. Com o servidor de pé de novo, o primeiro batimento reconecta. Enquanto o ping falha, o SDK tenta a cada 1 min por 10 min, depois a cada 30 min e, passados 40 min, de hora em hora.

**Serverless (Vercel, Netlify, Workers):** o processo não fica vivo, então não use `iniciar()`. Chame `await escambo.ping()` num cron de 1 em 1 minuto. Sem batimento, o Escambo mostra o SaaS como instável em 3 min e desconectado em 10 min.

### Vários SaaS no mesmo site

Cada SaaS cadastrado no Escambo tem o seu App ID e o seu token, mesmo que vários morem no mesmo domínio (ex.: `app.com/editor` e `app.com/agenda`). Um único SDK atende todos: passe uma lista em `apps`. No começo ela tem um item só; cada SaaS novo entra com mais um.

```js
const escambo = criarEscambo({
  apps: [
    {appId: process.env.ESCAMBO_APP_EDITOR, segredo: process.env.ESCAMBO_SEGREDO_EDITOR, resgatar: liberarEditor},
    {appId: process.env.ESCAMBO_APP_AGENDA, segredo: process.env.ESCAMBO_SEGREDO_AGENDA, resgatar: liberarAgenda},
  ],
  situacao: async ({appId, usuario}) => (await planoAtivo(appId, usuario)) ? 'ativa' : 'cancelada', // vale para os dois
});
```

- Cada pedido do Escambo leva o App ID no cabeçalho, e o link de resgate leva `?app=`. Assim o SDK sabe qual SaaS libera o plano.
- Um token de um SaaS não serve no outro.
- Sem lista, dá para usar só variáveis de ambiente: `ESCAMBO_APP_ID=esc_app_a,esc_app_b` e `ESCAMBO_SEGREDO=esc_sk_a,esc_sk_b`, na mesma ordem.
- No DNS, cada SaaS tem o seu registro TXT em `_escambo.seu-dominio`. Mantenha todos: um nome pode ter vários TXT.

### 5. Teste

```bash
npx escambo ping                             # o SDK manda um batimento agora
npx escambo testar https://seu-dominio.com   # faz o mesmo pedido que o Escambo faz em /escambo/status
```

No app, na etapa **Conecte o SDK**, toque em **Testar resgate**. O Escambo gera um token de teste e você abre o link logado no seu SaaS. Se a sua função `resgatar` devolver `{usuario}`, a etapa fica ✓, sem gastar conchas de ninguém.

## Como o resgate é protegido

- O token é de uso único. Enquanto uma aba está liberando o plano, o link fica reservado e outra aba recebe "Link em uso".
- Use `ctx.token` como chave de idempotência no seu `resgatar()`: se a confirmação falhar e a pessoa tentar de novo, não dê o plano duas vezes. Ele só funciona no SaaS dono do App ID e morre quando o resgate é confirmado.
- O SDK confere o token e confirma o resgate com chamadas assinadas com o seu token secreto, então o navegador do cliente não consegue forjar nada.
- Toda chamada leva um nonce e o horário, e uma resposta capturada não serve de novo.
- O Escambo cruza três sinais:
  - o batimento: se o seu servidor parar, ele percebe em minutos;
  - a resposta de `situacao()`;
  - a confirmação do comprador: "o resgate deu certo?" e o "está tudo certo?" semanal.

  Se o comprador disser que não funcionou, ele é reembolsado e você devolve as conchas. Penalidade só acontece com várias denúncias de compradores diferentes.

## API

| | |
|---|---|
| `criarEscambo({apps, appId, segredo, caminho, base, resgatar, situacao, conversao, fimDaTroca, depoisDoResgate, log})` | Cria o cliente. Os valores padrão vêm de `ESCAMBO_APP_ID`, `ESCAMBO_SEGREDO`, `ESCAMBO_CAMINHO` (`/escambo`) e `ESCAMBO_BASE`. Vários SaaS no mesmo site: `apps: [{appId, segredo, resgatar?, situacao?}]`. |
| `escambo.middleware(req, res, next)` | Responde em `{caminho}/status`, `/resgatar`, `/situacao`, `/conversao` e `POST /fim`, e chama `next()` no resto. |
| `escambo.responder(request)` | Mesma coisa para `Request`. Devolve `Response` ou `null`. |
| `escambo.ping()` | Manda um ping assinado por App ID. Com um só, devolve `{ok, estado, proximo_ping_s}`; com vários, `{ok, apps: [...]}`. |
| `escambo.iniciar()` / `parar()` | Liga ou desliga os pings automáticos. |
| `escambo.status()` | Estado local: `conectado`, `ultimoPing`, `proximoPing`, `ultimoErro` e `apps` (um item por App ID). |

Se usar outro caminho, por exemplo `/api/escambo`, informe o mesmo no painel em **Caminho do SDK**.

## Segurança

- O segredo nunca sai do seu servidor. As mensagens levam só a assinatura HMAC-SHA256.
- Pedidos com mais de 5 min de diferença de relógio são recusados, e o Escambo recusa nonce repetido.
- O SDK responde 401 a qualquer pedido sem assinatura válida.
- O protocolo está em [PROTOCOLO.md](PROTOCOLO.md), para implementar em outra linguagem.

## Licença

MIT
