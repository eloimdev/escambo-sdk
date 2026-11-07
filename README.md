# Escambo SDK

Conecta o seu SaaS ao **Escambo**, o lugar onde donos de SaaS trocam assinaturas entre si.

O SDK cuida de tudo o que liga o seu SaaS ao Escambo, sempre assinado com o seu segredo (HMAC) e com proteção contra repetição:

1. **Batimento:** um ping a cada 60 s diz que o seu servidor está no ar. Sem ping há 3 min, o SaaS aparece instável; há 10 min, desconectado.
2. **Resgate:** quem pegou uma assinatura no Escambo abre o link de resgate (vale 72 h) logado no seu SaaS, e a sua função `resgatar()` libera o plano.
3. **Situação:** uma vez por semana o Escambo pergunta se a assinatura continua ativa (`situacao()`).
4. **Conversão (0.4):** depois que a troca acaba, o Escambo pergunta se aquela conta virou cliente pagante (`conversao()`, só sim/não).
5. **Fim da troca (0.5):** 7 dias antes do fim e quando acaba no prazo, o Escambo avisa o seu app e manda a sua oferta de saída (`fimDaTroca()`).
6. **Revogação (0.6):** se o comprador denunciar um problema ou disser que o resgate não funcionou, a troca é encerrada para os dois e o Escambo chama `revogar()` para você tirar o plano daquela conta.

Ele não tem dependências e funciona no Node 18.17 ou mais novo.

> Versão atual: **0.6.0**. Mantenha o SDK atualizado: 30 dias numa versão velha deixam o SaaS em dormência. Instale sempre numa tag fixa (`#v0.6.0`), nunca no HEAD do repositório.

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
npm i github:eloimdev/escambo-sdk#v0.6.0
```

Fixe sempre a tag. Sem ela o npm instala o que estiver no HEAD naquele momento, e cada `npm i` pode trazer um código diferente. Para atualizar, troque a tag no comando (o aviso de atualização já mostra a tag nova).

Grave as chaves no `.env`. O comando não apaga nada que já estiver lá:

```bash
npx escambo init --app esc_app_xxxxxxxx --token esc_sk_xxxxxxxx
```

### 4. Monte o SDK: batimento + resgate

O SDK cuida das rotas no seu site (`/escambo/status`, `/escambo/resgatar`, `/escambo/situacao`, `/escambo/conversao` e, por POST, `/escambo/fim` e `/escambo/revogar`) e do batimento.

**Novo na 0.6 — revogação.** Passe `revogar: async ({assinatura, usuario, motivo}) => {...}` e tire o plano daquela conta. Regra do Escambo: **se o comprador denunciar um problema ou disser que o resgate não funcionou, a troca é encerrada para os dois, sem julgar quem tem razão.** Você deixa de receber (a 1ª parcela fica 7 dias em garantia e é cancelada se ainda não saiu) e o Escambo chama `revogar` para o comprador perder o acesso. `motivo` é `"denuncia"`, `"resgate_falhou"` ou `"reembolso"`. Seja idempotente: se a sua função lançar erro, o SDK responde 500 e o Escambo tenta de novo. Rota: `POST {caminho}/revogar`.

**Novo na 0.5 — fim da troca e oferta de saída no seu app.** Passe `fimDaTroca: async ({usuario, momento, expira, plano, oferta}) => {...}`. O Escambo avisa 7 dias antes do fim (`momento: "perto"`) e quando acaba no prazo (`"fim"`), uma vez cada, assinado. Encerramento antes do prazo (denúncia, resgate que falhou, reembolso) não passa por aqui: chega por `revogar`. Se você cadastrou no painel uma oferta de saída marcada para "no seu app", ela vem em `oferta`: `{nome, desconto, meses, texto, codigo, link}` (0.5.1). `desconto` é o percentual (5 a 90) e `meses` por quantos meses ele vale (`0` = enquanto a pessoa assinar): aplique esses números no seu checkout. `texto` é a mesma oferta em português, pronta para mostrar (ex.: "12% de desconto nos primeiros 3 meses"). Rota: `POST {caminho}/fim` (no Next.js, exporte também o `POST`).

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
    // O link leva o token de resgate: não logue req.originalUrl. Na tela de login, só aceite um `voltar` relativo
    // (começa com "/" e não com "//"), senão o seu login vira um redirecionamento aberto.
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
  // 0.6: o comprador denunciou ou o resgate falhou — a troca acabou para os dois. Tire o plano (idempotente).
  async revogar({assinatura, usuario, motivo}) {
    await tirarPlanoDoEscambo(usuario, assinatura);         // erro aqui = o Escambo tenta de novo
  },
});
app.use(escambo.middleware);   // responde em /escambo/* — monte ANTES do express.json()
app.use(express.json());
escambo.iniciar();             // batimento a cada 60 s

// Na rota de login, valide o destino antes de redirecionar:
const destinoSeguro = (v) => typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/';
```

**Ordem do middleware.** `/fim` e `/revogar` conferem o HMAC sobre os bytes exatos do corpo. Monte `escambo.middleware` antes do `express.json()` (ou de qualquer body parser). Se o corpo já tiver sido lido e virado objeto, o SDK responde `400 {erro: "corpo_consumido"}`. Se o seu framework guarda os bytes em `req.rawBody` (Buffer ou string), o SDK usa esse valor. O corpo aceito tem no máximo 16 KB.

**Next.js (App Router)**: crie `app/escambo/[...rota]/route.js`:

```js
import {criarEscambo} from '@rande/escambo';
const escambo = criarEscambo({
  resgatar: async ({req, plano, meses}) => {/* req é o Request: leia o cookie com req.headers.get('cookie') */},
  situacao: async () => 'ativa',
  revogar: async ({usuario, assinatura}) => {/* tire o plano */},
});
export const dynamic = 'force-dynamic';
export async function GET(request) {
  return (await escambo.responder(request)) ?? new Response('Not found', {status: 404});
}
export const POST = GET; // /fim e /revogar chegam por POST
```

No `responder`, a sua função `resgatar` recebe o `Request` no campo `req` do contexto (não existe `request`).

**Atualizações:** quando sai uma versão nova, o SDK avisa no log do servidor e o painel do Escambo mostra um prompt para a sua IA atualizar. Fique mais de 30 dias numa versão velha, ou mais de 3 dias desconectado, e o SaaS entra em dormência: sai do catálogo até você atualizar ou reconectar.

**Se cair:** a conexão volta sozinha. Com o servidor de pé de novo, o primeiro batimento reconecta. Enquanto o ping falha, o SDK tenta a cada 1 min por 10 min, depois a cada 30 min e, passados 40 min, de hora em hora.

**Serverless (Vercel, Netlify, Workers):** o processo não fica vivo, então não use `iniciar()`. Chame `await escambo.ping()` num cron de 1 em 1 minuto. Sem batimento, o Escambo mostra o SaaS como instável em 3 min e desconectado em 10 min.

**Nonces:** o SDK lembra os nonces de `/fim` e `/revogar` por 10 min para recusar repetição. Por padrão eles ficam **em memória**: somem quando o processo reinicia e não são vistos por outras instâncias. Em serverless ou com vários processos, guarde num armazenamento compartilhado:

```js
const escambo = criarEscambo({
  nonces: {
    tem: async (chave) => (await redis.exists(chave)) === 1,
    guardar: async (chave, ttlMs) => { await redis.set(chave, '1', {PX: ttlMs}); },
  },
  // ...
});
```

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

- **Se o comprador denunciar um problema ou disser que o resgate não funcionou, a troca é encerrada para os dois**, sem julgar quem tem razão: você deixa de receber e o Escambo chama `revogar` para tirar o plano da conta. Por isso a 1ª parcela fica **7 dias em garantia** (regra do servidor do Escambo) e só sai se nada for denunciado nesse prazo. Penalidade ao dono só acontece com várias denúncias de compradores diferentes.

## API

| | |
|---|---|
| `criarEscambo({apps, appId, segredo, caminho, base, resgatar, situacao, conversao, fimDaTroca, revogar, nonces, depoisDoResgate, log})` | Cria o cliente. Os valores padrão vêm de `ESCAMBO_APP_ID`, `ESCAMBO_SEGREDO`, `ESCAMBO_CAMINHO` (`/escambo`) e `ESCAMBO_BASE`. Vários SaaS no mesmo site: `apps: [{appId, segredo, resgatar?, situacao?, conversao?, fimDaTroca?, revogar?}]`. |
| `escambo.middleware(req, res, next)` | Responde em `{caminho}/status`, `/resgatar`, `/situacao`, `/conversao`, `POST /fim` e `POST /revogar`, e chama `next()` no resto. Monte antes do `express.json()`. |
| `escambo.responder(request)` | Mesma coisa para `Request`. Devolve `Response` ou `null`. |
| `escambo.ping()` | Manda um ping assinado por App ID. Com um só, devolve `{ok, estado, proximo_ping_s}`; com vários, `{ok, apps: [...]}`. |
| `escambo.iniciar()` / `parar()` | Liga ou desliga os pings automáticos. |
| `escambo.status()` | Estado local: `conectado`, `ultimoPing`, `proximoPing`, `ultimoErro` e `apps` (um item por App ID). |

Se usar outro caminho, por exemplo `/api/escambo`, informe o mesmo no painel em **Caminho do SDK**.

## Segurança

- O segredo nunca sai do seu servidor. As mensagens levam só a assinatura HMAC-SHA256.
- Pedidos com mais de 5 min de diferença de relógio são recusados, e nonce repetido é recusado nos dois lados (no SDK, em memória por padrão; veja **Nonces**).
- Em `/fim` e `/revogar`, o SDK confere app, relógio e nonce antes de ler o corpo, e lê no máximo 16 KB.
- O SDK responde 401 a qualquer pedido sem assinatura válida.
- O protocolo está em [PROTOCOLO.md](PROTOCOLO.md), para implementar em outra linguagem.

## Mudanças

- **0.6.0** — `revogar()` e `POST {caminho}/revogar` (troca encerrada para os dois por denúncia, resgate que falhou ou reembolso); `/fim` e `/revogar` autenticam antes de ler o corpo, leem em bytes com limite de 16 KB e aceitam `req.rawBody`; `400 corpo_consumido` quando um body parser leu antes; `nonces` plugáveis; aviso de atualização com a tag fixa; README corrigido (Next.js usa `req`, `voltar` seguro, ordem do middleware).
- **0.5.1** — oferta de saída estruturada (`nome`, `desconto`, `meses`).
- **0.5.0** — `fimDaTroca()` e `POST {caminho}/fim`.
- **0.4.0** — `conversao()`.

## Licença

MIT
