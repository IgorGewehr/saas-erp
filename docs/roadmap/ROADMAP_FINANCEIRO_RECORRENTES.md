# Roadmap — Módulo Financeiro: Recorrentes

> Baseado em análise competitiva (Conta Azul, Nibo, Omie, Bling, Asaas, QuickBooks Online, Xero, FreshBooks) e auditoria do código atual.
> **Última atualização:** 2026-04-28

---

## ✅ Implementáveis apenas no código (sem dependências externas)

Ordenados por impacto × esforço.

---

### 🔴 Crítico — quebra o workflow atual

- [ ] **[FIN-R01] Avançar `nextDueDate` automaticamente ao quitar**
  - **Problema:** Ao marcar uma recorrência como paga ("Quitar"), o `nextDueDate` não avança. O usuário precisa editar manualmente a data da próxima ocorrência toda vez.
  - **Solução:** No handler `onMarkPaid`, após atualizar `status: 'pago'`, calcular a próxima data com `computeNextDueDate(tx.recurrence.nextDueDate, frequency, dayOfMonth)` e salvar em `recurrence.nextDueDate`. Se `endDate` foi atingido, setar `recurrence.isActive: false`.
  - **Arquivos:** `FinancialModule.tsx` — handler de quitar recorrência (~linha 693)

- [ ] **[FIN-R02] Botão "Retomar" para recorrências pausadas**
  - **Problema:** Existe "Pausar" mas não existe "Retomar". Usuário fica preso após pausar.
  - **Solução:** Na lista de Recorrentes, quando `recurrence.isActive === false`, trocar o botão de pausa por um botão "Retomar" que seta `recurrence.isActive: true`.
  - **Arquivos:** `FinancialModule.tsx` — `RecurringRow` component e handler de pause (~linha 683)

---

### 🟠 Alta prioridade — impacto direto no dia a dia

- [ ] **[FIN-R03] Pular uma ocorrência ("Skip")**
  - **Descrição:** Ação "Pular este vencimento" que avança o `nextDueDate` para a próxima data sem criar nenhum lançamento pago. Caso de uso: fornecedor dispensou um mês de pagamento.
  - **Solução:** Novo botão na linha da recorrência que chama `computeNextDueDate()` e faz `updateDoc` apenas no `recurrence.nextDueDate`, sem alterar `status`.
  - **Arquivos:** `FinancialModule.tsx` — `RecurringRow` + novo handler

- [ ] **[FIN-R04] Opções ao excluir uma série recorrente**
  - **Descrição:** Ao tentar encerrar/excluir uma série, perguntar ao usuário:
    - "Excluir série e cancelar todos os lançamentos pendentes"
    - "Excluir série e manter os lançamentos pendentes" (para de gerar novas ocorrências, mantém o que já existe)
  - **Referência:** Nibo implementa exatamente este padrão.
  - **Arquivos:** `FinancialModule.tsx` — adicionar modal de confirmação ao pausar/excluir série

- [ ] **[FIN-R05] Frequência Semestral + opção "Sem data de encerramento"**
  - **Descrição:** Adicionar `'semiannual'` (a cada 6 meses) às opções de frequência. Garantir que o campo "Encerrar em" pode ficar vazio para recorrências indefinidas (já parcialmente suportado, mas sem UI clara).
  - **Arquivos:** `lib/types/index.ts` — `RecurrenceFrequency`, `FinancialModule.tsx` — select de frequência + `computeNextDueDate()`

- [ ] **[FIN-R06] Badge de status por proximidade de vencimento**
  - **Descrição:** Colorir o indicador de data da recorrência na lista conforme urgência:
    - 🔴 Vermelho: vencido ou vence em < 3 dias
    - 🟡 Âmbar: vence em 3–7 dias
    - 🟢 Verde: vence em > 7 dias
    - ⏸️ Cinza: pausado
  - **Arquivos:** `FinancialModule.tsx` — `RecurringRow` component (já existe o badge "em Xd", apenas refinar as cores)

---

### 🟡 Média prioridade — diferencial competitivo

- [ ] **[FIN-R07] Edição com escopo — "Apenas este / Este e seguintes / Todos"**
  - **Descrição:** Ao salvar uma edição em um lançamento que pertence a uma série recorrente, apresentar um diálogo:
    > "Este lançamento faz parte de uma série recorrente. O que deseja alterar?"
    > ○ Apenas este lançamento
    > ○ Este e todos os seguintes
    > ○ Todos os lançamentos da série
  - **Referência:** Google Agenda, Omie (parcial). Nenhum ERP brasileiro implementa isso completamente. É o maior diferencial possível.
  - **Complexidade:** Alta — requer `recurringSeriesId` para agrupar ocorrências, lógica de propagação no save.
  - **Pré-requisito:** Adicionar campo `recurringSeriesId: string` em `Transaction` (lib/types) e popular no momento de criação.
  - **Arquivos:** `lib/types/index.ts`, `FinancialModule.tsx` — `handleSaveTransaction` + novo `ScopeDialog`

- [ ] **[FIN-R08] Prévia das próximas datas ao configurar recorrência**
  - **Descrição:** Ao ativar o toggle de recorrência no modal de criação/edição, mostrar embaixo as próximas 5 datas que serão geradas:
    > `Próximas ocorrências: 05/10 · 05/11 · 05/12 · 05/01 · 05/02`
  - **Referência:** Conta Azul (painel de prévia), Omie (botão "Simular").
  - **Arquivos:** `FinancialModule.tsx` — seção de recorrência no formulário, usar `computeNextDueDate()` em loop

- [ ] **[FIN-R09] Reajuste de valor em lote para uma série**
  - **Descrição:** Botão "Reajustar valor" na linha da recorrência que permite alterar o valor por percentual (ex: +5% IPCA) ou valor fixo, com data de início do reajuste. O sistema atualiza `amount` na transação recorrente a partir da data escolhida.
  - **Referência:** Nibo — único ERP brasileiro com esta funcionalidade.
  - **Arquivos:** `FinancialModule.tsx` — novo modal `ReajusteDialog` + handler de update

- [ ] **[FIN-R10] Indicador de série no modal de edição**
  - **Descrição:** Quando o usuário abre uma transação que pertence a uma série recorrente, mostrar um banner no topo do modal:
    > 🔄 Este lançamento faz parte de uma série recorrente **Mensal**
  - Clicar no banner navega para a aba Recorrentes filtrando por essa série.
  - **Arquivos:** `FinancialModule.tsx` — `TransactionModal` / `handleSaveTransaction`

- [ ] **[FIN-R11] Histórico de ocorrências pagas por série**
  - **Descrição:** Ao clicar no nome de uma recorrência, abrir um painel lateral ou expandir a linha mostrando todas as ocorrências já pagas com data e valor. Requer `recurringSeriesId` para agrupar via query.
  - **Pré-requisito:** [FIN-R07] (campo `recurringSeriesId`)
  - **Arquivos:** `FinancialModule.tsx` — novo `RecurringHistoryPanel`

- [ ] **[FIN-R12] Card "Próximos vencimentos recorrentes" na Visão Geral**
  - **Descrição:** Na aba Visão Geral do Financeiro, adicionar um card mostrando os recorrentes que vencem nos próximos 7 dias, com botão de quitar inline.
  - **Arquivos:** `FinancialModule.tsx` — seção de Visão Geral (já existe lógica de urgentes, expandir)

---

### 🔵 Avançado — para depois dos itens acima

- [ ] **[FIN-R13] Recorrentes alimentando o Fluxo de Caixa como "previsto"**
  - **Descrição:** As ocorrências futuras (baseadas em `nextDueDate`) devem aparecer como valores "previstos" no gráfico de Fluxo de Caixa, não apenas os lançamentos já criados. Isso torna a projeção de caixa real e automática.
  - **Referência:** Conta Azul — principal diferencial do módulo financeiro deles.
  - **Complexidade:** Alta — requer mudança na lógica de agregação do Fluxo de Caixa para incluir projeções de recorrências ativas.
  - **Arquivos:** `FinancialModule.tsx` — tab Fluxo de Caixa, lógica de projeção

- [ ] **[FIN-R14] Calendário de vencimentos dos recorrentes**
  - **Descrição:** Visão alternativa (toggle lista/calendário) na aba Recorrentes mostrando um calendário mensal com as ocorrências marcadas como bolinhas coloridas por categoria e urgência.
  - **Referência:** Nibo — melhor implementação de calendário de vencimentos no mercado BR.
  - **Complexidade:** Alta — novo componente de calendário ou adaptar o já existente na Agenda.
  - **Arquivos:** `FinancialModule.tsx` — nova view `RecurringCalendarView`

- [ ] **[FIN-R15] Opção "Quinzenal com dias fixos" (ex: dia 1 e dia 15)**
  - **Descrição:** Frequência especial que gera duas ocorrências por mês em dias fixos configuráveis. Caso de uso: boletos que vencem no dia 1 e 15.
  - **Referência:** Bling — única plataforma BR com esta opção.
  - **Arquivos:** `lib/types/index.ts`, `FinancialModule.tsx` — `computeNextDueDate()`

---

## ⛔ Dependências externas — implementar depois

Estes itens requerem integrações com serviços externos ou infraestrutura adicional.

- [ ] **[FIN-R16] Régua de cobrança via WhatsApp/Email para recorrentes de receita**
  - **Descrição:** Notificações automáticas para clientes: 3 dias antes do vencimento, no dia do vencimento, e após vencer. Multi-canal: WhatsApp, email.
  - **Referência:** Asaas — melhor implementação do mercado (completamente configurável por canal e timing).
  - **Dependência:** Canal WhatsApp ativo via Meta API (Embedded Signup em Configurações → Canais). Integração com módulo Conversas/Broadcasts já existente.
  - **O que falta:** Trigger automático por data (cron job ou Cloud Function) que dispara broadcasts baseados em `recurrence.nextDueDate`.

- [ ] **[FIN-R17] Geração automática de ocorrências via Cloud Function**
  - **Descrição:** Cloud Function agendada (cron diário) que verifica todas as transações recorrentes com `nextDueDate <= hoje` e gera automaticamente a próxima ocorrência no Firestore, sem ação do usuário.
  - **Dependência:** Firebase Cloud Functions (não configurado no projeto ainda). Alternativa mais simples: geração client-side ao carregar o módulo (verificar e criar ocorrências vencidas).
  - **Nota:** A alternativa client-side pode ser implementada em código, mas tem limitações (só funciona quando algum usuário abre o módulo).

- [ ] **[FIN-R18] Integração com gateway de pagamento para cobrança automática**
  - **Descrição:** Para recorrentes de receita, integrar com Asaas/Stripe para débito automático no cartão ou Pix do cliente sem ação manual.
  - **Dependência:** Conta ativa no gateway (Asaas ou Stripe) + configuração Enterprise.

---

## Ordem de implementação sugerida

```
Sprint 1 (baixo esforço, alto impacto crítico):
  FIN-R01 → FIN-R02 → FIN-R03 → FIN-R05 → FIN-R06

Sprint 2 (média complexidade, alto valor):
  FIN-R04 → FIN-R08 → FIN-R10 → FIN-R12

Sprint 3 (alta complexidade, diferencial):
  FIN-R07 → FIN-R09 → FIN-R11

Sprint 4 (avançado):
  FIN-R13 → FIN-R14 → FIN-R15

Depois (dependências externas):
  FIN-R16 → FIN-R17 → FIN-R18
```
