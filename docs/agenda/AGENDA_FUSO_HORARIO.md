# Agenda — fuso horário por negócio — M06.5b

> Concluído em código em: 04/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: item do checklist M06.5 (`docs/paridade/M06_PLANO_IMPLEMENTACAO.md`): "Fuso horário
> por negócio, substituindo o `-03:00` fixo."

## 1. O que foi entregue — e um bug real encontrado no caminho

Ao investigar "substituir o `-03:00` fixo", a varredura encontrou não um, mas **dois** lugares
tratando fuso de forma diferente — e um deles pior do que o outro:

1. `lib/services/appointmentReminderRunner.ts` (lembrete in-app) já tinha um offset **explícito**
   `-03:00` hardcoded (`BR_OFFSET`) — funcionalmente correto pro Brasil (que não tem horário de
   verão desde 2019), só não generalizava pra outros fusos.
2. `app/api/agent/scheduled/run/route.ts` (lembrete/confirmação por WhatsApp) fazia
   `new Date(\`${appt.date}T${appt.startTime}:00\`)` **sem nenhum offset**. Pela especificação
   ECMA-262, uma string de data-hora sem offset é interpretada no fuso LOCAL DO PROCESSO — não
   em Brasília. O `Dockerfile` deste projeto (`node:20-bookworm-slim`, sem `TZ` configurado) roda
   com fuso padrão UTC. Ou seja: **esse arquivo não estava "hardcoded pra Brasil" — estava
   deslocando a janela de lembrete/confirmação em ~3 horas pra QUALQUER negócio**, não só os de
   fuso diferente. Achado durante esta fatia, não reportado antes; confirmado via inspeção do
   Dockerfile (sem acesso ao container rodando pra confirmar 100% contra produção).

Este achado muda o enquadramento da fatia: não é só "generalizar pra outros fusos", é também
**corrigir um bug de deslocamento de horário já em produção** no caminho mais crítico (WhatsApp).

## 2. O que foi entregue

- `lib/utils/timezone.ts` (novo) — `zonedDateTimeToUtc(date, time, timezone): Date`, único
  utilitário do repo que resolve "data+hora de parede + fuso → instante UTC correto" usando
  `date-fns-tz` (`fromZonedTime`) e o banco de fusos IANA de verdade — não um offset fixo. Prova
  de que não é hardcoded pra Brasil: testado também contra `America/New_York` (com/sem horário
  de verão) e `Asia/Tokyo`.
- `lib/services/appointmentReminderRunner.ts` — troca o offset fixo `-03:00` por
  `business.settings.timezone` (default `America/Sao_Paulo` quando ausente — comportamento
  idêntico ao de antes pra quem nunca configurou nada). Como a busca é cross-tenant (1 query
  pro SaaS inteiro, por design), os negócios distintos do lote são resolvidos em lote
  (`fetchTimezonesByBusiness`) em vez de uma leitura por agendamento.
- `app/api/agent/scheduled/run/route.ts` — mesma troca, mas mais simples: essa função já roda
  por negócio (`processBusiness`), então `business.settings?.timezone` já estava em escopo, só
  não era lido. Corrige tanto o lembrete quanto a janela de confirmação (24-26h) e o follow-up
  pós-atendimento.
- Nova dependência: `date-fns-tz@^3.2.0` — mesma família/mantenedores do `date-fns@^4` já
  instalado, zero dependências próprias, só usado pra essa conversão.

## 3. Por que uma biblioteca em vez de calcular na mão

Não existia no repo nenhum utilitário resolvendo essa direção (wall-clock + fuso → instante).
O que já existia (`todayInTz`/`currentHourInTz` em `birthdayCampaignRunner.ts`/
`membershipBillingRunner.ts`, `todayBR` no próprio arquivo de lembretes) resolve só a direção
OPOSTA (instante → wall-clock), cada um duplicado à mão nesses três arquivos — não foram
tocados/unificados aqui, fora do escopo desta fatia (que é sobre lembretes de agendamento
especificamente, não uma faxina geral de utilitários de fuso). Calcular a direção que faltava
(wall-clock → instante) à mão exigiria reimplementar consulta ao banco de fusos IANA
(incluindo regras de horário de verão por país) — exatamente o tipo de lógica que uma
biblioteca madura acerta e um cálculo manual arrisca errar sutilmente. `date-fns-tz` tem zero
dependências próprias e mesma procedência do `date-fns` já usado no projeto.

## 4. Resiliência — fuso inválido não derruba o cron

`business.settings.timezone` é um campo de texto livre, sem validação em lugar nenhum hoje —
um negócio poderia ter um valor inválido. `zonedDateTimeToUtc` lança nesse caso (não mascara
silenciosamente); os dois call sites capturam esse erro POR ITEM (por agendamento em
`appointmentReminderRunner.ts`, por negócio em `scheduled/run/route.ts`) e pulam só aquele item,
sem derrubar o resto do lote — mesmo racional de resiliência que o resto desses arquivos já
usa pra falhas de envio.

Detalhe técnico encontrado durante os testes: `date-fns-tz`/`Intl` **lança** em Node.js real
pra um fuso IANA inválido, mas em `jsdom` (ambiente dos testes) devolve um `Invalid Date`
silencioso em vez de lançar. `zonedDateTimeToUtc` normaliza os dois comportamentos (sempre
lança), checando explicitamente `Number.isNaN(result.getTime())` além do try/catch — sem isso,
o comportamento da função dependeria de uma particularidade do ambiente de execução.

## 5. O que ficou de fora (deliberado)

- **Consolidar `todayInTz`/`currentHourInTz`/`todayBR`** (3 cópias quase idênticas em arquivos
  diferentes) num único utilitário — refatoração de arquivos que já funcionam corretamente,
  sem necessidade funcional para esta fatia; risco desproporcional ao pedido.
- **UI em Settings pra configurar `business.settings.timezone`** — o campo já existe e já é lido
  em 4 lugares reais (horário de funcionamento, aceite de pedidos, campanha de aniversário,
  cobrança de assinatura); não existe UI pra defini-lo em nenhum desses casos hoje, e não é
  criada aqui — fora do escopo específico de lembretes de agendamento.
- **Corrigir a propagação de fuso pro contexto do Agente IA** — achado colateral (não
  perseguido a fundo): `agentTz` é resolvido em 4 lugares (`lib/agent/dispatch.ts` e outros) mas
  nunca é incluído no payload enviado ao serviço Python, que sempre cai no fallback
  `America/Sao_Paulo` (`agent/app/graph/prompts.py:263`) independente do que o negócio configurou.
  Bug real, mas em uma superfície diferente (contexto do LLM, não lembretes/confirmação) — fica
  documentado aqui como achado, não corrigido nesta fatia.
- **Ampliar a janela da query cross-tenant** de `appointmentReminderRunner.ts` (hoje ainda
  ancorada em "hoje/amanhã no fuso BR" via `todayBR`) — o range de 2 dias já tem folga
  suficiente pra qualquer diferença de fuso realista entre negócios; não há evidência de que
  isso quebre algo hoje (todos os tenants atuais são brasileiros).

## 6. Verificação

Verificado por `tsc --noEmit` limpo e suíte completa (968 testes em 73 arquivos — 958/71 da
fatia anterior mais 10 novos casos em 2 arquivos novos, sem regressão). Cobertura nova inclui um
teste específico com fuso `Asia/Tokyo` provando que a correção funciona de verdade pra qualquer
fuso, não só Brasil, e um teste de resiliência (fuso inválido num negócio não impede lembretes
de outros negócios no mesmo lote). **Não verificado contra o cron real em produção** nesta
rodada (sem acesso ao container rodando) — o achado do deslocamento de ~3h em
`scheduled/run/route.ts` foi confirmado por leitura de código + inspeção do `Dockerfile`, não
por observação direta do comportamento ao vivo.

## 7. Evidências automatizadas

- `tests/utils/timezone.test.ts` (novo, 5 casos): conversão Brasília, default
  `America/Sao_Paulo`, respeita horário de verão (New York inverno/verão), funciona pra fuso
  não-brasileiro (Tóquio), lança em fuso inválido.
- `tests/services/appointmentReminderRunner.test.ts` (novo, 5 casos — primeira suíte de testes
  deste arquivo, que não tinha nenhuma antes): sem fuso configurado usa o default; com fuso
  diferente (Tóquio) calcula a janela certa; fuso inválido num negócio não derruba os demais;
  ignora fora de janela; ignora status finalizado/cancelado.
- Suíte completa: 968 testes em 73 arquivos aprovados. `tsc --noEmit` limpo.
