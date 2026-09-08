# M00 — Baseline técnico, contratos e estratégia de migração

> Análise concluída em: 08/09/2026
>
> Estado: diferente dos demais módulos, M00 é governança/meta — não tem UI nem coleção
> Firestore própria. Investigação verificou se os 4 artefatos que o bullet pede já existiam
> (organicamente, como efeito colateral da prática SDD desta iniciativa inteira) e reconciliou
> o que estava desatualizado.

## 0. Escopo reivindicado pelo roadmap (citação literal)

> M00 — Baseline técnico, contratos e estratégia de migração
> - Registrar contratos atuais e dados legados antes das mudanças.
> - Definir padrão de versionamento de schema e scripts de migração.
> - Padronizar critérios de aceite, testes e checklist de segurança multi-tenant.
> - Criar mapa de dependências entre estoque, vendas, financeiro e fiscal.

## 1. Achado central: os 4 artefatos já existiam, mas 2 estavam significativamente desatualizados

Diferente de "Planejado" (que sugeriria nada existir), os artefatos-alvo de M00 já tinham sido
criados nesta mesma iniciativa (`lib/contracts/README.md`, `docs/sdd-roadmap.md`,
`docs/architecture-map.md`, `PRE_PRODUCTION_CHECKLIST.md`) — só nunca foram formalmente
reconciliados como "M00 concluído", e 2 deles (`sdd-roadmap.md`, `architecture-map.md`) tinham
ficado defasados em relação ao código real, o mesmo padrão de todo módulo desta iniciativa.

### 1.1 Contratos atuais registrados — `lib/contracts/README.md` ✅ já existia, preciso

Documento vivo, workflow claro (leia contrato → crie se faltar → implemente com `z.infer` →
teste em `tests/contracts/`), regras duras numeradas. Não precisou de correção.

### 1.2 Padrão de versionamento de schema — `schemaVersion` ✅ já é convenção estabelecida

Confirmado em uso real: `productV2.ts`/`purchaseNoteV2.ts`/`stockMovementV2.ts`/
`commercialV2.ts` seguem o mesmo padrão de campo `schemaVersion` + coexistência com o formato
legado durante a migração. `lib/contracts/README.md` regra 1 formaliza isso.

### 1.3 `docs/sdd-roadmap.md` — 🔴 estava significativamente desatualizado, corrigido nesta fatia

3 dos 5 "Próximos passos" listados como não-feitos já tinham sido entregues em fatias
anteriores desta iniciativa, sem o doc nunca ter sido atualizado:
- Fase 1 (contratos do agente): dizia "PILOTO: agenda" — na real, M11 (07/09) já tinha
  estendido pra 21 de 21 rotas de tool. Lado Python continua genuinamente parcial (4/20,
  rastreado como M11.1b) — isso o doc já sinalizava certo, só o lado TS que estava
  desatualizado.
- Fase 3 (webhooks): dizia que aplicar `markWebhookSeen` em `meta/route.ts` era "Próximo" —
  já estava feito (confirmado por leitura de código, provavelmente entregue em M07).
- Fase 4 (eventos cross-módulo): os 2 itens "Próximo" (chamar `ensureDomainEventHandlers()` no
  bootstrap; migrar `AgendaModule.tsx` pra emitir eventos em vez de chamada inline) já tinham
  sido entregues — o segundo, inclusive, ficou mais completo do que o doc original previa (3
  handlers reais — completed/canceled/noShow — não só 1 piloto de métricas).
- Fase 5 (demais módulos): Financeiro e Agenda+Services já têm `domain/`+`fsm/` completos e em
  produção (M03/M06) — o doc antigo listava os 6 itens da fase inteira como não-iniciados.

Reconciliado por leitura direta de `lib/contracts/domain/`, `lib/contracts/fsm/`, e grep dos
call-sites relevantes — não por memória da sessão.

### 1.4 Mapa de dependências estoque↔vendas↔financeiro↔fiscal — ✅ já existia em `architecture-map.md`

Seção "Dependências cruzadas mais importantes" + "Event bus" já cobre isso com razoável
densidade (PDV→stock→transactions→fiscal, Compra→stock, Appointment→commission, etc.) — não
precisou ser criado do zero, só teve 1 imprecisão corrigida (handlers de evento da Agenda são 3,
não 2 — faltava `appointment.noShow`) e o resumo de topologia no topo do arquivo (grafo do
agente "5 nodes"→6; lista de integrações externas incluía 6 já apagadas em M11/M12).

## 2. O que NÃO foi feito (genuinamente fora de escopo desta fatia)

- Script `pnpm contracts:openapi` (Fase 0 do sdd-roadmap) — não bloqueante, nunca priorizado.
- Contratos de domínio formais (Zod) pra CRM (Client/Deal/Segment), Broadcasts, Kanban, Notas,
  Forms, Reviews, Spreadsheets, Vault — as FEATURES funcionam (confirmado em M05/M07/M09), só
  não têm `domain/*.ts` formal ainda. Fase 5 do sdd-roadmap já rastreia isso corretamente.
- M11.1b (Pydantic pro lado Python dos 16 domínios restantes) — já rastreado em M11, não
  duplicado aqui.

## 3. Conclusão

M00 não gerou trabalho de código novo — é o único módulo desta iniciativa cujo "gap real" era
inteiramente de **documentação desatualizada**, não de comportamento de sistema. Fechado
reconciliando `docs/sdd-roadmap.md` e `docs/architecture-map.md` contra o código real.
