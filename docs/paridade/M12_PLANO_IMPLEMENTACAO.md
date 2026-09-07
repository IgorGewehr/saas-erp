# M12 — Plano de Configurações, Onboarding, Planos e Billing

> Análise concluída em: 07/09/2026
>
> Estado: investigação de abertura concluída (mesmo rigor de M05/M08/M09/M11). Nenhum código
> alterado nesta fatia — este módulo tem uma proporção incomum de decisão-de-produto vs.
> engenharia; a maior parte do trabalho real depende de checkpoint antes de codar.

---

## 0. Escopo reivindicado pelo roadmap (citação literal)

> M12 — Configurações, Onboarding, Planos e Billing
> - Status: `Planejado`
> - Perfil, empresa, modo de uso, fiscal, canais, usuários, setores e preferências.
> - Onboarding por segmento e ativação apenas dos módulos relevantes ao negócio.
> - Planos, limites, cobrança do SaaS e experiência de upgrade/downgrade.

## 1. Correções ao que o roadmap presumia

- O próprio roadmap já reconhece parcialmente (linha 61, tabela de prioridade): *"É billing
  nosso (do AEVO), não da clínica — não afeta se a odontologia consegue operar"* (⚪ baixa
  agora) — a única parte deste módulo onde "Planejado" bate com a realidade.
- **"Configurações" é maior do que o bullet descreve**: 12 abas reais (`SettingsModule.tsx`),
  não os ~7 conceitos citados — faltam `modo` (Modo do Sistema), `agente` (config do Agente
  IA), `cofre` (vault de senhas), `pagamentos` (Mercado Pago), `enterprise`, `auditoria`
  (lixeira de soft-delete).
- **"Modo de uso" (useCase) JÁ é configurável pós-signup** — `ModoSistemaTab` existe e
  funciona, grava `settings.useCase`, admin-gated. O que FALTA é ele nunca ser setado NO
  signup (fica `undefined`, 3 lugares diferentes fazem fallback pra `'servicos'`
  independentemente — `Sidebar.tsx:327`, `SettingsModule.tsx:3998`, `SettingsModule.tsx:5048`).
- **"Onboarding por segmento" não existe como fluxo nenhum** — nem wizard, nem pergunta no
  signup. As peças que um wizard orquestraria (switch de useCase, filtro de sidebar por
  useCase, campo `segment` dentro de Agente IA) já existem e funcionam isoladamente — só
  nunca foram conectadas ao momento do cadastro.
- **"Planos, limites, cobrança do SaaS" está genuinamente ausente do código** — primeira vez
  nesta iniciativa inteira que "Planejado" é factualmente verdade pra um bullet inteiro. Sem
  campo `plan`/`tier`/`subscription`/`limits` em `Business`, sem integração de pagamento que
  cobre o DONO do negócio (só existe Mercado Pago, que é o tenant cobrando os PRÓPRIOS
  clientes), sem página de preços, sem fluxo de upgrade/downgrade.

## 2. O que já existe e funciona

- 12 abas de Settings maduras e mantidas, gate de admin real (`ADMIN_ONLY_TABS`).
- `ModoSistemaTab` — troca de `useCase` funcional, com nudge de sugestão por segmento
  (`SEGMENT_SUGGESTED_USECASE`, opt-in, nunca automático).
- Filtro de sidebar por `useCase` real e enforced client-side (`Sidebar.tsx`,
  `SidebarEditorTab.tsx`).
- `Pagamentos` (Mercado Pago do tenant) e `Membership`/`ClientMembership` (cobrança do tenant
  aos PRÓPRIOS clientes) — confirmado não-confundível com billing do SaaS.

## 3. Gaps reais encontrados

### Gap 1 — CRÍTICO (mas é ausência de produto, não bug): zero mecanismo de billing/plano do SaaS

Sem campo em `Business`, sem processador de pagamento pro dono do negócio, sem página de
preços/upgrade. `business.isActive` existe mas nunca é lido em lugar nenhum do app nem em
`firestore.rules` — não existe HOJE nenhuma alavanca técnica pra suspender um tenant
inadimplente, nem manual.

### Gap 2 — ALTO: "Enterprise mode" é um toggle gratuito e auto-serviço cujo nome/modelo sugerem um tier pago que nunca foi construído

`toggleEnterprise` liga `business.enterprise.isEnabled` de graça pra qualquer admin, sem
pagamento nem aprovação. Gate só client-side (Sidebar), nunca reforçado em `CRMModule`/
`firestore.rules` (achado já registrado em `docs/agenda/AGENDA_ANAMNESE.md`, reconfirmado
aqui). Hoje só esconde/mostra CRM e Kanban — sem razão clara pra esses 2 módulos
especificamente serem "enterprise" e não outros.

### Gap 3 — ALTO: 7 dos 8 slots de "Integrações Enterprise" dentro do Settings são UI viva que grava credenciais que ninguém nunca lê

`EnterpriseTab` (`SettingsModule.tsx`) tem os mesmos 8 providers (stripe/vercel/resend/
sentry/cloudflare/aws/supabase/godaddy) do cockpit órfão que o M11 já apagou
(`app/components/features/integrations/`) — **mas esta é uma SEGUNDA cópia, viva, dentro de
Settings, que o M11 não pegou** porque não estava no mesmo diretório. Só `resend` tem
consumidor real (`financial/notify/service.ts`). Um admin que preenche AWS/Stripe/Vercel/etc.
aqui recebe estado "conectado" que não faz nada — pior que código morto, é uma armadilha de
UX (parece funcionar, não funciona).

### Gap 4 — MÉDIO: default de `useCase` espalhado em 3 lugares, nunca setado no signup

Funciona hoje por coincidência (os 3 lugares concordam em `'servicos'`), mas é frágil e deixa
negócios `'pedidos'`/`'simples'` com o menu errado até um admin descobrir `Modo do Sistema`
manualmente.

### Gap 5 — BAIXO: zero limite de uso de qualquer tipo

Sem cap de usuários/mensagens/storage. Único "budget" real é `dailyBudgetUsd` do Agente IA,
que é auto-configurado pelo TENANT pra ele mesmo, não um limite de plano imposto pelo Aevo.
Consequência direta do Gap 1 (sem plano, não há o que limitar).

## 4. Decisões de produto (não de engenharia) — núcleo desta investigação

Ver relatório completo do agente de investigação para o detalhamento de cada item (a)-(h).
Resumo dos que exigem checkpoint ANTES de qualquer código:

- **(a) Construir billing do SaaS agora, ou adiar?** Gate de tudo mais neste módulo. Só
  1-2 clientes pagantes reais hoje, presumivelmente cobrados manualmente/fora da banda.
- **(b) Se construir — que modelo de precificação?** Flat/por-assento/por-módulo/por-uso —
  não inferível do código, decisão de negócio pura.
- **(c) O que fazer com "Enterprise mode"?** Repropor como gate pago de verdade, reenquadrar
  como feature flag sem relação com preço, ou remover o gate (já não é reforçado no servidor).
- **(d) O que fazer com os 7 slots de integração mortos dentro do Settings?** Apagar (mais
  barato, mesmo precedente do M11), religar a algo relevante pro tenant (improvável — um
  dentista não usa forecast de custo AWS), ou mover pra fora do shape gravável pelo tenant.
- **(e)/(h) Política de trial/suspensão** — aceitar indefinidamente "cobrança manual, zero
  alavanca técnica" ou vale construir um kill-switch mínimo mesmo sem billing completo?
- **(f) Vale construir um wizard de onboarding agora**, dado a escala atual (peças já
  existem, só nunca foram conectadas), ou configuração manual por humano no kickoff já
  resolve suficientemente bem?
- **(g) Vale impor ALGUM limite de uso (ex: teto de gasto LLM por tenant definido pelo Aevo,
  não autoconfigurado)** independente de billing existir?

## 5. Fases — decisões tomadas (07/09/2026)

- **M12.0** — Baseline (esta investigação). ✅ Concluído.
- **M12.1** — Checkpoint (a): **adiar** billing do SaaS. Recomendação aceita — só 1-2
  clientes pagantes reais hoje, cobrança manual/fora-de-banda segue suficiente. Gap 1 (zero
  alavanca técnica pra suspender tenant) documentado e aceito como risco conhecido, mesmo
  tratamento do backup/observabilidade adiados em M13. M12.2/M12.3 (schema de plano +
  processador de pagamento) NÃO abertos.
- **M12.4** — Checkpoint (c)+(d): **apagar só os 7 slots de integração mortos** (Stripe/
  Vercel/Sentry/Cloudflare/AWS/Supabase/GoDaddy), manter Resend (real) e manter o toggle
  "Enterprise mode"/gate de CRM+Kanban como está (não mexer nisso agora). ✅ Concluído.
  - `IntegrationProvider` reduzido a `'resend'` (`lib/types/index.ts`).
  - `INTEGRATION_PROVIDERS` com só a entrada `resend`.
  - `ICON_MAP`/imports de ícone não usados em outro lugar do arquivo removidos
    (`SettingsModule.tsx`) — `CreditCard`/`Cloud`/`Globe`/`Shield` mantidos (usados em UI
    não-relacionada no mesmo arquivo); `Triangle`/`Bug`/`Database` removidos (só existiam
    pro ICON_MAP morto).
  - `tests/types/index.test.ts` atualizado (8→1 provider esperado).
  - Confirmado antes de apagar: `saveIntegration`/`testConnection` já eram honestos (gravam
    só em Firestore, `testConnection` já mostrava "não disponível ainda" — não fingiam
    sucesso). Nenhuma rota de API dependia disso (M11 já tinha apagado as 8 rotas
    `/api/integrations/*` que uma cópia IRMÃ — não esta — chamava).
- **M12.5** — Checkpoint (f): **adiar** wizard de onboarding. Recomendação aceita — na
  escala atual, configuração manual de `useCase` no kickoff do cliente resolve bem.
- **Gap 4** (default de `useCase` espalhado, nunca setado no signup) — engenharia pura, sem
  checkpoint necessário. ✅ Concluído: `DEFAULT_USE_CASE` centralizado em `lib/types/
  index.ts`, os 4 call sites (`Sidebar.tsx`, `SettingsModule.tsx` x3) usam a constante, e os
  2 fluxos de signup (`AuthProvider.tsx`) agora setam `settings.useCase` explicitamente no
  momento da criação do negócio — sem mudança de comportamento observável (é o mesmo default
  que os fallbacks já produziam).
- **M12.6** — não aberto (dependia de (e)/(g), que dependiam de (a)=construir).
- **M12.9** — Aceite: smoke manual não executado (mesma ressalva recorrente da sessão).

**M12 fecha aqui (07/09/2026)** com o essencial resolvido: o único achado crítico (ausência
de billing do SaaS) tem decisão explícita de adiamento, não lacuna silenciosa; o achado de
maior risco imediato de UX (7 slots de integração fingindo funcionar) foi corrigido; o único
bug de engenharia pura (default de useCase) foi corrigido. Onboarding wizard e billing ficam
documentados como dormentes até sinal real de demanda.
