# Agenda — testes, homologação e aceite (M06.9)

> Concluído/analisado em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: último item do checklist do M06 inteiro (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`).
> 5 sub-itens: (1) teste concorrente entre canais, (2) teste de multi-profissional em 2ª posição,
> (3) teste de reconciliação após falha, (4) teste de isolamento multi-tenant, (5) smoke manual
> do fluxo completo da clínica. Antes de escrever qualquer teste novo, investiguei o que já
> existia — 2 dos 4 itens automatizáveis já estavam cobertos, evitando trabalho duplicado.

## 1. Levantamento do que já existia

- **Item 2 (multi-profissional, 2ª posição)**: já coberto, por canal isolado, em
  `tests/services/appointmentConflicts.test.ts` e `tests/services/appointmentTxGuard.test.ts`
  (`'M06.1: professionalIds[] múltiplo conflita se QUALQUER um dos profissionais já está
  ocupado'`) — cenário exato: `professionalIds: ['p1','p2']`, `p2` (2ª posição) já ocupado,
  conflito detectado. **Considerado satisfeito** dentro de um único canal; o que faltava era a
  versão CROSS-canal (ver §2).
- **Item 4 (isolamento multi-tenant)**: já coberto em
  `tests/contracts/appointmentCompletionHandlers.test.ts` e `appointmentNoShowHandler.test.ts` —
  cada handler de efeito (`appointment.completed`/`.canceled`/`.noShow`) tem teste dedicado pra
  "evento com `businessId` que não bate o do appointment real → no-op, nenhum write". Como os
  três handlers buscam o appointment por ID e comparam `businessId` explicitamente (não fazem
  query cross-tenant), esse é o teste correto e suficiente pra essa garantia. **Considerado
  satisfeito**, sem trabalho novo.

## 2. Item 1 — teste concorrente entre canais (novo)

Sem emulador real do Firestore, simular uma corrida de baixo nível (duas transações
*literalmente* sobrepostas no tempo) testaria o motor de retry do PRÓPRIO Firestore — garantia
documentada dele, não nossa. O jeito fiel de testar o que É nosso é modelar o **resultado** de
uma corrida já resolvida: um canal commita primeiro contra um backing store compartilhado; o
outro lê o estado fresco (pós-commit — exatamente como aconteceria após uma reexecução real de
transação) e precisa detectar o conflito corretamente. Essa é a garantia que os dois guards
existem pra dar, não importa qual canal chegou primeiro.

Novo arquivo `tests/services/appointmentCrossChannelConcurrency.test.ts` — combina o mock do
client SDK (`createAppointmentSafe`, usado por Agenda/CRM/PDV) e um fake do Admin SDK
(`createAppointmentSafeAdmin`, usado por API v1 e pelo agente desde M06.7) sobre o MESMO array
compartilhado em memória. 4 casos:

1. Canal manual reserva primeiro → canal do agente detecta e recusa.
2. Canal do agente reserva primeiro → canal manual detecta e recusa (prova a simetria — não
   importa qual dos dois "ganha" a corrida, o guard funciona nos dois sentidos).
3. **Cross-canal + multi-profissional**: agente reserva profissional `p2` (2ª posição de um
   atendimento hipotético); canal manual tenta `professionalIds:['p1','p2']` no mesmo horário →
   conflita. Fecha a versão mais forte do item 2 (dois canais DIFERENTES, não só dois clientes do
   mesmo canal).
4. Controle negativo: profissionais DIFERENTES em canais diferentes não conflitam entre si.

## 3. Item 3 — investigado, não é uma lacuna real (decisão registrada)

Investiguei `scripts/reconcile-appointment-completions.ts` (o sweep que redispara
`appointment.completed` pra atendimentos `concluido` sem `completionAppliedAt`) esperando
encontrar um teste faltando. Achado que mudou a conclusão: **o mecanismo de recuperação em si já
é testado a fundo** — `tests/contracts/appointmentCompletionHandlers.test.ts` cobre exatamente
"replay do evento é idempotente" e "aplica efeitos quando `completionAppliedAt` está ausente",
que é a substância real de "reconciliação recupera". O que sobra no script (paginação por
`businessId` + filtro `status==='concluido' && !completionAppliedAt` + loop de
`--apply`/`process.exit`) é infraestrutura de CLI, não regra de negócio nova.

Confirmei isso não é uma lacuna desta sessão comparando com o precedente já estabelecido no
próprio repositório: `scripts/audit-m06-agenda.ts` (M06.0, mesmo formato de script `tsx` com
`main().catch(process.exit(1))`) tem a MESMA paginação Firestore, e **também não é testada
diretamente** — só a lógica pura extraída pra `lib/services/m06-agenda-audit.ts`
(`buildM06AgendaSnapshot`/`compareM06AgendaSnapshots`) tem suíte própria. A convenção já em uso
neste projeto é: lógica de paginação/CLI de script fica sem teste unitário; regra de negócio
extraível vai pra `lib/services/` e é testada lá. `reconcile-appointment-completions.ts` não tem
uma regra de negócio substancial pra extrair além de um predicado de uma linha
(`status==='concluido' && !completionAppliedAt`) — forçar uma extração só pra preencher um
checkbox seria escrever infraestrutura de teste sem valor real, o mesmo tipo de decisão que essa
sessão já evitou repetidamente (rotas sem teste próprio em `scheduled/run/route.ts`,
`fiscal/emit/route.ts`, etc.).

**Não corrigido, não é regressão**: nenhuma mudança de código nesta fatia.

## 4. Item 5 — smoke manual (não executado, checklist para o usuário)

Não executado nesta rodada — não há navegador/dev server disponível nesta sessão, mesma ressalva
de honestidade repetida em toda fatia de UI deste plano. Checklist recomendado antes de declarar
a odontologia pronta pra operar com confiança total no fluxo automatizado:

1. Agendar um atendimento (recepção/manual).
2. Confirmar que o lembrete/pedido de confirmação por WhatsApp sai no horário esperado
   (fuso do negócio, M06.5b).
3. Responder "confirmo" pelo número vinculado → status muda pra `confirmado`
   automaticamente (M06.5a).
4. Atender e marcar `concluido` → conferir botões "Cobrar"/"Enviar ficha"/"Emitir NFSe"
   aparecendo corretamente, e que comissão/fidelidade/baixa de insumo foram aplicados
   (uma vez só).
5. Cobrar (lançar transação) e emitir NFS-e — conferir que o badge fiscal reflete o status
   real (ao vivo, M06.6) e que o vínculo cobrança↔atendimento persiste.
6. Repetir o passo 1 pedindo o MESMO horário pelo chat do agente (web ou WhatsApp) — deve
   recusar citando o conflito com o atendimento já criado manualmente (prova viva do M06.7:
   os dois canais agora disputam o mesmo horário de verdade, não só em teste).

## 5. Verificação

`tsc --noEmit` limpo. Suíte completa: **980 testes em 75 arquivos** (976→980, +4 testes novos em
1 arquivo novo — `appointmentCrossChannelConcurrency.test.ts`), sem regressão.

## 6. Estado do M06 ao final desta fatia

Com M06.9 concluído (4 dos 5 sub-itens automatizáveis fechados; o 5º é smoke manual, fora do
alcance desta sessão), **o checklist inteiro do plano M06 está fechado em código**. Itens
deliberadamente adiados/sinalizados ao longo do plano continuam pendentes de decisão ou execução
futura (não fazem parte do "fechado"): visibilidade por profissional (M06.8, decisão de produto
do usuário), extração de `AgendaModule.tsx` e paginação de clientes (M06.8, adiadas por falta de
navegador pra validar), memberships/assinaturas ligadas à Agenda de recepção e consolidação
cobrança↔fiscal (M06.6, feature nova maior/gap de conveniência), e — o mais importante pra
prioridade de negócio — o achado fiscal sinalizado em `AGENDA_M06_6_COBRANCA_FISCAL.md`
(documentos fiscais pendentes sem vínculo de origem, risco de NFSe duplicada). Ver `docs/paridade/M06_PLANO_IMPLEMENTACAO.md` §6-§8 para os critérios formais de conclusão do módulo.
