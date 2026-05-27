# Roadmap — Fiscal (NFC-e / NF-e / NFS-e)
**Atualizado:** 2026-05-27 | Repos: `saas-erp` (consumidor) + `sefaz-api` (gateway SEFAZ/prefeituras)

## Legenda
- `code-only` — implementável 100% no Aevo (saas-erp) sem dep externa
- `sefaz-api` — exige mudança no gateway (repo lateral)
- `cross` — mudança coordenada nos dois repos
- `external-dep` — precisa de integração com API/serviço de terceiro

Prioridade reflete impacto operacional + frequência do bug em produção.

---

## O que já existe

### NFC-e
- Emissão + cancelamento + CSC obrigatório + CPF consumidor opcional
- CFOP intra/interestadual auto-ajustado ([app/api/fiscal/emit/route.ts:376-438](../../app/api/fiscal/emit/route.ts#L376-L438))
- Series por tenant + commit de numeração só após autorização
- Validação de 27 UFs

### NF-e modelo 55
- Emissão B2B + finalidades 1-4 (normal/complementar/ajuste/devolução) aceitas
- Destinatário com CPF/CNPJ + IE + `indicadorIE` auto-resolvido
- Carta de correção, cancelamento, inutilização de numeração

### NFS-e
- Provedores: **Padrão Nacional ADN** (Receita Federal), **Betha** (~20 municípios SC/RS), **São Paulo Paulistana**
- LC 116/2003 + NBS + alíquota ISS + retenção ISS
- Cancelamento por motivo (default '1' Erro de emissão)
- Simples Nacional flag (CRT → '1'/'2')
- SP: SOAP 1.1 síncrono, SHA-256, mapeamento LC 116 → código municipal

### sefaz-api (gateway)
- Cert A1 (PFX/PKCS#12), validação cert↔CNPJ
- Multi-key auth, circuit breaker SEFAZ, rate limit
- Retry com backoff (1s/2s/4s, max 3), timeout 60s
- Ambiente produção/homologação por tenant
- Deployado em Cloudflare

---

## Checklist de features a implementar

### 🟥 Alta prioridade (bug ou bloqueador comercial)

- [ ] **Validar endereço completo do tomador em NFS-e SP** `code-only`
  SP exige `EnderecoTomador` completo (logradouro, número, bairro, codigoMunicipio IBGE, UF, CEP). Hoje o schema aceita `tomador.endereco` opcional sem `superRefine` condicional por município, e [emit/route.ts:528-556](../../app/api/fiscal/emit/route.ts#L528-L556) tem comentário admitindo o requisito mas **sem validação**. Resultado: usuário SP emite, a rejeição vem só após roundtrip SOAP com erro genérico.
  **Fix:** adicionar guard logo no início do branch `if (type === 'nfse')` quando `codigoMunicipioEmitente === '3550308'` + `superRefine` no `NfseRequestSchema`.

- [ ] **Devolução NF-e com referência à nota original** `cross`
  Finalidade 4 (devolução) já é aceita no schema, mas faltam os campos `refNFe` (chave de 44 dígitos da NF-e original) e `refNFeCnpj` no payload enviado pro sefaz-api — sem isso a devolução é rejeitada como nota nova inválida. Schema em [lib/contracts/api/fiscal/emit.ts:178](../../lib/contracts/api/fiscal/emit.ts#L178) + envelope no `sefaz-api`.

- [x] **DANFE A4 / DANFCE — auditoria e QR Code NFC-e** `code-only`
  Auditado em 2026-05-27: rota [app/api/fiscal/danfe/route.ts](../../app/api/fiscal/danfe/route.ts) já gerava HTML print-ready completo (A4 pra NF-e modelo 55, 80mm pra NFC-e), com watermark CANCELADA e faixa de homologação. Faltava apenas QR Code obrigatório no DANFCE — adicionado neste PR usando lib `qrcode` (já instalada) e extração da tag `<qrCode>` do XML retornado pelo sefaz-api.

- [ ] **CODE128 + QR Code no DANFE NF-e A4** `code-only`
  NT 2020.005 exige QR Code de consulta no DANFE NF-e. Lei também exige código de barras CODE128 da chave de acesso na parte superior do DANFE A4. Hoje só temos a chave em texto. QR Code é construído com URL da SEFAZ + chave; CODE128 exige lib (avaliar `bwip-js` ~500KB ou implementação SVG manual). Não bloqueia operação porque DANFE imprime e SEFAZ aceita — mas em fiscalização pode gerar autuação por documento auxiliar incompleto.

---

### 🟧 Média prioridade (refinamento que evita rejeição/limitação)

- [ ] **Modo contingência NFC-e (SVC-RS / SVC-AN / off-line)** `cross`
  Hoje se SEFAZ cai, a venda trava. Implementar modo contingência: emitir com chave temporária, salvar em fila local, reenviar quando SEFAZ voltar. Toda venda de varejo em produção precisa disso — risco de operação parar inteira por instabilidade SEFAZ.

- [x] **Local da prestação ≠ estabelecimento (NFS-e)** `code-only`
  Schema aceita `codigoMunicipioPrestacao` opcional. Route respeita o payload com fallback pro emitente quando vazio, e retorna 400 acionável se vier código inválido (≠ 7 dígitos). UI tem campo opcional "Local da prestação (cód. IBGE)" no bloco Serviço Prestado. ISS agora é recolhido no município correto quando empresa atende in-loco fora da sede.

- [ ] **CNAE em NFS-e** `cross`
  Não há campo CNAE no `NfseRequestSchema` ([lib/contracts/api/fiscal/emit.ts:202](../../lib/contracts/api/fiscal/emit.ts#L202)). Algumas prefeituras exigem (Paulistana aceita opcional, mas outras como BH são obrigatórias). Adicionar campo + propagar pro provider no sefaz-api.

- [ ] **Devolução fiscal parcial (itemização)** `cross`
  Hoje só cancela venda inteira (status='cancelada'). Para devolução parcial (cliente devolveu 1 de 3 itens), precisa emitir NF-e de devolução referenciando só os itens devolvidos. Depende do item de devolução NF-e acima.

- [ ] **Providers NFS-e para RJ, BH, Porto Alegre, Curitiba, DF, Salvador** `sefaz-api`
  Hoje fallback para Nacional ADN. Se a prefeitura não migrou pro Padrão Nacional, rejeita. Cada município tem provider próprio (Coplan, Infisc, ISS.NET, etc.) — implementar conforme demanda comercial. Documentar provisoriamente quais cidades estão garantidas hoje.

---

### 🟨 Baixa prioridade (nice-to-have / nicho)

- [ ] **MDF-e (Manifesto Eletrônico de Documentos Fiscais)** `cross`
  Obrigatório para transporte interestadual de mercadorias por conta própria (transportadora ou indústria que entrega com frota própria). Nicho — só implementar quando aparecer cliente desse perfil.

- [ ] **Suporte a certificado A3 (token/cartão inteligente)** `sefaz-api`
  Hoje só A1 (PFX em arquivo). A3 usa PKCS#11 com hardware (token USB ou cartão). Demanda muito menor com certificado em nuvem ganhando espaço, mas alguns contadores ainda exigem A3. Esforço alto.

- [ ] **Fila persistente (Redis/Bull) no sefaz-api** `sefaz-api`
  Retry hoje é in-memory. Se o pod do Cloudflare/sefaz-api cai durante envio, a nota se perde. Migrar retry pra fila persistente — depende do volume atingir nível em que isso vire problema real.

- [ ] **`superRefine` condicional por município no NfseRequestSchema** `code-only`
  Generalização da validação SP: schema deveria validar campos obrigatórios por município no boundary Zod (não em runtime no route). Permite mensagem de erro precisa antes do envio.

- [ ] **Pesquisa de consulta automática (verificação de status de notas pendentes)** `cross`
  Cron que verifica notas com status `processando` há mais de X minutos e consulta SEFAZ pelo recibo. Hoje depende do gateway responder síncrono.

- [ ] **Documentação de cobertura municipal NFS-e** `code-only`
  Página em settings/admin listando: "Sua cidade ({nomeCidade}) usa o provider {X}. Funcionalidades suportadas: emissão ✅ / cancelamento ✅ / consulta ⚠️". Evita venda errada e dá transparência operacional.

---

## Notas de arquitetura

### Dois repos coordenados
Toda mudança fiscal não-trivial envolve `saas-erp` (schema, validação, UI) E `sefaz-api` (envelope SOAP/XML, comunicação SEFAZ). Sempre pensar o PR em pares quando taggear `cross`.

### Onde adicionar validações condicionais
- **Schema-level** (`lib/contracts/api/fiscal/emit.ts`): use `superRefine` ou `discriminatedUnion` por município. Boundary primeiro.
- **Route-level** (`app/api/fiscal/emit/route.ts`): apenas pra regras que dependem de dados do `business` (CRT, codigoMunicipioEmitente) não disponíveis no schema.
- **Provider-level** (`sefaz-api/src/lib/nfse/{provider}.provider.ts`): só pra transformações de envelope. Não revalidar regra de negócio aqui.

### Convenções de mensagem de erro fiscal
Erros pro usuário devem citar:
1. Campo faltante/inválido em PT-BR
2. Qual documento exige (`Em São Paulo, NFS-e exige...`)
3. Onde corrigir (`Configure em Configurações → Empresa` ou `Preencha o endereço completo do cliente`)

Sem stack trace, sem mensagem genérica "Erro ao emitir". Usuário fiscal não-técnico precisa entender o que fazer.

---

## Histórico de mudanças relevantes (sefaz-api)

Ordenado do mais recente:
- `b9832e2` — reverte para SOAP 1.1 no lotenfe.asmx síncrono (SP)
- `a0f2b61` — fix express-rate-limit IPv6 keyGenerator
- `ff2309c` — multi-key auth, cert↔CNPJ check, SEFAZ circuit breaker, stricter logger
- `aa434d9` — security middleware, DV validation, LRU cache, env-driven resp. técnico
- `7a23efb` — pre-production checklist + critical security fixes
- `1af6592` — NFS-e SP namespace XML, SOAP 1.2, link visualização, testes
- `ff78bbb` — mapeamento oficial LC 116 + suporte homologação
- `fb77711` — ajustes Betha, ADN e São Paulo
- `3b24378` — NFS-e Betha/Nacional + ambiente por tenant + fix assinatura XML
- `dccf29e` — SHA-256 e NFS-e
- `eed572d` — migração para Cloudflare
