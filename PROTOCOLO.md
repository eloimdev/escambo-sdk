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

Ritmo das checagens do Escambo:

| Situação | Intervalo |
|---|---|
| Aguardando, até 15 min depois da verificação | 1 min |
| Aguardando, até 2 h | 5 min |
| Aguardando, até 24 h | 30 min |
| Aguardando, depois de 24 h | 6 h |
| Conectado, no primeiro dia | 1 h |
| Conectado, depois do primeiro dia | 24 h |
| Instável (falhou depois de conectar) | 5 min → 15 min → 1 h |

Depois de 4 falhas seguidas, o estado vira `desconectado`.

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
{"ok": true, "estado": "conectado", "proximo_ping_s": 3600, "servidor_ts": 1767312000}
```

Use `proximo_ping_s` para marcar o próximo ping.
