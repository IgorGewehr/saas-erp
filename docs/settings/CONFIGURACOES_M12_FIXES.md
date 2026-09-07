# M12 — Configurações, Onboarding, Planos e Billing: fixes e decisões

> Concluído em: 07/09/2026
>
> Plano de origem: `docs/paridade/M12_PLANO_IMPLEMENTACAO.md`

## Achado central: billing do SaaS genuinamente não existe

Primeira vez nesta iniciativa inteira em que "Planejado" no roadmap é literalmente verdade
pra um bullet inteiro. Sem campo `plan`/`tier`/`subscription`/`limits` em `Business`, sem
processador de pagamento cobrando o DONO do negócio (só existe Mercado Pago, que é o tenant
cobrando os PRÓPRIOS clientes), sem página de preços, sem fluxo de upgrade/downgrade, e
`business.isActive` nunca é lido em lugar nenhum do app nem em `firestore.rules` — não existe
hoje nenhuma alavanca técnica, nem manual, pra suspender um tenant inadimplente.

**Decisão do usuário: adiar.** Só 1-2 clientes pagantes reais hoje, presumivelmente cobrados
manualmente/fora da banda — investir em plano/billing self-serve agora seria prematuro.
Documentado como gap real, não lacuna silenciosa (mesmo tratamento do backup/observabilidade
adiados em M13).

## Achado colateral: 2ª cópia dos slots de integração mortos do M11

O M11 já tinha apagado um cockpit inteiro (`app/components/features/integrations/`, 14
arquivos) com 8 proxies de integração (Stripe/Vercel/Resend/Sentry/Cloudflare/AWS/Supabase/
GoDaddy) que não tinham nenhum consumidor real. A investigação de M12 achou que **o mesmo
shape de 8 providers vivia numa SEGUNDA cópia**, dentro de `SettingsModule.tsx` (aba
Enterprise) — não pega pelo M11 porque estava em outro diretório. Só `resend` tinha
consumidor real (`app/api/financial/notify/service.ts`, envio de e-mail transacional). Os
outros 7 deixavam um admin "conectar" (gravar API key criptografada) e receber um estado
"conectado" sem efeito nenhum — nem pior nem melhor que o cockpit já apagado, mas
inteiramente ignorado por aquela fatia.

**Decisão do usuário: apagar só os 7 slots mortos, manter Resend e o toggle "Enterprise
mode"/gate de CRM+Kanban como está** (não mexer no toggle em si, que continua sem verificação
real no servidor — decisão separada, não tomada agora).

### Verificado antes de apagar

`saveIntegration`/`testConnection` (`SettingsModule.tsx`) já eram honestos: `saveIntegration`
só grava em `businesses/{id}.enterprise.integrations[]` (nenhuma chamada de API pros 7
providers); `testConnection` já mostrava um toast "teste de conexão ainda não disponível"
— nunca fingiu sucesso. Não havia dependência das 8 rotas `/api/integrations/*` que o M11
apagou (aquelas eram consumidas só pelo cockpit, esta aba nunca as chamou).

### Fix implementado

- `lib/types/index.ts`: `IntegrationProvider` reduzido de 8 valores pra só `'resend'`.
  `INTEGRATION_PROVIDERS` com só a entrada `resend`.
- `SettingsModule.tsx`: `ICON_MAP` reduzido a `{ Mail }`. Imports de ícone
  `Triangle`/`Bug`/`Database` removidos (só existiam pro `ICON_MAP` morto — confirmado via
  grep que não tinham nenhum outro uso no arquivo). `CreditCard`/`Cloud`/`Globe`/`Shield`
  mantidos — usados em UI não-relacionada no mesmo arquivo (6000+ linhas).
- `tests/types/index.test.ts`: testes de `INTEGRATION_PROVIDERS` atualizados (8→1 provider
  esperado; testes específicos de stripe/vercel/aws removidos, substituídos por 1 teste de
  resend).

## Gap 4 — default de `useCase` centralizado e setado no signup

`business.settings.useCase` nunca era setado nos 2 fluxos de signup
(`AuthProvider.tsx`) — 4 call sites (`Sidebar.tsx`, `SettingsModule.tsx` x3) faziam fallback
independente pra `'servicos'`, concordando hoje por coincidência (nenhuma fonte única de
verdade). Um negócio `'pedidos'`/`'simples'` real ficaria com o menu errado (Agenda visível,
Pedidos/Cardápio escondidos) até um admin descobrir `Modo do Sistema` manualmente.

**Fix** (engenharia pura, sem decisão de produto necessária): `DEFAULT_USE_CASE` exportado de
`lib/types/index.ts`, usado nos 4 call sites que antes tinham o literal `'servicos'`
hardcoded; ambos os fluxos de signup (email/senha e Google) em `AuthProvider.tsx` agora
gravam `settings: { useCase: DEFAULT_USE_CASE }` explicitamente na criação do negócio. Sem
mudança de comportamento observável — é exatamente o default que os fallbacks já produziam,
só deixou de depender de 4 lugares concordarem por acidente.

## Onboarding — não construído (decisão do usuário)

Não existe wizard, nem pergunta de segmento no cadastro. As peças que um wizard orquestraria
(troca de modo em `ModoSistemaTab`, nudge de sugestão por segmento
`SEGMENT_SUGGESTED_USECASE`, filtro de sidebar por `useCase`) já existem e funcionam
isoladas — só nunca foram conectadas ao momento do cadastro.

**Decisão do usuário: adiar.** Na escala atual (1-2 clientes), configuração manual de
`useCase` no kickoff de cada cliente novo já resolve bem — wizard automatizado seria
investimento prematuro.

## Verificação

- `npm run typecheck` — limpo.
- `npm run test` — 1069 testes / 80 arquivos (baseline era 1071; -2 esperado, testes
  específicos de providers removidos substituídos por menos testes do provider único
  restante). Sem regressão.
- Sem migração de dado necessária: `enterprise.integrations[]` de tenants existentes que
  porventura tenham salvo config dos 7 providers removidos continua no Firestore (não
  limpo/migrado) — só deixa de aparecer na UI. Nenhum tenant real usava isso (confirmado:
  zero consumidor de API pros 7 providers).

## Fora de escopo deliberado

- M12.2/M12.3 (schema de plano + processador de pagamento do SaaS) — não abertos, gate
  (a) foi "adiar".
- M12.6 (enforcement server-side de `isActive`/limites) — dependia de billing existir.
- Decisão sobre o futuro do toggle "Enterprise mode" em si (manter, repropor como gate pago,
  ou remover) — não tomada, só os 7 slots mortos dentro dele foram removidos.
