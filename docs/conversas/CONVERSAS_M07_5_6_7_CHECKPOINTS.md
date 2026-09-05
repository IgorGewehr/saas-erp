# Conversas — checkpoints de decisão de produto (M07.5/6/7)

> Concluído em: 05/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: 3 itens do plano M07 que a investigação de abertura sinalizou explicitamente como
> decisão de produto, não de engenharia — apresentados ao usuário via pergunta direta, não
> decididos sozinho.

## M07.5 — Código morto/legado

**`app/components/features/crm/OmnichannelInbox.tsx`** (939 linhas) — confirmado morto (zero
importadores/renderizadores em todo o repo, fato de grafo de código, não dependia de nada
operacional). Continha um `console.log('[AUDITORIA]...')` vazando PII de contato, sinalizado
como "ativo em produção" em `docs/audit/PRODUCTION_CHECKUP_2026-05-29.md` — essa afirmação estava
desatualizada (o componente já era inalcançável antes desta remoção). **Decisão do usuário:
remover agora.** Arquivo apagado. Docs de auditoria histórica (`PRODUCTION_CHECKUP_2026-05-29.md`,
`PLANO_LOTE_B_custo_firebase.md`) foram deixados intocados — são snapshots datados de um
diagnóstico passado, não documentação viva; a resolução fica registrada aqui.

**`app/api/webhooks/facebook/route.ts`** — duplica `handleFacebookEvent` de `meta/route.ts` com
dedup mais fraco (check-then-act, não `markWebhookSeen`) e menos features. Diferente do
componente acima, não dava pra confirmar só lendo código se ainda é o callback configurado no
Meta App Dashboard — checagem operacional que exige acesso ao painel do Meta, que esta sessão não
tem. **Decisão do usuário: vai verificar no Meta App Dashboard e avisa o resultado antes de
qualquer mudança.** Nenhum código tocado nesta rota nesta fatia — aguardando confirmação.

## M07.6 — Sequências de CRM (motor de execução)

`SequenciasTab.tsx` deixa montar um fluxo multi-etapa (`send_whatsapp`/`send_email`) e matricular
um contato, mas nenhum cron/serviço faz polling em `crmActivities`/`crmEnrollments` pra disparar
as mensagens agendadas — a feature anuncia automação mas não tem backend nenhum por trás; hoje só
agenda uma tarefa que um humano precisaria notar e agir manualmente. **Decisão do usuário: não
investir agora.** Motivo: uma clínica odontológica de atendimento 1:1 provavelmente não precisa
de drip campaign multi-etapa — lembrete de atendimento (Agenda) e mensagem de aniversário
(`birthdayCampaignRunner.ts`, com consentimento corrigido em M07.1) já cobrem as necessidades de
comunicação automatizada reais. Fica dormente até sinal real de demanda, mesmo tratamento do
PIX/Boleto/OCR/Open Banking no M03. Nenhum código construído ou alterado.

## M07.7 — Bounce de e-mail → opt-out automático

`app/api/webhooks/email-bounce/route.ts` aceitava `bounceType: 'unsubscribe'` no payload (o
provedor de e-mail sinalizando que o destinatário clicou "cancelar inscrição" no PRÓPRIO cliente
de e-mail, fora do link de descadastro do app) mas nunca gravava isso em `marketingOptOuts` —
diferente do caminho de palavra-chave do WhatsApp (`meta/route.ts`, opt-out automático desde
antes) e do link de descadastro (`app/api/unsubscribe/route.ts`). **Decisão do usuário: registrar
opt-out automaticamente**, por consistência com os outros dois canais.

**Implementado**: quando `bounceType === 'unsubscribe'`, grava um `MarketingOptOut` (`channel:
'email'`, `source: 'bounce'` — valor do enum que já existia no tipo desde antes, nunca usado;
`identifier` = e-mail em minúsculo; `broadcastId` denormalizado do `BroadcastMessage` de origem,
quando disponível) usando o mesmo formato de ID determinístico (`{businessId}_{channel}_
{identifier normalizado}`) já usado por `app/api/unsubscribe/route.ts` — reimplementado inline
(função local `buildOptOutDocId`, não exportada do outro arquivo) porque é a 3ª ocorrência da
mesma lógica de 3 linhas nesta sessão (mesma categoria de duplicação pequena já aceita em M07.1
pro fetch do opt-out set — não vale extrair um helper compartilhado só por isso).

## Verificação

`tsc --noEmit` limpo, suíte completa sem regressão. Sem teste novo pro bounce→opt-out (mesma
convenção de rotas de webhook sem cobertura prévia nesta sessão). `OmnichannelInbox.tsx`: remoção
de arquivo morto, sem superfície de teste a perder (zero importadores confirma zero cobertura
possível de qualquer forma).
