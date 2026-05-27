# Backlog Fiscal — Próximos Passos
**Criado:** 2026-05-27 | Origem: itens pendentes do [ROADMAP_FISCAL.md](./ROADMAP_FISCAL.md) após sprint de 11 commits.

Fora deste backlog (decisão explícita):
- ❌ **Providers NFS-e RJ/BH/POA/Curitiba/DF/Salvador** — pausado. Implementar on-demand quando aparecer cliente real em cada cidade. Conforme demanda surgir, criar PR específico do provider municipal.

## Legenda
- `code-only` — implementável 100% no saas-erp
- `sefaz-api` — exige mudança no gateway
- `cross` — coordenado nos dois repos
- **ROI** — relação esforço × valor real entregue

Ordem reflete recomendação de execução por ROI decrescente.

---

## 🟢 Curto prazo (vale fazer logo, baixo custo)

### 1. Cron worker de transmissão automática de contingência
**Esforço:** ~3-4 horas | **Tag:** `code-only` | **ROI:** Alto

**Por que existe:** Quando a SEFAZ cai e o operador emite NFC-e em contingência (status=`contingencia`), hoje é responsabilidade dele clicar "Transmitir Contingência" no detalhe quando o serviço voltar. Se esquecer ou demorar mais de 24h após `dhCont`, a SEFAZ rejeita por extemporaneidade.

**O que entrega:**
- Cron route em `app/api/fiscal/cron/transmit-contingencia/route.ts`
- Roda a cada **30 minutos** (intervalo conservador — evita load desnecessário no sefaz-api e tem margem confortável dentro do limite SEFAZ de 24h)
- Busca `fiscalDocuments` com `status='contingencia'` e `dhCont` entre 30min e 23h atrás
- Para cada um, chama a função interna do route `/api/fiscal/retry` (ou refatora a lógica em helper compartilhado)
- Log estruturado: quantos tentou, quantos sucesso, quantos ainda pendentes
- Guarda flag `lastCronAttemptAt` no documento pra evitar retry em loop quando SEFAZ continua fora

**Detalhes de implementação:**
- Decidir mecanismo de cron: Vercel Cron (cron-jobs.json) OU cron interno do Docker (já tem o `cron` ativo no projeto pelo `birthdayCampaignRunner`)
- Idempotência via `lastCronAttemptAt` — se outro processo já tentou nos últimos 25min, pula
- Limite de 50 docs por execução pra evitar explosão de carga
- Notificar admin via Slack/email se houver doc com `dhCont` chegando perto das 24h sem ter conseguido transmitir

**Pré-requisito:** nenhum. Toda infra (status, XML salvo, rota retry) já existe.

---

### 2. Documentação de cobertura municipal NFS-e
**Esforço:** ~4-6 horas | **Tag:** `code-only` | **ROI:** Alto

**Por que existe:** Sem visibilidade de quais municípios estão suportados, operador pode tentar emitir NFS-e em cidade que vai falhar silenciosamente (provider Nacional rejeita ou aceita errado). Também ajuda na decisão de quais providers municipais priorizar.

**O que entrega:**
- Tabela JSON estática em `lib/fiscal/nfse-coverage.ts` com:
  - codigoIBGE, nomeCidade, UF
  - provider usado (Nacional ADN / Betha / Paulistana / "fallback Nacional — não testado")
  - status: `'tested-prod'` / `'tested-homolog'` / `'untested'` / `'known-broken'`
  - features suportadas: emissão ✅, cancelamento ✅, consulta ⚠️
- Hook `useNFSeCoverage(codigoIBGE)` que retorna o status
- No `EmitirNotaDialog` NFS-e, antes do botão "Emitir":
  - Verde quando `tested-prod`
  - Amarelo "homologação não testada em produção" quando `tested-homolog`
  - Vermelho "Sua cidade não foi homologada — tentativa pode falhar" quando `untested` ou `known-broken`
- Página em `app/components/features/settings/FiscalCoverageTab.tsx` listando todas as cidades cobertas e seu status

**Detalhes:**
- Começar populando só as cidades que sabemos: SP, ~20 municípios Betha (SC/RS), e flagar todas as 5570 outras como `untested`
- Estrutura permitir atualização incremental: quando homologar um município, troca o status
- Bonus: contagem agregada ("📊 Cobertura: 23 cidades em produção, 2 homologadas, 5545 não testadas")

---

## 🟡 Médio prazo (fazer quando aparecer caso real)

### 3. `superRefine` condicional por município no NfseRequestSchema
**Esforço:** ~2-3 horas | **Tag:** `code-only` | **ROI:** Médio

**Por que existe:** Hoje a validação SP de endereço do tomador está no route (`app/api/fiscal/emit/route.ts`). Funciona, mas mistura validação de shape com lógica de negócio. Generalizar pro schema Zod com `superRefine` deixa a validação mais perto da borda e o erro chega ao cliente com mensagem mais consistente.

**O que entrega:**
- Mapa `MUNICIPAL_REQUIREMENTS: Record<IBGE, RequirementSet>` em `lib/contracts/api/fiscal/emit.ts`
- `superRefine` no `NfseRequestSchema` que lê o IBGE e aplica as validações específicas
- Route fica mais limpo (só consome resultado parseado)

**Quando vale fazer:** quando adicionar 3º município com regras específicas (hoje só SP). Antes disso, custo > benefício.

---

### 4. Pesquisa de consulta automática (status de notas pendentes)
**Esforço:** ~1 dia | **Tag:** `cross` | **ROI:** Médio-baixo

**Por que existe:** Notas com `status='processando'` ficariam assim pra sempre se o sefaz-api não respondesse síncrono (caso raro mas possível em assíncrono). Cron periódico consulta SEFAZ pela chave/recibo e atualiza status.

**O que entrega:**
- sefaz-api: endpoint `POST /nfe/consultar-recibo` (provavelmente já existe — verificar)
- saas-erp: cron route `/api/fiscal/cron/consultar-processando` que roda **a cada 1 hora**
- Busca docs com `status='processando'` há mais de 5min
- Chama consulta, atualiza pra `autorizada`/`rejeitada` conforme retorno SEFAZ

**Pré-requisito:** verificar se sefaz-api já tem consulta por recibo (provavelmente sim, ver `consultarProtocolo`).

---

### 5. Suporte a certificado A3 (token/cartão inteligente)
**Esforço:** ~5-7 dias | **Tag:** `sefaz-api` | **ROI:** Baixo

**Por que existe:** Hoje só A1 (PFX em arquivo). Alguns contadores ainda exigem A3 pra emitir do CNPJ matriz (token USB Safenet, cartão Serasa).

**O que entrega:**
- Integração PKCS#11 no sefaz-api (provavelmente lib `node-pkcs11` ou similar)
- Detecção automática: se cert é A1 (PFX) usa código atual; se é A3, usa novo caminho
- UI: indicação do tipo de cert no FiscalSettings

**Quando vale fazer:** quando cliente real exigir. A1 cobre 95% dos casos. Demanda decrescente (A3 está sendo aposentado).

---

### 6. Fila persistente Redis/Bull no sefaz-api
**Esforço:** ~3-4 dias | **Tag:** `sefaz-api` | **ROI:** Baixo (em escala baixa)

**Por que existe:** Retry hoje é in-memory no sefaz-api. Se o pod cai durante envio, a nota se perde. Fila persistente (Bull com Redis) garante durabilidade.

**O que entrega:**
- Redis no docker-compose do sefaz-api
- Bull queue pra `emitirNFCe`, `emitirNFe`, `emitirNFSe`
- Worker que processa a fila com retry exponencial
- Dashboard Bull (opcional) pra observabilidade

**Quando vale fazer:** quando volume atingir o ponto de pod restart causar perda real (talvez 50+ emissões/dia por tenant). Em pequena escala não é problema.

---

## 🔴 Longo prazo (nicho específico)

### 7. MDF-e (Manifesto Eletrônico de Documentos Fiscais)
**Esforço:** ~10-15 dias | **Tag:** `cross` | **ROI:** Depende de cliente

**Por que existe:** Documento obrigatório pra transporte interestadual de mercadorias por **conta própria** (transportadora ou indústria que entrega com frota própria).

**O que entrega:**
- sefaz-api: serviço completo MDF-e (já tem `mdfe.service.ts` esboçado — verificar estado real)
- saas-erp: módulo de emissão MDF-e ligado a deliveryOrders/transferências entre lojas
- Vinculação de NF-e e NFC-e dentro do MDF-e

**Quando vale fazer:** quando aparecer cliente com frota própria que emita NF-e em transporte interestadual. Nicho específico (transportadora, indústria com entrega própria, atacado).

---

## Como executar este backlog

**Sugestão:** atacar #1 e #2 em sequência (~1 dia total) pra fechar o ciclo do fiscal com tudo automatizado e transparente. Depois pausar real e deixar #3-#7 surgirem quando aparecer demanda.

Cada item pendente deve abrir um **PR isolado** com:
- Commit prefix `feat(fiscal):` ou `fix(fiscal):` ou `chore(fiscal):`
- Atualização deste arquivo movendo o item pra `[x]` no `ROADMAP_FISCAL.md` (histórico) e removendo daqui
- Auditoria typecheck dos dois repos quando `cross`

## Notas de arquitetura

- **Cron jobs:** preferir intervalo conservador (30min mínimo) pra evitar load desnecessário. SEFAZ tem rate limits e o sefaz-api tem circuit breaker — cron muito frequente causa false positives.
- **Idempotência:** todo cron deve guardar `lastAttemptAt` no documento e respeitar uma janela mínima entre tentativas (ex: não tentar se foi tentado há menos de 25min num cron de 30min).
- **Observabilidade:** crons devem logar quantos docs processaram, quantos sucesso, quantos falha. Sem isso fica caixa preta.
- **Limite por execução:** crons devem processar no máximo N docs por execução (ex: 50) pra evitar pico de carga.
