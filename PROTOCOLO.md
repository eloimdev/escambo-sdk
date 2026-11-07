# Protocolo Escambo v1

Todas as assinaturas usam `HMAC-SHA256(segredo, mensagem)` em hexadecimal minúsculo. `ts` é o tempo Unix em segundos, e a diferença aceita é de no máximo 300 s.

## Escambo → seu SaaS

```
GET {url-do-saas}{caminho}/status?desafio={32 hex}&ts={ts}
X-Escambo-App: {app_id}
X-Escambo-Assinatura: HMAC(segredo, "escambo-pedido.v1.{app_id}.{desafio}.{ts}")
```

O SaaS confere o app, o relógio e a assinatura. Se estiver tudo certo, responde `200`:

```json
{"app_id": "esc_app_…", "sdk": "minha-impl/1.0", "ts": 1767312000,
 "prova": "HMAC(segredo, 'escambo-status.v1.{app_id}.{desafio}.{ts}')"}
```

Se algo não conferir, responde `401`. Não há redirecionamentos: a resposta precisa vir do próprio domínio verificado, em HTTPS.

O Escambo chama `/status` quando o domínio é verificado e quando o dono toca em "Testar". O sinal de vida contínuo é o batimento do seu servidor (abaixo).

Vários SaaS podem morar no mesmo domínio. Cada um tem o seu App ID, e o SDK escolhe o segredo pelo cabeçalho `X-Escambo-App`. Um App ID desconhecido recebe `401`.

## Seu SaaS → Escambo

```
POST https://dev.rande.dev/v1/escambo/sdk/ping
Content-Type: application/json
X-Escambo-App: {app_id}
X-Escambo-Ts: {ts}
X-Escambo-Nonce: {16–64 caracteres [A-Za-z0-9_-], único}
X-Escambo-Assinatura: HMAC(segredo, "escambo-ping.v1.{app_id}.{ts}.{nonce}.{sha256 hex do corpo}")

{"sdk": "minha-impl/1.0"}
```

Resposta:

```json
{"ok": true, "estado": "conectado", "proximo_ping_s": 60, "servidor_ts": 1767312000,
 "sdk_ultima": "0.3.1", "atualizar": false, "dormente": false}
```

Use `proximo_ping_s` para marcar o próximo ping.

## Resgate (SaaS → Escambo, assinado como o ping)

As chamadas são assinadas como o ping, com a mensagem `escambo-{acao}.v1.{app_id}.{ts}.{nonce}.{sha256 do corpo}`.

```
POST /v1/escambo/sdk/resgate/consultar   (acao = resgate-consultar)   {"token":"esc_rg_...","reservar":true}
→ {"assinatura":{"id","plano","plano_id","meses","teste","comprador":{"nome"}}}

POST /v1/escambo/sdk/resgate/confirmar   (acao = resgate-confirmar)   {"token":"esc_rg_...","reserva":"esc_rs_...","usuario":"id-da-conta-no-saas"}

POST /v1/escambo/sdk/resgate/liberar     (acao = resgate-liberar)     {"token":"esc_rg_...","reserva":"esc_rs_..."}
→ {"ok":true,"assinatura":{"id","expira","teste"}}
```

O link que o comprador abre é `{origem}{caminho}/resgatar?app={app_id}&token=esc_rg_…`. Com `reservar: true`, o `consultar` reserva o link por 3 min e devolve `reserva`. Outra consulta do mesmo link nesse tempo recebe `409 ESCAMBO_TOKEN_EM_USO`, e o `confirmar` precisa da mesma `reserva`. Se a pessoa precisar entrar antes (redirecionamento) ou a liberação falhar, o SDK chama `liberar`. O token é de uso único e só vale para o App ID que o emitiu: depois de confirmado, `consultar` e `confirmar` respondem `409`.

## Situação (Escambo → SaaS)

```
GET {url}{caminho}/situacao?assinatura=&usuario=&desafio=&ts=
X-Escambo-App, X-Escambo-Assinatura: HMAC(segredo, "escambo-situacao.v1.{app}.{assinatura}.{usuario}.{desafio}.{ts}")
→ {"situacao":"ativa"|"cancelada"|"desconhecida","prova":HMAC(segredo,"escambo-situacao-resp.v1.{app}.{assinatura}.{situacao}.{desafio}.{ts}")}

### Fim da troca (0.5)

Só se o SDK anunciar o recurso `fim`. 7 dias antes do fim (`perto`) e no fim natural (`fim`), uma vez cada:

```
POST {url}{caminho}/fim   corpo JSON {assinatura,usuario,plano,plano_id,meses,expira,momento,oferta}
X-Escambo-App, X-Escambo-Ts, X-Escambo-Nonce, X-Escambo-Assinatura: HMAC(segredo, "escambo-fim.v1.{app}.{ts}.{nonce}.{sha256(corpo)}")
→ 200 {"ok":true,"prova":HMAC(segredo,"escambo-fim-resp.v1.{app}.{nonce}")}
```
`oferta` só vem quando o dono marcou a oferta de saída para aparecer no app dele (plano Pro ou Escala). Sem `fimDaTroca()`: 501.

### Conversão depois da troca (0.4)

De 3 a 60 dias depois do fim da troca (de novo a cada 7 dias sem resposta definitiva), só se o SDK anunciar o recurso `conversao`:

```
GET {url}{caminho}/conversao?assinatura=&usuario=&desafio=&ts=
X-Escambo-App, X-Escambo-Assinatura: HMAC(segredo, "escambo-conversao.v1.{app}.{assinatura}.{usuario}.{desafio}.{ts}")
→ {"resultado":"pagante"|"nao"|"desconhecida","prova":HMAC(segredo,"escambo-conversao-resp.v1.{app}.{assinatura}.{resultado}.{desafio}.{ts}")}
```
Sem `conversao()` configurada: 501.
```

## Batimento

O Escambo responde ao ping com `proximo_ping_s: 60`. Sem ping há 3 min, o estado vira `instavel`; há 10 min, `desconectado`.

Desconectado não é definitivo. O Escambo continua chamando `/status`: a cada 30 min e, depois de 40 min desconectado, de hora em hora. Qualquer ping aceito ou `/status` certo volta o estado para `conectado` na hora.

Do lado do SDK, se o ping falhar ele tenta de novo a cada 1 min por 10 min, depois a cada 30 min e, passados 40 min, de hora em hora. No primeiro ping aceito volta para 60 s.

## Versão e dormência

O ping manda `sdk: "escambo-node/x.y.z"`. Quando sai uma versão nova, a resposta traz `atualizar: true` e o SDK escreve um aviso no log do servidor (uma vez por dia). O dono também vê o aviso no painel do Escambo, com um prompt pronto para a IA atualizar.

O SaaS entra em dormência quando:

- usa uma versão velha por mais de 30 dias depois que a nova saiu; ou
- fica mais de 3 dias desconectado.

Em dormência, o SaaS sai do catálogo e não recebe assinaturas novas. As que já existem continuam normalmente. Atualizou ou reconectou: volta na hora.
