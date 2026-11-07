# Verificar o domínio no Escambo

O Escambo confere se o domínio é seu procurando um registro **TXT** no DNS. O app mostra os dois valores que você precisa:

| Campo | Exemplo |
|---|---|
| Tipo | `TXT` |
| Nome | `_escambo` (alguns painéis pedem o nome completo: `_escambo.seudominio.com`) |
| Valor | `escambo-verificacao=AbC123…` |
| TTL | Automático (ou 300) |

Depois de salvar, o Escambo checa sozinho a cada minuto. Você também pode tocar em **Checar agora** (a cada 30 s). Em geral aparece em 1 a 10 minutos. Em alguns provedores pode levar até 1 hora.

## Onde criar o registro

**Cloudflare**
1. Abra o domínio e entre em **DNS → Records → Add record**.
2. Em **Type**, escolha `TXT`; em **Name**, `_escambo`; em **Content**, cole o valor.
3. Salve. Registro TXT não tem proxy (nuvem laranja), então não precisa mexer nisso.

**Registro.br**
1. Entre no domínio e abra **DNS → Editar zona** (se usa os DNS do Registro.br).
2. Toque em **Nova entrada**, escolha o tipo `TXT`, coloque `_escambo` no nome e cole o valor.
3. Salve as alterações.

**Vercel**
1. Abra **Domains**, escolha o domínio e role até **DNS Records**.
2. Adicione: **Type** `TXT`, **Name** `_escambo`, **Value** com o valor.

**Hostinger, GoDaddy, Locaweb, HostGator**
1. Procure **Zona DNS** ou **Gerenciar DNS**.
2. Adicione um registro `TXT` com o host/nome `_escambo` e o valor copiado.

**AWS Route 53**
1. Abra a hosted zone e clique em **Create record**.
2. **Record name** `_escambo`, **Record type** `TXT`, **Value** entre aspas: `"escambo-verificacao=…"`.

## Conferir do seu computador

```bash
npx github:eloimdev/escambo-sdk#v0.6.1 dns seudominio.com
```

Ou com as ferramentas do sistema:

```bash
nslookup -type=TXT _escambo.seudominio.com
```

## Problemas comuns

- **"Ainda não achei o registro"**: o DNS ainda não propagou. Espere alguns minutos.
- **"O valor não confere"**: o valor foi colado com espaço, aspas a mais ou cortado. Copie de novo pelo botão do app.
- **O domínio usa outro DNS**: crie o registro onde o DNS do domínio está apontado (veja os "nameservers" do domínio), não necessariamente onde ele foi comprado.
- **Subdomínio** (ex.: `app.seusaas.com`): o nome do registro é `_escambo.app`, ou o que o app mostrar.

O registro pode ser apagado depois que o domínio estiver verificado.
