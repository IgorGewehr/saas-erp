# Agenda — lembretes de verdade + notas visíveis no histórico do paciente

> Concluída em código em: 03/09/2026
>
> Projeto de destino: AEVO (`saas-erp`)
>
> Contexto: levantamento de gaps pra deixar a odontologia pronta (Agenda + Fiscal + "tudo que uma clínica precisa"), item de lembretes/histórico do checklist.

## 1. Bug real corrigido: lembretes de WhatsApp silenciosamente não disparavam

`app/api/agent/scheduled/run/route.ts` (`processBusiness`) só aplicava o default "lembrete ligado" (o que a UI já mostra antes do primeiro save) quando `aiAgent.enabled` (o Agente IA COMPLETO) também estava true — contradizendo o próprio texto da UI ("Funciona independente do Agente IA"). E `isRelevantForScheduling` (filtro do cron cross-tenant) tinha o mesmo problema: um negócio `useCase='servicos'` que nunca abriu essa aba de Settings ficava fora do sweep inteiramente.

Efeito prático: uma clínica que só quer Agenda + Fiscal (Agente IA desligado de propósito) via os 3 toggles de lembrete "ligados" na tela, mas nunca recebia nenhum lembrete de verdade — falha 100% silenciosa, sem erro, sem log visível pro dono.

**Correção**: extraída a lógica pura pra `lib/services/agenda/schedulingEligibility.ts` (`resolveAgendaSchedulingConfig`/`isRelevantForScheduling`), sem exigir `aiAgent.enabled` — só `useCase==='servicos'` + config nunca salva. Config explicitamente salva (mesmo com tudo desligado) continua respeitada normalmente.

**Segundo aviso adicionado**: banner em Settings → Agente IA → "Lembretes automáticos" quando nenhum canal WhatsApp está conectado — hoje esse é outro jeito de o recurso "parecer ligado" e não enviar nada (sem conversa ativa no canal, o envio é pulado em silêncio). E nota condicional explicando que a atualização automática de status pela resposta "confirmo" do paciente só funciona com o Agente IA completo ligado — hoje o texto da UI dava a entender que bastava o toggle de lembrete.

## 2. Notas do atendimento agora aparecem no histórico do paciente

`ClientTimeline.tsx` já agregava agendamentos na aba "Timeline" do cliente, mas nunca mostrava `appointment.notes` — o único lugar onde um profissional registra o que foi feito na visita. Adicionado como linha extra (itálico, truncado em 2 linhas) sob cada evento de agendamento.

## 3. O que ficou de fora (deliberado)

- Registro clínico estruturado (odontograma, anamnese, histórico de procedimento por dente) — fora do escopo de um ERP genérico; `notes` livre continua sendo o único campo disponível.
- Segregação de dados por profissional (hoje qualquer membro da equipe vê todos os pacientes de todos os dentistas) — risco baixo pra uma clínica pequena com equipe de confiança, mas não é controle de acesso de verdade. Fica documentado, não corrigido nesta fatia.

## 4. Evidências automatizadas

- `tests/services/schedulingEligibility.test.ts` (6 casos): default aplicado sem exigir Agente IA; não aplica fora de `servicos`; config explicitamente salva (tudo desligado) é respeitada; um único toggle salvo já torna elegível; negócio sem `useCase` não é elegível; Agente IA completo ligado torna elegível independente de `useCase`.
- Suíte completa: 833 testes em 61 arquivos aprovados. `tsc --noEmit` limpo.
