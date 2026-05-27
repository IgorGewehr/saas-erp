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

### 1. ~~Cron worker de transmissão automática de contingência~~ ✅ Concluído
Entregue em [item movido pro ROADMAP_FISCAL.md histórico](./ROADMAP_FISCAL.md). Service em [lib/services/contingenciaRunner.ts](../../lib/services/contingenciaRunner.ts), rota em [app/api/fiscal/cron/transmit-contingencia/route.ts](../../app/api/fiscal/cron/transmit-contingencia/route.ts). Agendar com `GET /api/fiscal/cron/transmit-contingencia` + `Authorization: Bearer ${CRON_SECRET}` a cada 30min.

---

### 2. ~~Documentação de cobertura municipal NFS-e~~ ✅ Concluído
Entregue: [lib/fiscal/nfse-coverage.ts](../../lib/fiscal/nfse-coverage.ts) com tabela explícita das 24 cidades suportadas (SP + 23 Betha SC/RS), 6 cidades grandes conhecidamente sem provider dedicado (RJ, BH, POA, Curitiba, DF, Salvador) com notas explicativas, e fallback genérico pra demais 5540+ municípios. Banner semáforo no [EmitirNotaDialog NFS-e](../../app/components/features/fiscal/EmitirNotaDialog.tsx): verde quando `supported`, amarelo quando `experimental` (DF migrando pro Nacional), vermelho quando `unsupported` com nota explicando o motivo. Página admin de listagem (`FiscalCoverageTab`) fica como nice-to-have separado se necessário — banner já cobre o uso principal.

---

## 🟡 Médio prazo (fazer quando aparecer caso real)

### 3. ~~Refactor mínimo: extrair regras municipais SP num módulo~~ ✅ Concluído (Opção C)
Entregue: [lib/fiscal/municipalRequirements.ts](../../lib/fiscal/municipalRequirements.ts) com `validateMunicipalRequirements(codigoIBGE, data)` que aplica regras específicas registradas num `MUNICIPAL_VALIDATORS` map. Comportamento equivalente ao anterior (SP exige endereço completo do tomador), mas estrutura preparada pra adicionar BH/RJ/etc. sem tocar no route. Route ficou 10 linhas mais limpo. `superRefine` completo no schema Zod fica pra quando aparecer 2º município com regra específica (over-engineering agora).

---

### 4. ~~Pesquisa de consulta automática (status de notas pendentes)~~ ✅ Concluído
Verificado: sefaz-api já tinha `consultarProtocolo` em `nfe.service.ts:895` exposto via `/nfe/consultar`, com helper `consultarNFe()` no gateway saas-erp. **Confirmou ser só saas-erp** — nenhuma mudança no sefaz-api necessária.

Entregue: [lib/services/consultaStatusRunner.ts](../../lib/services/consultaStatusRunner.ts) varre docs com `status='processando'` + `accessKey` válida + idade > 5min + `lastConsultaAt > 55min` atrás. Mapeia cStat SEFAZ pra status interno: 100/150 → autorizada; 101/151/155 → cancelada; ≥200 → rejeitada; 105 → continua processando. Cron route em [app/api/fiscal/cron/consultar-processando/route.ts](../../app/api/fiscal/cron/consultar-processando/route.ts) com auth Bearer CRON_SECRET. Intervalo recomendado: **1 hora** (cenário é raro em produção, ciclo conservador).

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

## 📡 Sinais de alerta — quando reavaliar os pendentes

Os itens pendentes ficam dormentes até aparecer algum destes sinais em produção.
Monitorar via logs e revisitar este arquivo quando bater algum:

### Pra #5 (Certificado A3)
- Cliente prospect/ativo perguntando "vocês aceitam token físico A3?"
- Contador exigindo emissão com cert A3 do CNPJ matriz (alguns contadores ainda exigem)

### Pra #6 (Fila persistente Redis/Bull)
- `[SEFAZ] 429 Rate limit excedido` aparecendo nos logs do gateway com frequência **semanal**
- `[SEFAZ] Timeout apos 60s` aparecendo **mais de 1×/dia**
- Pod do sefaz-api reiniciando por OOM (memória) durante picos de emissão
- Cliente exigindo SLA específico (ex: "1000 notas em < 1min durante Black Friday")
- Volume passar de **~500 emissões/min** total em um único tenant

### Pra #7 (MDF-e)
- Cliente com **frota própria** (indústria, transportadora, atacado com entrega) emitindo NF-e interestadual
- Cliente pedindo "como eu emito o manifesto pra levar mercadoria entre filiais?"

### Pra providers municipais NFS-e (RJ/BH/POA/Curitiba/Salvador)
- Cliente real em uma dessas cidades tentando emitir NFS-e via banner vermelho de cobertura
- Mesmo cliente comprando o plano vai justificar o investimento (~3-6 dias/cidade)

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
