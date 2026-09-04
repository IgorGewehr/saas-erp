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
> Estado: investigação (M03.0-pré) concluída em 04/09/2026. Nenhum código alterado ainda —
> este documento é o plano, mirando o mesmo formato de `M06_PLANO_IMPLEMENTACAO.md`.

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
5. **DRE/fluxo de caixa/orçamento**: DRE e projeção de caixa são reais mas só existem no V2
   (nenhuma linha de código equivalente no clássico); Orçamento (`Budget`) é um tipo declarado
   com **zero** consumidores — nunca foi implementado.
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

### M03.0 — Baseline (mede antes de mexer)

- [ ] `lib/services/m03-financial-audit.ts` (espelha `m06-agenda-audit.ts`): varre `transactions`
      por tenant e detecta, sem escrever nada: (a) documentos com `status` fora do enum FSM
      válido pra sua sequência de transições (indício de pulo de estado); (b) `installmentGroupId`
      com contagem de parcelas divergente de `installmentTotal`; (c) `recurrenceId` órfão (aponta
      pra uma recorrência que não existe/foi apagada); (d) `saleId`/`purchaseNoteId`/
      `appointmentId`/`deliveryOrderId` que apontam pra um documento de origem inexistente
      (referência quebrada); (e) duplicidade aparente (mesmo `saleId`+`type` em 2+ docs, sinal do
      risco de double-click já auto-documentado em `AGENDA_COBRANCA.md`).
- [ ] `scripts/audit-m03-financial.ts` (CLI, mesmo formato de `scripts/audit-m06-agenda.ts`) —
      roda a auditoria contra um tenant real quando houver um disponível.
- [ ] Caracterizar em prosa (mesmo formato do M06.0b) o comportamento efetivo de cada um dos 13
      caminhos de escrita já inventariados nesta investigação — fixar o que cada um faz HOJE
      antes de qualquer migração, pra detectar regressão depois.

**Saída:** evidência de quanto do problema já existe nos dados reais antes de mudar qualquer regra.

### M03.1 — Contrato de domínio (pré-requisito SDD, R2)

- [ ] Promover `lib/contracts/fsm/transaction.ts` (já existe, só o FSM) + `Transaction` de
      `lib/types/index.ts` pra um contrato completo em `lib/contracts/domain/transaction.ts`
      (Zod + invariantes), conforme já auto-apontado como TODO no próprio arquivo do FSM.
      `z.infer` substitui a interface solta — não redeclarar em paralelo (R2 do CLAUDE.md).
- [ ] Decidir e documentar o shape mínimo aceitável por tipo de lançamento (receita/despesa,
      à vista/parcelado/recorrente) — hoje o `Transaction` tem ~45 campos opcionais numa única
      interface flat; o contrato deve deixar explícito o que é obrigatório em cada caso via
      `superRefine`/discriminated union, não só "tudo opcional".

### M03.2 — Núcleo de criação/transição (o que nunca existiu)

- [ ] `lib/services/transactionTxGuard.ts` (client SDK) + `transactionTxGuardAdmin.ts` (Admin SDK)
      — mesma dupla já usada por Appointment (`appointmentTxGuard(Admin).ts`): criação com
      idempotência real (idempotency key ou fingerprint determinístico, não check-then-act) e
      aplicação do FSM (`assertTransitionTransaction`) em toda mudança de status.
- [ ] `POST /api/transactions` (Admin SDK, autoritativo) — mirror de `POST /api/appointments`
      (M06.1) e `POST /api/sales/checkout` — substitui os `addDoc`/`updateDoc` diretos do
      clássico e do V2 pra criação/baixa manual.
- [ ] Idempotência real (R3): toda criação aceita `X-Idempotency-Key` OU deriva uma chave
      determinística (ex.: `saleId`/`appointmentId`+tipo, quando a origem existe) — fecha o
      double-click auto-documentado em `AGENDA_COBRANCA.md`.

**Não é reescrita dos 5 caminhos já hardenizados** (venda PDV, compra, delivery, estorno,
liquidação MP) — esses já têm seu próprio guard transacional específico por módulo, correto e
testado. Este núcleo serve especificamente os caminhos MANUAIS (clássico, V2, API v1, agente).

### M03.3 — Migrar os caminhos de maior risco pro núcleo

Ordem por risco × exposição, não por ordem alfabética:

- [ ] `app/api/v1/transactions/route.ts` (API externa, validação ad-hoc, sem idempotência —
      maior exposição a terceiro sem controle de retry).
- [ ] `app/api/agent/tools/financial/route.ts` (`create_receivable`/`create_payable` — já tem
      Zod no boundary, falta idempotência).
- [ ] `financial/FinancialModule.tsx` (criação/edição manual, clássico) — client SDK direto vira
      chamada ao núcleo.
- [ ] `financial-v2/components/LancarSheet.tsx` + `BaixaDialog.tsx` (criação/baixa manual, V2).
- [ ] `PDVModule.tsx:1173-1184` (cancelamento de venda reverte Transaction via `updateDoc` cru,
      ignorando o FSM que a CRIAÇÃO da mesma venda já respeita via caminho hardenizado — mesma
      classe de inconsistência "hardenizado na criação, cru na reversão" já vista em outros
      módulos nesta sessão).
- [ ] `lib/services/commission.ts` — unificar `maybeCreateCommission`/`maybeCreateCommissionAdmin`
      (hoje duplicados por cópia manual, não compartilhados) numa fonte única, migrada pro núcleo.

### M03.4 — Enforcement no servidor

- [ ] `firestore.rules` pra `transactions`: hoje só valida enum de `status`/`type` — adicionar
      pelo menos `amount > 0` e considerar mover a checagem de transição de status pra
      Cloud Function/rule custom (ou aceitar que o enforcement real vive só na API — decisão a
      registrar, não assumir).
- [ ] Confirmar que TODA escrita de status (inclusive as 5 já hardenizadas de outros módulos)
      passa pelo FSM — hoje elas são corretas por construção (não pulam estado), mas nenhuma
      chama `assertTransitionTransaction` explicitamente; vale auditar se DEVEM passar a chamar
      pra fechar o loop, ou se a correção por construção já é suficiente (decisão técnica, não
      assumir sem checar caso a caso).

### M03.5 — Testes pra conciliação (dinheiro real, zero cobertura hoje)

- [ ] `tests/services/reconciliation.test.ts` — `parseOFX`/`parseCSV`/`autoMatch` são lógica pura
      já testável sem Firestore; hoje têm ZERO teste apesar de mexerem com conciliação bancária
      real. Prioridade alta independente do resto do plano.
- [ ] Casos mínimos: parsing de formatos malformados (não deve lançar, deve reportar erro
      recuperável), tolerância de valor/data do `autoMatch` nos limites (±R$0,01, ±3 dias),
      caso especial Mercado Pago (valor líquido vs. bruto).

### M03.6 — Decisão de produto: V1 vs V2 (ver §1)

- [ ] **Não é decisão de engenharia.** Registrar aqui a decisão do usuário quando vier, e as
      consequências (portar features faltantes, aposentar a árvore perdedora, ou formalizar
      convivência permanente).

### M03.7 — DRE/fluxo de caixa/orçamento (depende de M03.6)

- [ ] Se V2 vencer: nada a fazer, já existe. Se clássico vencer ou convivência: decidir se DRE/
      projeção de caixa precisam de paridade no clássico, ou se o usuário aceita usar só o V2
      pra essas telas específicas mesmo mantendo o clássico pro resto.
- [ ] Orçamento (`Budget`): confirmar com o usuário se é necessidade real antes de construir
      qualquer coisa — hoje é 100% especulativo (tipo declarado, zero uso).

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
- [ ] Decisão V1 vs V2 está tomada e registrada (não necessariamente executada por completo —
      mas não mais em aberto).
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

1. **M03.5** — testes de conciliação primeiro (menor risco, maior urgência: dinheiro real e zero
   cobertura hoje; não depende de nenhuma decisão de produto).
2. **M03.0** — baseline/auditoria (mede antes de mexer, mesmo racional de M01/M06).
3. **M03.1** — contrato de domínio (pré-requisito SDD pra tudo que vem depois).
4. **M03.2** — núcleo de criação/transição.
5. **M03.3** — migrar os caminhos de maior risco (API v1 e agente primeiro — exposição externa;
   depois clássico/V2/PDV-reversão/comissão).
6. **M03.4** — enforcement no servidor.
7. **M03.6** — checkpoint com o usuário: decisão V1 vs V2 (bloqueia M03.7 até vir).
8. **M03.7** — DRE/fluxo de caixa/orçamento, conforme a decisão de M03.6.
9. **M03.8** — permanece dormente (fora de escopo por padrão).
10. **M03.9** — aceite.

**Mínimo pra a odontologia operar com mais segurança: M03.5 → M03.0 → M03.1 → M03.2**, mais a
migração do caminho de maior exposição real (API v1, se estiver em uso por integração externa
real — confirmar antes de priorizar). O resto é hardening incremental, não bloqueio operacional
imediato (o Financeiro já funciona hoje, só sem as garantias que os outros módulos já têm).
