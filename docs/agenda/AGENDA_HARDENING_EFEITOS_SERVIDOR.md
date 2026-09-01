# Agenda — hardening dos efeitos de conclusão (go-live odontologia)

> Concluída em código em: 01/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: foco do projeto mudou pra vender o AEVO a dois comércios reais — uma odontologia (Agenda + NFS-e) e um restaurante de hotel (Cardápio/Pedidos, já coberto pela iniciativa M02). Esta fatia harden a Agenda antes do go-live da odontologia.

## 1. Resultado entregue

Os efeitos de "agendamento virou concluído" (métricas do cliente, comissão do profissional, fidelidade, baixa de insumo do serviço) e sua reversão ("saiu de concluído") — antes escritos direto do browser via Client SDK, duplicados em **seis pontos diferentes** de `AgendaModule.tsx` — agora têm fonte única server-side: os handlers `handleAppointmentCompleted`/`handleAppointmentCanceled` (`lib/contracts/_runtime/handlers/`), disparados via `POST /api/events/dispatch` (autenticado, já existente). Isso termina uma migração que já estava desenhada no próprio código como "piloto SDD Fase 4" (`appointment.completed` era um `DomainEvent` declarado desde antes, mas o handler era audit-only).

## 2. Vulnerabilidade fechada

O handler-piloto, se completado ingenuamente, teria confiado no `amount`/demais campos do **payload do evento** — que vem do client via `/api/events/dispatch`. Um evento forjado (`appointmentId` real, `amount` fabricado, ou até um appointment que nunca chegou a `concluido` de fato) teria criado comissão/fidelidade com valor errado. Os handlers agora **releem o Appointment real por `ctx.db`** antes de qualquer efeito: só agem se o doc confirmar `status === 'concluido'` (completed) e o `businessId` bater; usam `appointment.price`, nunca `event.amount`, pra calcular comissão/fidelidade. Testado em `tests/contracts/appointmentCompletionHandlers.test.ts` (`ignora evento forjado cujo appointment real NÃO está concluido`).

## 3. Bugs reais corrigidos pela consolidação

1. **Fidelidade não acumulava na mudança rápida de status.** `handleStatusChange` (botão de status no card do agendamento) chamava comissão e métricas, mas nunca `addLoyaltyPoints` — só os caminhos de criar/editar via diálogo acumulavam. Um atendimento concluído pelo fluxo mais comum (mudar status direto) não gerava fidelidade. Mesma classe de bug que a consolidação de Pedidos (M02.5d) achou no agente.
2. **O diálogo de edição bypassava a FSM.** `canTransitionAppointment` só existia em `handleStatusChange`; o `<select>` de status do formulário de edição gravava qualquer status escolhido sem checar transição — dava pra abrir um agendamento `agendado` e marcar `concluido` direto, pulando `confirmado`/`em_andamento`, exatamente o cenário que um comentário no código já dizia (erradamente) estar bloqueado. Corrigido: `handleSaveAppointment` agora chama `canTransitionAppointment` antes de salvar uma mudança de status pela edição.

## 4. O que mudou tecnicamente

- **`lib/contracts/domain/appointment.ts`** (+ `lib/types/index.ts`): novo campo `completionAppliedAt?: string` — CAS de idempotência dos efeitos de conclusão.
- **`lib/services/commission.ts`**: `maybeCreateCommissionAdmin`/`maybeCancelCommissionAdmin` (mirrors Admin SDK das versões client já existentes).
- **`lib/services/clientMetricsAdmin.ts`** (novo): `syncClientMetricsAdmin`, mirror Admin SDK da função privada `syncClientMetrics` que existia em `AgendaModule.tsx`.
- **`lib/services/serviceConsumption.ts`**: `consumeServiceComponentsAdmin` (novo). Achado durante a implementação: a versão existente `consumeServiceComponents` depende de `lib/services/stock-server-client.ts` (`'use client'`, usa `auth.currentUser` do browser) — **não funciona em contexto server**. A versão admin chama `applyStockOperationAdmin` direto, sem round-trip HTTP.
- **`lib/contracts/_runtime/handlers/appointmentCompleted.ts`**: sai do modo auditoria. Relê o appointment, valida `businessId`/`status==='concluido'`/`!completionAppliedAt`, seta o CAS, e roda (cada um com seu próprio try/catch) baixa de insumo, métricas, comissão e fidelidade.
- **`lib/contracts/_runtime/handlers/appointmentCanceled.ts`** (novo): reage a `appointment.canceled` (declarado desde antes, nunca emitido). Reverte comissão + métricas só se `completionAppliedAt` confirmar que os efeitos foram de fato aplicados; não reverte fidelidade/estoque (essas reversões nunca existiram no caminho anterior).
- **`AgendaModule.tsx`**: os seis pontos que geravam/revertiam efeito de conclusão (criar já concluído — inclusive série recorrente, editar pra concluído, mudar status rapidamente, excluir/cancelar agendamento — individual e em série) passam a chamar só `emitAppointmentCompletedEvent`/`emitAppointmentCanceledEvent` (aguardados, não fire-and-forget). Removidas as funções órfãs `syncClientMetrics` e os imports que só os efeitos inline usavam.

## 5. O que ficou de fora (deliberado)

- **`firestore.rules` de `appointments` não impõe FSM** — só valida campos não-vazios. O handler blinda o EFEITO financeiro (não cria comissão/fidelidade sem o doc real confirmar `concluido`), mas não impede a gravação direta do campo `status` fora da UI. Hardening de regras é iniciativa separada, maior escopo.
- **Correção de preço num agendamento já concluído** (editar só o valor, sem mudar status) continua um ajuste direto de `totalSpent` no client — não cria Transaction/loyaltyTransaction nova, não é a superfície de risco desta fatia.
- **`appointment.trialCompleted`** continua audit-only (funil de CRM/aquisição, fora do escopo de go-live).
- **GCal sync** continua disparado inline pelo client, fora do bus (baixo risco, não é efeito financeiro).
- Emissão de NFS-e ponta a ponta para Maximiliano de Almeida (RS) é validação separada.

## 6. Evidências automatizadas

- `tests/contracts/appointmentCompletionHandlers.test.ts` (8 casos): aplica métricas+comissão+fidelidade uma vez; replay idempotente; evento forjado com status real diferente de concluído é ignorado; evento de outro tenant é ignorado; sem taxa de comissão aplicável ainda aplica métricas+fidelidade; cancelamento reverte comissão+métricas; cancelamento é no-op sem `completionAppliedAt`; cancelamento ignora evento de outro tenant.
- `tests/contracts/m01-ui-smoke.test.ts`: novo caso pra Agenda — confere que a UI só dispara `/api/events/dispatch` (`emitAppointmentCompletedEvent`/`emitAppointmentCanceledEvent`) e não tem mais chamadas inline de comissão/fidelidade/métricas/baixa de insumo.
- Suíte completa: 811 testes em 58 arquivos aprovados. `tsc --noEmit` limpo.
