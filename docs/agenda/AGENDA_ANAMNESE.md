# Agenda — ficha do paciente e anamnese — M06.4a

> Concluído em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: `Service.formTemplateId` era um campo morto — declarado no tipo e no contrato Zod
> desde antes desta sessão ("Intake form auto-requested when this service is booked"), mas
> nenhuma UI permitia defini-lo. O resto do motor de formulários (`FormTemplate`/`FormField`/
> `FormResponse`, builder, página pública de preenchimento, rota de submissão) já existia
> pronto e funcional — só não tinha ponto de entrada nem estava ligado à Agenda.

## 1. O que foi entregue

Editor de serviço (`ServiceManagementDialog`, dentro de `AgendaModule.tsx`) ganhou um seletor
de ficha de anamnese — quando definido, a Agenda passa a oferecer "Enviar ficha" nos
atendimentos daquele serviço. Novo botão "Formulários" no toolbar da Agenda
(`FormTemplatesDialog.tsx`) dá acesso ao builder já existente sem depender do CRM.
`ViewAppointmentDialog` ganhou um botão "Enviar ficha" (badge "Ficha preenchida" quando já há
resposta registrada) que monta um link pré-preenchido e abre o WhatsApp do paciente. Histórico
do cliente (`ClientTimeline.tsx`) passou a listar fichas respondidas ao lado de conversas,
agendamentos, vendas e transações.

## 2. Por que reaproveitar `FormulariosTab` em vez de duplicar

O builder de formulários (`app/components/features/crm/FormulariosTab.tsx`) já era completo:
CRUD de templates, 8 tipos de campo, ativo/inativo, cópia de link público. O único problema era
estar acessível **só de dentro do CRM**, que é Enterprise-only (mesma trava do Kanban) — sem
Enterprise, a clínica não conseguia nem criar um template. Em vez de reescrever ou mover esse
componente, `FormTemplatesDialog.tsx` é um wrapper fino (`Dialog` MUI) em volta do mesmo
`FormulariosTab`, mesma coleção `formTemplates`, chamado a partir de um novo botão no toolbar
da Agenda. Isso é **aditivo**: a aba "Formulários" do CRM continua existindo intacta pra quem já
usa Enterprise; a Agenda ganhou um segundo caminho pro mesmo dado, sem gate de Enterprise, sem
gate de role além de autenticado (criar um template não é ação sensível a dinheiro ou à agenda
de outra pessoa, diferente do botão "Bloqueios" da M06.3a, que exige `manager+`).

Confirmado durante a investigação: `enterpriseOnly: true` no item do CRM (`Sidebar.tsx`) é só
um filtro de visibilidade da sidebar (`filterItems`) — nunca reforçado dentro de `CRMModule.tsx`
nem em `firestore.rules` para `formTemplates`/`formResponses`. Por isso "tirar formulários do
Enterprise" foi resolvido só adicionando um novo ponto de entrada, sem nenhuma mudança de
segurança ou de regra.

Achado bônus, não corrigido: `FormTemplate.serviceId` é o campo inverso de
`Service.formTemplateId` (relação um-para-um vs. muitos-para-um descrevendo a mesma coisa),
também morto, também nunca setado por nenhuma UI. Esta fatia usa só `Service.formTemplateId`
(o sentido que o próprio comentário do tipo já descrevia); `FormTemplate.serviceId` fica
vestigial — removê-lo é limpeza não relacionada.

## 3. Envio manual via `wa.me`, não automático

Decisão do usuário: o envio do link ao paciente é manual, via deep-link
`https://wa.me/{telefone}?text={mensagem}` — mesmo padrão de click-to-chat já usado em
`ClientDetailPanel.tsx`/`ChannelsTab.tsx`. A alternativa (envio automático) exigiria extrair a
lógica de disparo de dentro do cron de lembretes (`app/api/agent/scheduled/run/route.ts`,
946 linhas, assinatura HMAC, fallback conversa/Baileys) — risco desproporcional ao valor desta
fatia. Sem telefone cadastrado no atendimento, o botão cai para copiar o link (mesmo fallback
de `copyLink()` já existente em `FormulariosTab.tsx`) com um toast avisando, em vez de ficar
quebrado.

A página pública (`app/forms/[formId]/page.tsx`) já lia `clientId`/`clientName`/`appointmentId`
da URL antes desta fatia — construída esperando exatamente este link, nunca ligada a um
remetente. `POST /api/forms/submit` já aceitava e persistia `appointmentId` na resposta.

## 4. Idempotência visual do botão "Enviar ficha"

Igual ao padrão já usado para "Emitir NFSe" (badge quando `fiscalDocumentId` existe) e "Cobrar"
(badge quando `billingTransactionId`/`billingInstallmentGroupId` existe): uma query pontual em
`formResponses` (`where('businessId','==',...).where('appointmentId','==',appointment.id)`),
disparada só quando o dialog do atendimento abre — sem custo de listener por card — decide
badge ("Ficha preenchida") vs. botão. Não existe campo `formSentAt`: reenviar é só clicar de
novo, e a badge usa exclusivamente a submissão real como fonte de verdade. Novo índice composto
`formResponses [businessId, appointmentId]` sustenta essa busca com tenant-scoping (R1).

O botão fica visível quando o serviço do atendimento tem `formTemplateId` **e**
`appointment.status !== 'cancelado'` — diferente de NFSe/Cobrar, que só aparecem em
`concluido` (a ficha faz sentido pedir *antes* da consulta, não depois).

## 5. Histórico do cliente

`ClientTimeline.tsx` ganhou uma 5ª busca paralela (mesmo padrão de `safeQuery` das 4 já
existentes — conversations/appointments/sales/transactions): `formResponses` por
`businessId`+`clientId`, mapeada pro mesmo `TimelineEvent[]` unificado (`kind: 'form'`, ícone
`FileText`, cor violeta — mesma cor já usada pra "Fichas" em `LeadDetailPanel.tsx`). Subtítulo
mostra até 2 pares campo/resposta como `chave: valor`, mesma limitação já aceita no precedente
do CRM: `responses` é indexado por `field.id` (gerado, não o rótulo legível do campo) — resolver
pra rótulo exigiria buscar o template junto, fora do escopo desta fatia (a própria
`LeadDetailPanel.tsx` já convive com essa limitação hoje).

## 6. O que ficou de fora (deliberado)

- **Envio automático por WhatsApp** — manual via `wa.me`, decisão do usuário nesta fatia (§3).
- **Extrair/unificar a lógica de envio do cron de lembretes** — não tocado.
- **Múltiplas fichas por atendimento, ou fichas obrigatórias bloqueando o check-in** — só
  visibilidade e envio manual; nada impede concluir um atendimento sem ficha preenchida.
- **Remover o campo vestigial `FormTemplate.serviceId`** — limpeza não relacionada (§2).
- **Mover `FormulariosTab.tsx` de pasta ou removê-lo do CRM** — só um segundo ponto de entrada
  aditivo; a aba original continua intacta.
- **Campo `formSentAt`** pra rastrear quando o link foi enviado — a badge usa só submissão real
  como fonte de verdade (§4).
- **Resolver `field.id` para rótulo legível no histórico do cliente** — mesma limitação já
  aceita em `LeadDetailPanel.tsx` (§5).
- **Prontuário clínico estruturado** — isto continua sendo um formulário genérico
  (texto/número/data/seleção/arquivo), não um EHR; nenhuma validação clínica é feita.

## 7. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (912 testes em 68 arquivos, mesma
contagem da M06.3a — nenhum teste novo nesta fatia, consistente com o plano: é
majoritariamente UI e queries diretas, sem lógica pura nova que justifique um arquivo
dedicado). **Não testado manualmente num navegador** nesta rodada (sem sessão de dev server
ativa). Antes de considerar esta UI pronta pra uso real, rodar o smoke manual descrito no
plano: criar um serviço vinculando um formulário → agendar esse serviço → abrir o atendimento
→ conferir o botão "Enviar ficha" → clicar → conferir que abre o WhatsApp com o link certo (ou
copia se sem telefone) → preencher o formulário público → voltar no atendimento → conferir que
virou badge "Ficha preenchida" → conferir que a resposta aparece no histórico do cliente em
Clientes → Timeline → confirmar que o botão "Formulários" da Agenda funciona pra um negócio
**sem** Enterprise ligado (o ponto principal desta fatia).
