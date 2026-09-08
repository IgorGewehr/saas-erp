# M03 — Plano de implementação de Financeiro e Conciliação

> Análise concluída em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Referência funcional: Gestão Raiz
>
> Lente desta rodada: **odontologia** — cliente pagante real. Cobrança/parcelamento por
> atendimento já existe via ligação pontual com a Agenda (`docs/agenda/AGENDA_COBRANCA.md`), mas
> o módulo Financeiro em si nunca recebeu o mesmo hardening que M01/M02/M06 já receberam.
>
> Estado: investigação de abertura concluída em 04/09/2026. M03.5, M03.0, M03.1, M03.2, M03.3
> (API v1 + follow-up de atomicidade no PDV + follow-up de idempotência opcional no contrato do
> agente), M03.4 e M03.6 (decisão V1 vs V2: **clássico é o principal**) concluídos em código o
> mesmo dia. M03.7 (DRE/fluxo/orçamento) concluída em 08/09/2026 — checkpoint com o usuário:
> DRE+projeção portados pro clássico, Orçamento construído agora. Resta só M03.9 (aceite).

---

## 0. Por que este módulo é diferente de M01/M02/M06

Em M01/M02/M06, o diagnóstico foi sempre "o núcleo correto já existe, só nem todo canal usa" —
convergência, não reescrita. **M03 não tem esse luxo.** A investigação de abertura encontrou:

1. **Duas árvores de UI inteiras e independentes** escrevendo na MESMA coleção `transactions`:
   `app/components/features/financial/` (clássico, `FinancialModule.tsx` monolítico) e
   `app/components/features/financial-v2/` (~70 arquivos, modular, opt-in via
   `business.settings.financialV2Enabled`). Não compartilham nem a taxonomia de categorias —
   está copiada e colada, literalmente idêntica, nos dois arquivos. Isso não é um bug entre os
   dois — é um fork de produto ainda não resolvido (ver §1).
2. **13 caminhos de código diferentes gravam em `transactions` hoje**, com 3 filosofias de
   idempotência diferentes (CAS transacional determinístico — o melhor grupo; claim-doc separado;
   e nenhuma, check-then-act) e 2 filosofias de validação (Zod no boundary vs. nada). Os caminhos
   MAIS robustos (venda do PDV, contas a pagar de compra, pedido de delivery, estorno, liquidação
   Mercado Pago) não são "o núcleo do Financeiro" — são efeitos colaterais de OUTROS módulos
   (M01/M02/M06) que passam a existir na coleção `transactions` de carona. **O Financeiro em si
   — o formulário manual que um humano usa pra lançar/editar/marcar como pago — nunca teve essa
   camada.** Não existe hoje nenhuma função equivalente a `createAppointmentSafeAdmin` pra
   Transaction.
3. **O FSM já existe mas não é aplicado por ninguém.** `lib/contracts/fsm/transaction.ts` declara
   as transições válidas de status, mas nenhum dos 13 caminhos de escrita o invoca — um client
   pode gravar `status:'pago'` direto na criação, ou reverter `pago→pendente` livremente, sem
   nenhum guard, nem em `firestore.rules` (que só valida enum, não transição).
4. **Duas integrações de conciliação real (OFX/CSV) coexistem** (uma em cada árvore de UI, mesmo
   backend `lib/services/reconciliation.ts`), funcionais mas **sem nenhum teste automatizado**
   apesar de mexer com dinheiro real de conciliação bancária.
5. **DRE/fluxo de caixa/orçamento**: DRE (com regime competência/caixa) e caixa físico são reais
   e só existem no V2. Projeção de caixa **NÃO é V2-exclusiva** — correção feita em 04/09/2026
   após investigação de paridade (M03.6): o clássico tem sua própria projeção diária 30/60/90d +
   13 semanas com toggle de cenário, dentro da aba Transações (`FinancialModule.tsx:4104-4483`).
   Ver `docs/financeiro/FINANCEIRO_M03_6_PARIDADE_V1_V2.md`. Orçamento (`Budget`) é um tipo
   declarado com **zero** consumidores — nunca foi implementado.
6. **Integrações PIX/Boleto/OCR/Open Banking são 100% stub** — as 4 rotas retornam 501
   incondicional, com checklist de TODO no cabeçalho do arquivo. Não é um gap de qualidade, é
   trabalho nunca começado (confirmado lendo o corpo das rotas, não só o nome).

Dado isso, M03 não é "convergir pro núcleo existente" — é **construir o núcleo que nunca
existiu**, decidir explicitamente o que fazer com o fork V1/V2, e só depois migrar os caminhos
de escrita mais arriscados pra cima dele. É estruturalmente mais parecido com M01 (que também
precisou de um núcleo novo) do que com M06.

## 1. Decisão que não é de engenharia: o que fazer com Financeiro V2

Igual à visibilidade por profissional na M06.8 — **isto não é uma decisão de engenharia**, é
produto: qual UI vai ficar? Três caminhos possíveis, cada um com implicação real:

- **(a) V2 vira o único Financeiro**, clássico é aposentado (esconder/remover). Ganho: para de
  duplicar taxonomia/lógica; V2 já tem DRE, projeção de caixa, caixa físico (sangria/abertura/
  fechamento), que o clássico não tem. Risco: V2 é rotulado "beta" no próprio código — não está
  confirmado que cobre TUDO que o clássico cobre hoje (ex.: `ProjetosTab.tsx`/multi-moeda são
  V1-only, sem equivalente em V2).
- **(b) Clássico continua sendo o principal**, V2 é descontinuado. Perde DRE/projeção/caixa
  físico que já existem e funcionam no V2 — jogaria fora trabalho real.
- **(c) Convivência intencional e permanente** (não é isso que o roadmap já registrou como
  problema — "consolidar antes de expandir" — mas é uma opção honesta a considerar): manter os
  dois, aceitar a duplicação como custo permanente, focar o hardening (núcleo/FSM/idempotência)
  de forma que sirva os DOIS ao mesmo tempo, já que ambos escrevem no mesmo dado.

**Recomendação desta investigação**: (c) reformulado — o núcleo de escrita (contrato Zod, FSM,
idempotência) deve ser construído de forma **agnóstica de UI**, servindo tanto o clássico quanto
o V2 (e futuras chamadas do agente/API v1), exatamente como `checkAppointmentConflict` serve
Agenda/CRM/PDV/API v1/agente hoje. Isso não resolve a decisão de produto (a) vs (b), só evita que
o hardening fique refém dela — o núcleo vale independente de qual UI sobrevive. A decisão de
QUAL UI é a fonte de verdade daqui pra frente fica **explicitamente pendente do usuário**.

**Inventário de paridade real feito em 04/09/2026** (pedido explícito do usuário antes de
decidir, em vez de decidir às cegas) — ver `docs/financeiro/FINANCEIRO_M03_6_PARIDADE_V1_V2.md`
pro detalhe completo com arquivo/linha. Resumo do achado: **não é "V2 é superset faltando 1-2
gaps"** (`ProjetosTab`/multi-moeda) como a formulação original sugeria — é mais nuançado e numa
dimensão específica, invertido. V2 está à frente em inteligência financeira **somente-leitura**
(DRE com regime contábil, caixa físico com FSM próprio, analytics de assinatura com churn,
conciliação com drill mais rico). Mas V2 está atrás em capacidade **operacional de escrita**:
hoje não edita nem cancela lançamento, não cria parcelamento, não configura recorrência além de
"repete mensal", não pausa/retoma/ajusta série recorrente, não gerencia comissão, não anexa
comprovante, e não cria/edita conta bancária (o que bloqueia a própria feature de caixa físico,
já que ela exige uma conta tipo `caixa` que só o clássico cria hoje). Achado de risco de dado
concreto: `bankAccounts.balance` tem semântica DIVERGENTE entre os dois — clássico trata como
número manual, V2 incrementa automaticamente a cada baixa/conciliação — misturar uso sem lidar
com isso primeiro arrisca saldo divergente. Achado de integração: o botão "Cobrar" da Agenda
(cliente pagante atual, odontologia) já está documentado como quebrado quando V2 está ativo
(`docs/agenda/AGENDA_COBRANCA.md`).

## 2. O que é fora de escopo deliberado (não incluído neste plano)

- **PIX/Boleto/OCR/Open Banking** (stubs) — não é hardening, é construir integração nova com
  parceiro externo (Asaas/Gerencianet/Pluggy/Belvo/Google Vision), decisão de produto/custo
  própria. Mesma categoria "dormente até sinal real de demanda" do backlog fiscal
  (`docs/roadmap/ROADMAP_FISCAL_BACKLOG.md`).
- **Orçamento (`Budget`)** — feature nunca construída, não confirmada como necessidade real da
  odontologia. Construir do zero é escopo de feature nova, não de hardening.
- **Certificado A3, MDF-e, fila Redis/Bull** — já registrados como dormentes no backlog fiscal,
  sem relação com Financeiro.
- **Gateway de pagamento pra cobrança recorrente de assinaturas** (`membershipBillingRunner.ts`)
  — TODO já auto-documentado no próprio arquivo (P2.9), fora do escopo de "hardenizar o
  Financeiro que já existe".
- **Paridade completa V1↔V2** (ex.: portar `ProjetosTab`/multi-moeda pro V2, ou DRE/caixa físico
  pro clássico) — depende da decisão do §1; não faz sentido investir nos dois lados antes dela.

## 3. Fases

### M03.0 — Baseline (mede antes de mexer) ✅ Concluído (04/09/2026)

- [x] `lib/services/m03-financial-audit.ts` (espelha `m06-agenda-audit.ts`): varre `transactions`
      por tenant e detecta, sem escrever nada: (a) documentos com `status` fora do enum FSM
      válido pra sua sequência de transições (indício de pulo de estado); (b) `installmentGroupId`
      com contagem de parcelas divergente de `installmentTotal`; (c) `recurrenceId` órfão (aponta
      pra uma recorrência que não existe/foi apagada); (d) `saleId`/`purchaseNoteId`/
      `appointmentId`/`deliveryOrderId` que apontam pra um documento de origem inexistente
      (referência quebrada); (e) duplicidade aparente (mesmo `saleId`+`type` em 2+ docs, sinal do
      risco de double-click já auto-documentado em `AGENDA_COBRANCA.md`).
- [x] `scripts/audit-m03-financial.ts` (CLI, mesmo formato de `scripts/audit-m06-agenda.ts`) —
      roda a auditoria contra um tenant real quando houver um disponível.
- [ ] ~~Caracterizar em prosa (mesmo formato do M06.0b) o comportamento efetivo de cada um dos 13
      caminhos de escrita já inventariados nesta investigação~~ — **já feito na investigação de
      abertura do M03** (`docs/paridade/M03_PLANO_IMPLEMENTACAO.md` §0, tabela completa com
      arquivo/linha/mecanismo/hardening de cada um dos 13 caminhos) — redundante repetir aqui.

**Entregue:** 8 códigos de problema (`TENANT_MISMATCH`, `INVALID_TYPE`, `INVALID_STATUS`,
`NON_POSITIVE_AMOUNT`, `INSTALLMENT_COUNT_MISMATCH`, `ORPHAN_RECURRENCE`,
`BROKEN_SOURCE_REFERENCE`, `DUPLICATE_SOURCE_TRANSACTION`) — os 3 primeiros desdobram o item (a)
original em três checks igualmente baratos (mesma causa raiz: validação rasa). Violação de
transição do FSM deliberadamente NÃO incluída — snapshot de um instante não vê histórico, isso é
trabalho de enforcement ao vivo (M03.4). 16 testes novos (`tests/services/
m03FinancialAudit.test.ts`). **Não executado contra um tenant real** ainda — mesma situação do
M06.0 (cliente não está em produção no sistema). Detalhes em
`docs/financeiro/FINANCEIRO_M03_0_BASELINE.md`. Verificado por `tsc --noEmit` limpo e suíte
completa (1033 testes/77 arquivos, sem regressão).

**Saída:** evidência de quanto do problema já existe nos dados reais antes de mudar qualquer regra.

### M03.1 — Contrato de domínio (pré-requisito SDD, R2) ✅ Concluído (04/09/2026)

- [x] Promover `lib/contracts/fsm/transaction.ts` (já existe, só o FSM) + `Transaction` de
      `lib/types/index.ts` pra um contrato completo em `lib/contracts/domain/transaction.ts`
      (Zod + invariantes), conforme já auto-apontado como TODO no próprio arquivo do FSM.
      `z.infer` substitui a interface solta — não redeclarar em paralelo (R2 do CLAUDE.md).
- [ ] ~~Decidir e documentar o shape mínimo aceitável por tipo de lançamento (receita/despesa,
      à vista/parcelado/recorrente) via `superRefine`/discriminated union~~ — **analisado,
      deliberadamente adiado**: decidir o shape mínimo por variante depende de observar os 13
      write paths reais sendo migrados em M03.2/M03.3; fazer isso agora, especulativamente,
      arriscaria rejeitar um formato que algum caminho hoje já usa legitimamente. As invariantes
      SEGURAS de verificar sem esse risco (`installmentTotal`/`Number` exigem
      `installmentGroupId`; `amount > 0`) já foram aplicadas via `superRefine`/field-level.

**Entregue:** `lib/contracts/domain/transaction.ts` novo (contrato completo, ~45 campos +
objetos aninhados `recurrence`/`attachments`). Achado real durante a promoção: **3 fontes de
verdade independentes** pro mesmo enum de status/type (`fsm/transaction.ts`, e uma 3ª hardcoded
em `lib/contracts/api/agent/_shared.ts` que ninguém tinha notado) — consolidadas nas 1 canônica
do domínio, mesmo sentido de dependência de `fsm/appointment.ts → domain/appointment.ts`.
`amount` virou `.positive()` rígido desde já (sem tenant real em produção pra quebrar). Achado
de passagem, não corrigido: `PaymentMethodSchema` do agente tem valores DIFERENTES do
`PaymentMethod` real (`cartao_loja` vs `creditoLoja`, etc.) — escopo próprio. 17 testes novos
(`tests/contracts/transactionDomain.test.ts`). Detalhes em
`docs/financeiro/FINANCEIRO_M03_1_CONTRATO_DOMINIO.md`. Verificado por `tsc --noEmit` limpo e
suíte completa (1050 testes/78 arquivos, sem regressão).

### M03.2 — Núcleo de criação/transição (o que nunca existiu) ✅ Concluído (04/09/2026)

- [x] `lib/services/transactionTxGuardAdmin.ts` (Admin SDK) — mirror de
      `appointmentTxGuardAdmin.ts`: criação com idempotência real (ID determinístico + `tx.create()`,
      mesmo padrão de `purchase-financial-admin.ts` — o Firestore rejeita atomicamente se o doc
      já existe, sem precisar de lock separado) e aplicação do FSM
      (`assertTransitionTransaction`) em toda mudança de status.
- [ ] ~~`lib/services/transactionTxGuard.ts` (client SDK)~~ — **analisado, deliberadamente não
      construído**: diferente da Agenda (calendário em tempo real, múltiplos operadores editando
      o mesmo dia), não há caso de uso comprovado de escrita direta browser→Firestore com
      pré-check local pra Transaction — os caminhos já hardenizados do Financeiro são todos
      Admin SDK via rota server-side. Construir se a migração do clássico/V2 (M03.3) revelar
      necessidade real.
- [ ] ~~`POST /api/transactions` (Admin SDK, autoritativo)~~ — **adiado pra M03.3**: o núcleo
      (guard) e a rota que o expõe são passos distintos; a rota nasce junto com a migração do
      primeiro caller real, não antes (evita uma rota sem consumidor).
- [x] Idempotência real (R3): chave derivada de `saleId`/`purchaseNoteId`/`appointmentId`/
      `deliveryOrderId`+tipo (+`installmentNumber` quando presente) — MESMA combinação que
      `m03-financial-audit.ts` usa como chave de duplicidade, de propósito. `idempotencyKey`
      explícito do caller tem prioridade. Fecha o double-click auto-documentado em
      `AGENDA_COBRANCA.md`.

**Não é reescrita dos 5 caminhos já hardenizados** (venda PDV, compra, delivery, estorno,
liquidação MP) — esses já têm seu próprio guard transacional específico por módulo, correto e
testado. Este núcleo serve especificamente os caminhos MANUAIS (clássico, V2, API v1, agente).

**Entregue:** 12 testes novos (`tests/services/transactionTxGuardAdmin.test.ts`) — replay
idempotente sem duplicar, parcelas distintas da mesma origem não colidem, origens diferentes
nunca colidem, chave explícita tem prioridade, transição válida/inválida/no-op, tenant cruzado.
Nenhuma rota/UI usa este guard ainda — isso é M03.3. Detalhes em
`docs/financeiro/FINANCEIRO_M03_2_NUCLEO.md`. Verificado por `tsc --noEmit` limpo e suíte
completa (1062 testes/79 arquivos, sem regressão).

### M03.3 — Migrar os caminhos de maior risco pro núcleo (1ª rodada concluída, 04/09/2026)

Ordem por risco × exposição, não por ordem alfabética:

- [x] `app/api/v1/transactions/route.ts` (API externa, validação ad-hoc, sem idempotência —
      maior exposição a terceiro sem controle de retry). **Migrado**: `POST` usa
      `createTransactionSafeAdmin` (aceita `X-Idempotency-Key`, R3, que a rota nunca suportou
      antes); `PUT`/`mark-paid` usa `transitionTransactionSafeAdmin` (FSM aplicado — transição
      inválida agora responde 409 em vez de aceitar sem checar). Detalhes em
      `docs/financeiro/FINANCEIRO_M03_3_MIGRACAO_API_V1.md`.
- [x] `app/api/agent/tools/financial/route.ts` — **investigado (achado original: `markPaid`/
      `cancelTx` JÁ chamavam `assertTransitionTransaction`, FSM já aplicado) E retomado**:
      contrato do agente (`lib/contracts/api/agent/financial.ts`) ganhou `idempotencyKey`
      opcional; `createTx` (ramo sem parcelamento) migrou pro núcleo (`createTransactionSafeAdmin`,
      M03.2), habilitando dedup real QUANDO o caller manda a chave. Achado novo nesta rodada:
      já existe proteção de replay em nível de TRANSPORTE (`agentNonces`/`verifyAgentRequest`,
      HMAC por request) — o campo novo protege um cenário diferente (resposta perdida após
      sucesso), e só funciona de ponta a ponta quando o agente Python passar a gerar/reenviar a
      chave, o que NÃO foi feito nesta sessão (fora do repo, lado Python). Achado colateral real
      (não hipotético): Admin SDK rejeita `undefined` explícito em qualquer campo gravado
      (`ignoreUndefinedProperties` nunca configurado) — `createTx` (os 2 ramos) e `cancelTx`
      atribuíam campos opcionais incondicionalmente, o que provavelmente já lançava 500 em
      chamadas legítimas sem `dueDate`/`notes`; corrigido com atribuição condicional. Parcelamento
      em lote continua deliberadamente sem dedup (regrediria a garantia tudo-ou-nada do batch).
      Ver `docs/financeiro/FINANCEIRO_M03_3_AGENTE_IDEMPOTENCIA.md`.
- [ ] ~~`financial/FinancialModule.tsx` + `financial-v2/components/LancarSheet.tsx`/
      `BaixaDialog.tsx`~~ — adiado: depende de decidir se nasce uma rota `POST /api/transactions`
      nova (client→server) ou se essas telas continuam client SDK direto; decisão natural de
      fazer junto com M03.6 (V1 vs V2), não isoladamente.
- [x] `PDVModule.tsx:1173-1184` — **investigado (achado menos grave do que o plano supunha: toda
      transição PARA `cancelado` já é válida a partir de QUALQUER estado no FSM, então não havia
      violação de FSM possível) E corrigido o gap real que sobrava**: o loop de `updateDoc`
      independentes (um por transação vinculada à venda) não era atômico — conexão caindo no
      meio deixava uma transação cancelada e outra não, se a venda tivesse mais de uma vinculada
      (ex.: receita + comissão). Corrigido com `runTransaction` (client SDK) + re-checagem de
      tenant por documento — mesmo escopo funcional de antes, agora atômico. **Não** migrado pro
      guard Admin-SDK (M03.2) nem movido pra rota server-side — ambos continuam maiores que o
      necessário pra fechar o gap real encontrado (atomicidade, não FSM). `firestore.rules`
      (M03.4) já cobre `amount>0`/transição válida nesta escrita mesmo sem o núcleo.
- [ ] `lib/services/commission.ts` — unificar `maybeCreateCommission`/`maybeCreateCommissionAdmin`
      (hoje duplicados por cópia manual, não compartilhados) numa fonte única, migrada pro núcleo.
      Não abordado nesta rodada.

### M03.4 — Enforcement no servidor ✅ Concluído (04/09/2026)

- [x] `firestore.rules` pra `transactions`: `amount > 0` exigido em `create` E `update`; nova
      função `isValidTransactionTransition` (espelha `TRANSACTION_TRANSITIONS` manualmente —
      rules não importa TS) valida transição de status em `update`. Última linha de defesa pros
      caminhos client SDK que ainda não passam pelo núcleo (clássico/V2, hoje).
- [ ] ~~Confirmar que TODA escrita de status... passa pelo FSM~~ — **fora de escopo desta
      fatia**: os 5 caminhos já hardenizados (venda/compra/delivery/estorno/MP) são corretos por
      construção (nunca pulam estado); auditar se DEVEM chamar `assertTransitionTransaction`
      explicitamente é uma decisão de estilo/DRY, não um bug — não perseguida aqui.

**Entregue:** `amount > 0` + transição de status validada em `firestore.rules`, sem allowlist de
campos (edição de `amount` continua permitida — o que ficou proibido é só valor não-positivo).
Decisão deliberada de começar com a regra certa (nenhum tenant real em produção pra quebrar).
**Limitação real, não escondida**: não foi possível validar a sintaxe via emulador do Firestore
nesta sessão (`firebase emulators:start` falhou — `Could not spawn 'java -version'`, Java
ausente neste ambiente; não é erro de sintaxe, é a ferramenta de validação indisponível).
Mitigação: sintaxe usada já é idêntica a construções existentes no mesmo arquivo; `firebase
deploy --only firestore:rules` recusa o deploy inteiro se não compilar, então um erro aqui seria
pego antes de afetar produção. Detalhes em
`docs/financeiro/FINANCEIRO_M03_4_ENFORCEMENT_RULES.md`.

### M03.5 — Testes pra conciliação (dinheiro real, zero cobertura hoje) ✅ Concluído (04/09/2026)

- [x] `tests/services/reconciliation.test.ts` — `parseOFX`/`parseCSV`/`autoMatch` são lógica pura
      já testável sem Firestore; hoje têm ZERO teste apesar de mexerem com conciliação bancária
      real. Prioridade alta independente do resto do plano.
- [x] Casos mínimos: parsing de formatos malformados (não deve lançar, deve reportar erro
      recuperável), tolerância de valor/data do `autoMatch` nos limites (±R$0,01, ±3 dias),
      caso especial Mercado Pago (valor líquido vs. bruto).

**Entregue:** 36 testes novos, zero mudança de comportamento em `reconciliation.ts`. Achado real
durante a escrita: `parseCSV` nunca suportou decimal em ponto (sempre remove `.` como separador
de milhar antes de trocar `,` por `.`) — comportamento intencional (formato brasileiro), mas sem
nenhuma garantia escrita até agora; documentado com teste próprio pra não virar regressão
silenciosa. Detalhes em `docs/financeiro/FINANCEIRO_M03_5_TESTES_CONCILIACAO.md`. Verificado por
`tsc --noEmit` limpo e suíte completa (1017 testes/76 arquivos, sem regressão).

### M03.6 — Decisão de produto: V1 vs V2 (ver §1) — investigação de paridade concluída (04/09/2026)

- [x] **Inventário de paridade real** feito a pedido do usuário (recusou decidir sem dados).
      `docs/financeiro/FINANCEIRO_M03_6_PARIDADE_V1_V2.md`: 11 capacidades só no clássico
      (CRUD completo de lançamento, parcelamento, gestão de série recorrente, comissões, CRUD de
      conta bancária, projetos, multi-moeda, integração "Cobrar" da Agenda — quebrada no V2),
      10 só no V2 (DRE, caixa físico, analytics de assinatura com churn, "Super Consultor",
      drill de conciliação), 4 compartilhadas (conciliação, auditoria, projeção de caixa —
      corrigido, não é V2-exclusiva —, MRR genérico). Risco de dado concreto encontrado:
      `bankAccounts.balance` diverge semanticamente entre as duas UIs (manual no clássico, ledger
      vivo no V2).
- [x] **Decisão do usuário (04/09/2026): clássico continua sendo o Financeiro principal.**
      Motivo direto: o cliente pagante atual (odontologia) depende de capacidades que o V2 hoje
      não tem (editar/cancelar lançamento, parcelamento, comissão, integração "Cobrar" da
      Agenda — já documentada como quebrada no V2). Ação concreta: banner de convite
      (`FinancialV2EntryBanner`, "Novo Financeiro (beta) — Experimentar") removido de
      `app/app/page.tsx` pra ninguém migrar sem saber dos gaps de escrita. **Não é remoção do
      V2** — componente, flag `financialV2Enabled` e todo `financial-v2/` permanecem intocados;
      qualquer tenant que já tivesse a flag ligada continua acessando normalmente, e o trabalho
      (DRE, caixa físico, analytics de assinatura) fica disponível pra retomar/portar se um dia
      fizer sentido. Verificado por `tsc --noEmit` limpo e suíte completa (1063/79, sem
      regressão).

### M03.7 — DRE/fluxo de caixa/orçamento (depende de M03.6)

- [x] Se V2 vencer: nada a fazer, já existe. Se clássico vencer ou convivência: decidir se DRE/
      projeção de caixa precisam de paridade no clássico, ou se o usuário aceita usar só o V2
      pra essas telas específicas mesmo mantendo o clássico pro resto.
- [x] Orçamento (`Budget`): confirmar com o usuário se é necessidade real antes de construir
      qualquer coisa — hoje é 100% especulativo (tipo declarado, zero uso).

**M03.7 concluída em código (08/09/2026).** Checkpoint com o usuário: **portar DRE + projeção
de caixa pro clássico** (não usar o V2 só pra essas telas) e **construir Orçamento agora** (não
ficar dormente). Implementado:

- **Novas abas no Financeiro clássico**: "DRE" (`DreTab.tsx`) e "Orçamento" (`OrcamentoTab.tsx`),
  ao lado de Conciliação/Auditoria.
- **DRE + projeção de caixa reusam os read-models PUROS do financial-v2** (`computeDreMensal`/
  `computeProjecaoCaixa` de `financial-v2/read-models/`) — mesma matemática dos dois regimes
  (competência/caixa) e da janela de 30 dias, **sem duplicar lógica**. Só a UI é nova: o SVG do
  V2 depende de variáveis CSS `--fin-*` escopadas ao módulo V2, então a visualização de caixa no
  clássico é um gráfico de barras em Tailwind puro (mesma informação — saldo projetado dia a dia,
  aviso quando cruza zero —, visual mais simples). Export PDF/CSV do DRE reusa
  `lib/utils/financial-export.ts`, já compartilhado com o resto do clássico.
- **`Budget` promovido a contrato SDD** (`lib/contracts/domain/budget.ts`, R2) — o tipo já existia
  em `lib/types/index.ts` mas nunca tinha schema Zod nem uso real. `category`/`type` reusam as
  MESMAS constantes `INCOME_CATEGORIES`/`EXPENSE_CATEGORIES` que os lançamentos já usam — sem
  taxonomia paralela. Doc ID determinístico (`budgetDocId(businessId,year,month,category,type)`)
  faz "criar meta" e "editar meta" serem o MESMO `setDoc` — sem query de unicidade, duplicata
  impossível por construção da chave. Realizado calculado com a MESMA regra de competência do DRE
  (dueDate, não-cancelada) — `realizedByCategory()` em `OrcamentoTab.tsx`.
- **`firestore.rules`**: novo match `/budgets/{budgetId}` — `isManager()` pra read/create/update/
  delete, mesmo padrão de `transactions`/`bankAccounts`. Validado via
  `firebase deploy --only firestore:rules --dry-run` (compilou).
- **Achado colateral corrigido**: o item "Financeiro" do Sidebar não tinha `minRole:'manager'`
  (mesma classe de bug já corrigida em M08.5 pra "Relatórios") — não-manager via o menu mas toda
  query dentro do módulo falhava por regra (`transactions` exige `isManager()`), UI quebrada em
  vez de escondida. Corrigido — mesmo padrão do Sidebar aplicado.
- Testes novos: `tests/contracts/budget.test.ts` (13 casos — schema + `budgetDocId` determinístico/
  sem colisão) e `tests/services/orcamentoRealized.test.ts` (5 casos — agregação por categoria).
  Suite completa sem regressão (1139 testes/86 arquivos). Não testado contra navegador nesta
  sessão (mesma ressalva de sempre).

### M03.8 — Integrações externas (PIX/Boleto/OCR/Open Banking)

- [ ] Fora de escopo por padrão (§2). Reavaliar só se aparecer sinal real de demanda (cliente
      pedindo cobrança por PIX/boleto emitido pelo sistema, ou contador pedindo OCR de nota).

### M03.9 — Testes, homologação e aceite

- [ ] Testes de isolamento multi-tenant nos novos guards (mesmo padrão M06.9).
- [ ] Teste de idempotência: dois cliques rápidos no mesmo lançamento não duplicam.
- [ ] Smoke manual: lançar receita/despesa manual, parcelar, marcar como pago, cancelar,
      conciliar um extrato OFX de teste — end-to-end no clássico E no V2 (ou só na UI vencedora
      de M03.6, se já decidido).

## 4. Critérios para marcar M03 como concluído

- [ ] Existe **um** núcleo de criação/transição de Transaction, com idempotência real e FSM
      aplicado, usado por toda escrita manual (clássico, V2, API v1, agente).
- [ ] Os 13 caminhos de escrita inventariados nesta investigação foram auditados; os que
      precisavam de correção foram migrados ou tiveram gap documentado e aceito.
- [ ] `parseOFX`/`parseCSV`/`autoMatch` têm cobertura de teste real.
- [x] Decisão V1 vs V2 está tomada e registrada (não necessariamente executada por completo —
      mas não mais em aberto). **Tomada em 04/09/2026: clássico é o principal** (ver M03.6).
- [ ] `firestore.rules` de `transactions` não permite mais pular estado do FSM livremente (ou a
      decisão de não fechar esse gap na camada de rules está registrada com justificativa).

## 5. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Migrar o clássico/V2 pro núcleo novo e quebrar um fluxo real de caixa em produção | M03.0 mede o estado real antes; migração módulo a módulo (M03.3), não big-bang; testar cada write-path migrado contra os casos já caracterizados |
| Consolidar V1/V2 sem que V2 realmente cubra tudo que V1 cobre (`ProjetosTab`/multi-moeda) | Decisão de produto (M03.6) explícita, não silenciosa — inventário de gaps de paridade feito ANTES da decisão, não depois |
| Apertar `firestore.rules`/FSM e travar um lançamento hoje aceito | Mesmo padrão M02.5b/M06: auditoria prévia mostra quantos registros violariam a regra nova antes de endurecer |
| Investir em PIX/Boleto/OCR/Open Banking sem demanda real | Deliberadamente fora de escopo (§2), dormente até sinal real, mesmo tratamento do backlog fiscal |
| Quebrar a conciliação bancária real (dinheiro de verdade) ao tocar em `reconciliation.ts` | M03.5 escreve teste ANTES de qualquer refactor nesse arquivo |

## 6. Dependências e relação com outros módulos

- **M01 (Estoque/Compras):** `linkPurchaseFinancialAdmin` já é um dos caminhos hardenizados —
  não precisa de migração, só de auditoria de conformidade com o FSM.
- **M02 (Vendas/PDV):** `ensureCommercialEffectDocumentAdmin`/checkout já hardenizado; a
  REVERSÃO de venda no PDV (`PDVModule.tsx`) é o gap real a corrigir (M03.3).
- **M04 (Fiscal):** `isLocked`/`lockedReason` no `Transaction` já modela um lock fiscal — auditar
  se algum caminho ignora esse lock ao editar/cancelar.
- **M06 (Agenda):** cobrança de atendimento (`AGENDA_COBRANCA.md`) já documentou boa parte do
  double-click/falta-de-contrato que este plano formaliza — M03 fecha o que M06.6 já tinha
  sinalizado como "fora do escopo da Agenda, é problema do Financeiro".
- **M10 (Automações):** `membershipBillingRunner.ts` (cron de cobrança de assinatura) é um
  candidato natural a padronizar via M10 quando esse módulo abrir formalmente.

## 7. Entregas já realizadas fora da sequência

| Entrega | Documento |
|---|---|
| Vínculo Agenda→Financeiro (botão "Cobrar", parcelamento) | `docs/agenda/AGENDA_COBRANCA.md` |
| Vínculo fiscal pendente→origem (Sale/DeliveryOrder/Appointment) | `docs/fiscal/FISCAL_VINCULO_PENDENTE.md` (M04, mas toca `Transaction`-adjacent — `isLocked` fiscal) |

## 8. Ordem de entrega recomendada

1. **M03.5** ✅ — testes de conciliação primeiro (menor risco, maior urgência: dinheiro real e
   zero cobertura hoje; não depende de nenhuma decisão de produto).
2. **M03.0** ✅ — baseline/auditoria (mede antes de mexer, mesmo racional de M01/M06).
3. **M03.1** ✅ — contrato de domínio (pré-requisito SDD pra tudo que vem depois).
4. **M03.2** ✅ — núcleo de criação/transição novo (só Admin SDK; client SDK e a rota
   `POST /api/transactions` deliberadamente adiados pra M03.3).
5. **M03.3** ✅ — API v1 migrada; PDV-reversão corrigido (atomicidade); contrato do agente ganhou
   idempotência opcional; clássico/V2 adiado pra decidir junto de M03.6; comissão não abordada.
6. **M03.4** ✅ — enforcement no servidor (`firestore.rules`: `amount>0` + transição de status).
7. **M03.6** ✅ — checkpoint com o usuário: decisão V1 vs V2 tomada (clássico é o principal).
8. **M03.7** — DRE/fluxo de caixa/orçamento, conforme a decisão de M03.6 (clássico venceu —
   avaliar se algum dia faz sentido portar DRE/caixa físico pra ele; não prioritário agora).
9. **M03.8** — permanece dormente (fora de escopo por padrão).
10. **M03.9** — aceite.

**Mínimo pra a odontologia operar com mais segurança: M03.5 → M03.0 → M03.1 → M03.2**, mais a
migração do caminho de maior exposição real (API v1, se estiver em uso por integração externa
real — confirmar antes de priorizar). O resto é hardening incremental, não bloqueio operacional
imediato (o Financeiro já funciona hoje, só sem as garantias que os outros módulos já têm).
