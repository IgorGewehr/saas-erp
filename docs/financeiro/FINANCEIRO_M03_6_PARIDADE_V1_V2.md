# Financeiro — inventário de paridade V1 (clássico) vs V2 (M03.6, pré-decisão)

> Concluído em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: o usuário, ao ser perguntado sobre a decisão V1 vs V2 (M03.6), pediu investigação de
> paridade real antes de decidir, em vez de escolher às cegas. Este documento é o inventário —
> não contém recomendação de qual UI escolher, isso continua sendo decisão do usuário.

## 1. Correção a um dado do plano original

`docs/paridade/M03_PLANO_IMPLEMENTACAO.md` (investigação de abertura) afirmava que "projeção de
caixa... só existe no V2, nenhuma linha de código equivalente no clássico". **Isso está errado** —
o clássico tem sua própria projeção (diária 30/60/90d + 13 semanas, com toggle
otimista/conservador, exportável em CSV) dentro da aba Transações (`FinancialModule.tsx:4104-
4483` cálculo, `4740-4849` render). É menos "orientada a insight" que a do V2 (sem framing
competência/caixa), mas é real e funcional. Corrigido aqui e no plano (§3).

## 2. Capacidades só no clássico (confirmado lendo código)

1. **CRUD completo de lançamento** — editar qualquer campo, cancelar com auditoria, reverter
   pago→pendente, forma de pagamento, conta bancária, cliente, setor/projeto, anexos, e
   **parcelamento em N vezes** (lote com resto absorvido pela última parcela). O V2 só cria
   (`LancarSheet.tsx`: tipo/descrição/categoria/valor/vencimento + checkbox "repete mensal") e
   marca como pago (`BaixaDialog.tsx`). **Não existe hoje no V2 nenhum jeito de editar, cancelar
   ou excluir um lançamento, nem de criar parcelamento.**
2. **Gestão de séries recorrentes** — pausar/retomar/pular ocorrência, encerrar série, ajustar
   valor (%/fixo), operações em lote, calendário, simulador de 12 meses, detecção automática de
   lançamento repetido com sugestão de virar série, anexo por ocorrência, cálculo de multa/juros
   no pagamento (`RecurringContent`, ~1250 linhas). V2 (`RecorrentesTab`/`ContasFixasLens`/
   `AssinaturasLens`) é só leitura/relatório — zero ação de escrita.
3. **Diálogo de grupo de parcelas** — editar vencimento por parcela, marcar paga, cancelar, pagar
   todas pendentes. Sem equivalente no V2 (V2 não tem parcelamento).
4. **Aba de Comissões** — tracking por profissional, taxa editável, filtro de período, pagar
   todas, export CSV. Zero ocorrência de "comiss" em `financial-v2/`.
5. **CRUD de conta bancária** — criar/editar/excluir. V2 só LÊ `bankAccounts`
   (`useFinBankAccounts`) e incrementa `balance` — **acha um bloqueio real**: a própria feature
   de caixa físico do V2 exige uma `BankAccount` com `accountType==='caixa'`, mas só o clássico
   consegue criar uma. Sem o clássico, ninguém cria a primeira conta-caixa do V2.
6. **Projetos/centro de custo** (`ProjetosTab.tsx`) — CRUD completo de projeto (cor, status),
   gráfico receita/despesa/saldo, drill por projeto. V2 só lê `projects`
   (`useFinProjects`) pra alimentar o eixo "Assinaturas" — sem CRUD.
7. **Toggle de multi-moeda** (`CurrencyContext`/`CurrencyToggle`) — exibição BRL/USD (dado
   subjacente continua em BRL). Funcionalmente independente de Projetos (apesar de mencionados
   juntos no plano original) — feature separada. Sem equivalente no V2.
8. **Integração "Cobrar" da Agenda** — pré-preenche o formulário do clássico via
   `sessionStorage` e grava `billingTransactionId`/`billingInstallmentGroupId` de volta no
   Appointment. Já documentado como **quebrado quando V2 está ativo**
   (`docs/agenda/AGENDA_COBRANCA.md:82-88`): `FinancialV2Module` nunca lê o prefill, o botão
   navega mas nada é preenchido nem gravado de volta. **Relevante agora**: o cliente pagante atual
   (odontologia) depende exatamente desse fluxo.
9. **Relatórios Enterprise** — receita por canal, por setor, ROI de campanha, top 10 CLV
   (gated em `business.enterprise.isEnabled`). Zero equivalente no V2.
10. Filtros salvos avançados, export CSV/PDF da lista, abrir como planilha.

## 3. Capacidades só no V2 (confirmado lendo código)

1. **DRE** com toggle de regime competência/caixa, isola Impostos/DAS (Simples Nacional), export
   CSV/PDF. Sem equivalente no clássico.
2. **Caixa físico** — abrir (troco inicial)/sangria/fechar com contagem física vs. esperado,
   com entidade+FSM próprios (`lib/contracts/domain/cashSession.ts`,
   `lib/contracts/fsm/cashSession.ts`) e coleção nova `cashSessions`. O clássico tem o **tipo**
   `caixa` no schema de conta bancária mas nenhum workflow de sessão ao redor.
3. **Registro DAS** — plugado no DRE, mas **sem nenhum escritor no app hoje**
   (`useFinancialData.ts:119-121`: comentário confirma que a query nunca acha nada ainda) —
   plumbing de placeholder, não feature funcionando.
4. **Dashboard "3 baldes" de conciliação bancária** + fluxo semanal + drill de categoria/aging
   com 6 meses de histórico e detecção de anomalia. **Correção**: os dados subjacentes
   (`reconciliationItems`) NÃO são exclusivos do V2 — são escritos pelo mesmo import OFX/CSV do
   clássico (`ConciliacaoTab.tsx`), que o V2 literalmente embute via `ConciliacaoImportModal.tsx`.
   Só a camada de análise é V2-only; dado e motor de import são 100% compartilhados.
5. **Analytics de assinatura/MRR com churn** — status ativo/em risco/atrasado/cancelado por
   cliente ou projeto, novos×churn, retenção. Mais sofisticado que o MRR genérico do clássico
   (que trata toda recorrência igual, sem conceito de ciclo de vida de cliente).
6. **"Super Consultor"** — insight de uma linha por regra determinística + nudge opcional de IA
   por aba. Sem camada narrativa equivalente no clássico.
7. **"Disponível pra retirar"** — saldo banco+caixa menos compromissos de 15 dias menos imposto
   menos colchão configurável (`business.financial.cushionAmount`).
8. **Saldo de conta bancária como livro-razão vivo** — `BaixaDialog`/`ConciliacaoBaldesCard`
   incrementam `bankAccounts.balance` atomicamente ao liquidar/casar um lançamento (comentário no
   próprio código: "é o primeiro fluxo do módulo que faz isso — o clássico `handleMarkAsPaid`
   nunca tocava saldo"). Confirmado: no clássico, `balance` é só um número editado manualmente.
9. FAB global "Lançar" em qualquer aba; seletor de período compartilhado entre abas
   (`PeriodContext`), vs. seletores inconsistentes por aba no clássico.
10. `assertTransitionTransaction` (FSM) chamado client-side no único write path que muda status
    (`BaixaDialog`) — hoje majoritariamente cosmético, já que `firestore.rules` (M03.4, mesma
    sessão) passou a aplicar transição válida no servidor pros dois lados igualmente.

## 4. Capacidades que os dois têm (mesmo dado, apresentação diferente)

| Capacidade | Clássico | V2 | Nota |
|---|---|---|---|
| Conciliação bancária (OFX/CSV, tolerâncias, regras) | `ConciliacaoTab.tsx`, aba própria | `BancarioTab.tsx` embute o `ConciliacaoTabClassic` direto dentro de `ConciliacaoImportModal.tsx` | Mesmo componente + mesmo motor `lib/services/reconciliation.ts` + mesmas coleções. Não é fork. |
| Log de auditoria financeira | Aba "Auditoria" dedicada, últimos 100 | Embutido no fim da aba "Relatórios" | Ambos leem `financialAuditLog`, mesmo `logAudit()`, mesmo limite de 100. Só a posição na UI difere. |
| Projeção de fluxo de caixa | Diária 30/60/90d + 13 semanas na aba Transações | `CashTimeline` na Visão Geral (30 dias) + regime caixa do DRE | V2 é mais narrativo; clássico tem toggle de cenário que o V2 não tem. Nenhum é superset do outro. |
| Métrica estilo MRR | `RecurringContent`: MRR/burn/ARR/runway genérico sobre toda recorrência | `AssinaturasMrrCard` restrito a assinatura/membership | Escopo diferente, não comparável diretamente. |

## 5. Risco de incompatibilidade de dado

- **Semântica de `bankAccounts.balance` diverge de verdade.** Clássico trata como número
  mantido manualmente (nunca ajustado por pagamento). V2 trata como livro-razão vivo,
  incrementando a cada baixa/match. Um tenant que veio do clássico (balance = o que um humano
  digitou por último) e passa a usar a baixa do V2 começa a compor incrementos reais em cima de
  um número nunca rigorosamente ligado ao histórico — risco real de saldo divergente, pra
  qualquer lado dependendo da ordem de adoção. **É o risco mais concreto encontrado** — "não dá
  pra só trocar a flag" sem lidar com isso primeiro.
- **Parcelamento/recorrência rica é via de mão única.** Lançamentos criados com
  `installmentGroupId`/`installmentNumber`/campos ricos de recorrência via clássico aparecem bem
  como linhas genéricas nos read-models do V2 (todos chaveiam por `dueDate`/`status`/`amount`),
  mas o V2 não consegue criar, editar nem gerenciar nenhum desses campos — uso misto não é
  inseguro, só assimétrico (clássico opera 100% sobre dado do V2; V2 não opera 100% sobre dado do
  clássico).
- `CashSession`/`cashSessions` é aditivo — coleção nova, sem colisão com o que o clássico grava,
  além da interação de incremento de saldo já citada (fechamento/sangria também incrementam
  `bankAccounts.balance`).
- Os dois já compartilham o contrato FSM (`lib/contracts/fsm/transaction.ts`) e, desde o
  `firestore.rules` de hoje (M03.4), a validação de transição de status no servidor vale pros
  dois igualmente — sem divergência aí.

## 6. Status do rollout de `financialV2Enabled`

- `Business.settings.financialV2Enabled?: boolean` (`lib/types/index.ts:480`), comentário:
  "Default false: nenhum tenant existente muda de tela sem opt-in explícito."
- `app/app/page.tsx:105-128`: quando `false` (padrão pra todo tenant, novo ou antigo — nenhum
  script de seed liga), renderiza o clássico + banner dispensável "Novo Financeiro (beta) —
  Experimentar". Quando `true`, renderiza só o V2, com link "← Voltar ao clássico" no cabeçalho
  que desliga a flag de novo.
- Alternar é um `updateDoc` simples no documento do negócio — qualquer usuário que alcance a UI
  consegue ligar/desligar (sem gate de role encontrado no próprio toggle).
- É de fato um beta opt-in hoje, não um default silencioso.

## 7. Leitura geral (fato, não recomendação)

Não é "V2 é um superset faltando 1-2 gaps" (a formulação original do plano). É mais nuançado, e
numa dimensão específica, invertido:

- **V2 está à frente em inteligência financeira somente-leitura**: DRE com regime contábil,
  ciclo de vida de caixa físico, analytics de assinatura com churn, drill de conciliação mais
  rico, camada de insight narrativo — relatórios genuinamente mais sofisticados que o clássico.
- **V2 está atrás em capacidade operacional de escrita** de um jeito mais fundamental que "faltam
  Projetos e multi-moeda" (os 2 gaps já nomeados no plano original). Hoje o V2 não edita nem
  cancela lançamento, não cria parcelamento, não configura recorrência além de "repete mensal",
  não pausa/retoma/pula/ajusta série recorrente, não gerencia comissão, não anexa comprovante, e
  não cria/edita conta bancária (o que ironicamente bloqueia sua própria feature de caixa físico,
  já que ela exige uma conta tipo `caixa` que só o clássico cria). Os únicos writes do V2 em
  `transactions` são um "lançar rápido" e um "marcar pago".
- Na prática: um negócio operando só com V2 hoje veria dashboards ricos mas precisaria voltar pro
  clássico (ou pros caminhos de API/agente) pra quase toda entrada e correção de dado do dia a
  dia. Fechar essa lacuna é um esforço bem maior que portar `ProjetosTab`/multi-moeda — é a
  maior parte da UI de escrita do clássico precisando ser reconstruída ou portada pro V2 antes de
  ele se sustentar sozinho.
- O motor de conciliação, o log de auditoria e a camada de FSM/enforcement já são genuinamente
  compartilhados/consistentes entre os dois — esses não são bloqueadores de decisão em nenhum dos
  sentidos.

## 8. Próximo passo

Decisão apresentada ao usuário com estes fatos (não decidida aqui). Ver atualização em
`docs/paridade/M03_PLANO_IMPLEMENTACAO.md` §1 e §"M03.6".
