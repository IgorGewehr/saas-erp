# Roadmap de evolução do AEVO com base no Gestão Raiz

> Documento vivo de acompanhamento.
>
> Criado em: 25/08/2026
> Projeto de destino: AEVO (`saas-erp`)
> Referência funcional: Gestão Raiz
> Princípio: buscar paridade de maturidade, segurança e experiência sem transformar o AEVO em um ERP industrial.

## Como usar este documento

- Cada módulo começa desmarcado (`[ ]`) e só recebe `[x]` quando implementação, migração, testes e validação funcional estiverem concluídos.
- O status do módulo deve seguir: `Planejado` → `Em análise` → `Em implementação` → `Em validação` → `Concluído`.
- Descobertas que alterem escopo devem ser registradas no histórico de decisões antes da implementação.
- Cada módulo deve ter uma entrega isolada e validável. Não misturar refatoração estrutural de outro módulo na mesma entrega.
- Toda mudança deve preservar isolamento multi-tenant por `businessId`, compatibilidade com dados existentes e reversibilidade da migração.

## Objetivo

Elevar os módulos compartilhados do AEVO ao nível de maturidade atingido pelo Gestão Raiz em produção, aproveitando regras e fluxos já validados por clientes. A referência será adaptada para pequenos negócios, varejo, alimentação e prestadores de serviços.

Paridade não significa copiar telas, coleções ou regras industriais. Para cada capacidade encontrada no Gestão Raiz, a decisão deve ser uma destas:

- **Portar:** comportamento aplicável praticamente sem mudança de negócio.
- **Adaptar:** reutilizar a regra, simplificando-a para o público do AEVO.
- **Manter AEVO:** o AEVO já possui solução mais adequada ao seu público.
- **Não aplicar:** capacidade exclusivamente industrial ou regulatória sem valor para o AEVO.

## Regras permanentes de implementação

1. Toda leitura e escrita deve respeitar `businessId`.
2. Operações de estoque, dinheiro, fiscal e cobrança devem ser atômicas ou idempotentes.
3. Regras críticas devem ficar em serviços/contratos, não dentro de componentes visuais.
4. Alterações de schema devem incluir compatibilidade, migração e estratégia de rollback.
5. Nenhum módulo será considerado concluído apenas porque a interface está pronta.
6. Os critérios de conclusão incluem testes, regras do Firestore, índices, observabilidade e smoke test.
7. Funcionalidades industriais só entram quando houver caso de uso claro para pequenos negócios.

---

## Prioridade atual — foco odontologia (pivô confirmado em 03/09/2026)

A paridade sequencial (M02.5e em diante, na ordem original) está **pausada**. O trabalho ativo é guiado pelos dois clientes pagantes reais — e entre eles, a odontologia é a prioridade; o restaurante de hotel (Cardápio/Pedidos/Mesa) recebeu o mínimo pra funcionar e não deve consumir mais esforço agora, salvo pedido explícito.

Classificação de relevância de cada módulo do roadmap **para uma clínica odontológica** (não para o restaurante nem para o AEVO em geral):

| Módulo | Relevância | Por quê |
|---|---|---|
| **M06 — Agenda, Serviços, Booking** | 🔴 Crítica | Módulo operacional central da clínica — é onde o dentista vive o dia inteiro. Nunca foi aberto formalmente no roadmap (segue `Planejado`), apesar de já ter recebido hardening real fora da sequência: efeitos server-side, NFSe manual, cobrança/parcelamento, notas do atendimento, lembretes de WhatsApp. |
| **M04 — Fiscal e Contábil** | 🔴 Alta | Toda consulta concluída pode virar NFS-e — é dinheiro e obrigação legal todo dia. Já ~95% pronto **fora** deste roadmap (módulo pré-existente, ver `docs/roadmap/ROADMAP_FISCAL_BACKLOG.md`); falta reconciliar o status real aqui e fechar o backlog residual. |
| **M03 — Financeiro e Conciliação** | 🔴 Alta | Cobrança/parcelamento de procedimento é fluxo de caixa diário. Acabamos de plugar Agenda→Financeiro nesta sessão, mas o módulo Financeiro clássico em si (parcelamento robusto, conciliação, DRE) nunca passou pelo mesmo hardening que M01/M02 receberam. |
| **M07 — Conversas, Canais e Campanhas** | 🟠 Alta | Comunicação com paciente via WhatsApp (lembrete, confirmação, reengajamento) já é crítica hoje — é o canal real de relacionamento da clínica com quem agenda. |
| **M10 — Automações, Notificações e Eventos** | 🟠 Alta | Sustenta a confiabilidade de tudo que M06/M07 prometem (lembrete que não é enviado em silêncio é exatamente o bug que corrigimos nesta sessão). Sem isso, os módulos acima ficam bonitos na tela e mudos na prática. |
| **M13 — Segurança, Desempenho e Produção** | 🟠 Alta (gate) | Cliente pagante real com dado de paciente em produção. Não é feature nova, é pré-requisito de continuar operando com segurança — deve andar em paralelo, não no fim da fila. |
| **M05 — Clientes, CRM e Jornada Comercial** | 🟡 Média-alta | Histórico do paciente e recall/reativação (aniversário, retorno de check-up) têm valor real pra uma clínica, mas dependem de M06/M07 estarem sólidos primeiro. |
| **M09 — Equipe, Permissões e Colaboração** | 🟡 Média | Equipe pequena (dentista(s) + recepção) — o que já existe (roles, setores) provavelmente basta por enquanto. |
| **M08 — Dashboard, Relatórios e Indicadores** | 🟡 Média | Útil pra gestão da clínica, não bloqueia operação do dia a dia. |
| **M11 — Agente de IA, API pública e Integrações** | 🟢 Baixa-média | Agente já cobre agendamento básico via booking público; evoluir mais não é urgente agora. |
| **M01 — Catálogo, Estoque, Fornecedores, Compras** | 🟢 Baixa | Clínica não tem estoque relevante além de materiais de consumo pontuais. Já 100% em código; falta só aceite operacional em homologação, que pode esperar. |
| **M02 — restante (M02.5e+)** | 🟢 Retomado 08/09/2026 (restaurante) | `variantId` no carrinho, B2B condicional, Mercado Pago tokenizado — vitrine de produto/varejo, não é o que uma clínica cobra, mas o usuário pediu pra retomar em paralelo à odontologia. O núcleo já entregue (M02.0–M02.5d) já é suficiente pro PDV eventual da clínica; o restante evolui a experiência do restaurante. |
| **M12 — Onboarding, Planos e Billing SaaS** | ⚪ Baixa agora | É billing nosso (do AEVO), não da clínica — não afeta se a odontologia consegue operar. |
| **M00 — Baseline técnico** | ⚫ Transversal | Nunca foi formalizado como módulo à parte; cada módulo (M01, M02) criou seu próprio baseline na prática. Não bloqueia nada específico da odontologia. |

**Ordem de trabalho recomendada a partir de agora:**

1. **M06 (Agenda)** — abrir formalmente: consolidar o que já foi feito ad-hoc num plano detalhado (mesmo formato de `M02_PLANO_IMPLEMENTACAO.md`), mapear o que ainda falta.
2. **M04 (Fiscal)** — reconciliar o status real do módulo pré-existente com este roadmap; fechar lacunas do backlog fiscal restante.
3. **M03 (Financeiro)** — hardening do módulo clássico (parcelamento, conciliação) no mesmo nível de rigor que M01/M02 receberam.
4. **M07 + M10** — comunicação com paciente e confiabilidade da automação, em paralelo com M06 (são a mesma superfície na prática).
5. **M05** — CRM/histórico do paciente, depois do operacional estar sólido.
6. **M13** — auditoria de segurança/produção antes de qualquer expansão de escala real de clientes.

**Deliberadamente sem esforço adicional agora**: M01 aceite em homologação — não é urgência da odontologia, precisa de tenant real. (M08/M09/M11/M12 já foram percorridos e fechados em 05-07/09/2026, apesar de listados como baixa prioridade — usuário pediu pra continuar por eles enquanto não podia fazer ações manuais nos módulos de prioridade alta. M02.5e+ retomado em 08/09/2026 a pedido explícito do usuário, em paralelo à odontologia.)

---

## Roadmap geral

### Fase 0 — Base e governança da evolução

- [x] **M00 — Baseline técnico, contratos e estratégia de migração**
  - Status: `Concluído em 08/09/2026`. Diferente dos demais módulos, é governança/meta sem UI
    nem coleção própria. Achado: os 4 artefatos que o bullet pede já existiam organicamente
    (efeito colateral da prática SDD desta iniciativa inteira) — `lib/contracts/README.md`,
    `docs/sdd-roadmap.md`, `docs/architecture-map.md`, `PRE_PRODUCTION_CHECKLIST.md` — mas
    nunca tinham sido formalmente reconciliados como "M00 concluído", e 2 deles
    (`sdd-roadmap.md`/`architecture-map.md`) estavam significativamente desatualizados em
    relação ao código real (mesmo padrão de todo módulo desta iniciativa): Fase 1 do
    sdd-roadmap dizia "PILOTO: agenda" quando M11 já tinha estendido pra 21/21 rotas; Fase 3/4
    listavam como "Próximo" itens já entregues (dedup Meta, `ensureDomainEventHandlers()` no
    bootstrap, migração de `AgendaModule.tsx` pra eventos); Fase 5 listava Financeiro e
    Agenda+Services como não-iniciados quando M03/M06 já entregaram `domain/`+`fsm/`
    completos. Reconciliado por leitura direta de código, não por memória da sessão.
  - **Plano detalhado: `docs/paridade/M00_PLANO_IMPLEMENTACAO.md`.**
  - Registrar contratos atuais e dados legados antes das mudanças.
  - Definir padrão de versionamento de schema e scripts de migração.
  - Padronizar critérios de aceite, testes e checklist de segurança multi-tenant.
  - Criar mapa de dependências entre estoque, vendas, financeiro e fiscal.

### Fase 1 — Operação comercial fundamental

- [x] **M01 — Catálogo, Estoque, Fornecedores e Compras**
  - Status: `M01.0 a M01.9 concluídos em código; aceite operacional de homologação pendente`
  - Produtos, categorias, imagens, variações, estoque, movimentações, fornecedores e NF-e de entrada.
  - Base para PDV, pedidos, financeiro, fiscal, cardápio e relatórios.

- [ ] **M02 — Vendas, PDV, Pedidos e Cardápio** 🟢 Restante retomado 08/09/2026 (restaurante)
  - Status: `Em implementação — M02.0 a M02.4 e M02.5a-d concluídas em código (público, manual, agente, FSM central, bloqueio de edição pós-efeito). M02.5e em diante PAUSADO em 03/09/2026, RETOMADO em 08/09/2026 a pedido do usuário — variantId/B2B/Mercado Pago tokenizado servem restaurante/varejo, trabalhado em paralelo à odontologia`
  - Unificar regras de preço, desconto, pagamento, baixa/restauração de estoque e cancelamento.
  - Preservar cardápio, delivery, modificadores, fidelidade e gift cards do AEVO.
  - Adaptar do Gestão Raiz as garantias de consistência, auditoria e emissão fiscal.
  - Plano detalhado: `docs/paridade/M02_PLANO_IMPLEMENTACAO.md`.

- [x] **M03 — Financeiro e Conciliação** 🔴 Prioridade atual (odontologia)
  - Status: `Concluído em código em 04-08/09/2026 (M03.0 a M03.7); só M03.9 (aceite) em aberto`. M03.7 (08/09/2026): checkpoint com o usuário decidiu portar DRE + projeção de caixa pro Financeiro clássico (reusando os read-models puros do financial-v2, sem duplicar lógica) e construir Orçamento agora (contrato novo `lib/contracts/domain/budget.ts`, categoria/tipo reusando a taxonomia já existente dos lançamentos). Achado colateral corrigido: Sidebar "Financeiro" sem `minRole:manager` (mesma classe do fix de M08.5 em "Relatórios"). Investigação de abertura confirmou o "Financeiro atual e Financeiro V2" do roadmap é literal: duas árvores de UI inteiras (`financial/` clássico + `financial-v2/`, ~70 arquivos) escrevendo na MESMA coleção `transactions`, com taxonomia de categoria duplicada palavra-por-palavra. Conciliação OFX/CSV corrigida em M03.5 (36 testes novos, zero cobertura antes). M03.0 entregou auditoria read-only (8 códigos de problema, ainda não rodada contra tenant real). M03.1 promoveu `Transaction` pra contrato de domínio Zod completo — achado real: 3 fontes de verdade independentes pro mesmo enum, consolidadas. M03.2 entregou o núcleo de criação/transição (idempotência real + FSM aplicado) que nunca existiu. M03.3 migrou `app/api/v1/transactions/route.ts` pro núcleo, corrigiu a atomicidade da reversão de venda no PDV, e adicionou idempotência opcional ao contrato do agente (achados reais no caminho: proteção de replay em nível de transporte já existia via `agentNonces`; Admin SDK rejeitava `undefined` explícito em campos opcionais — bug latente corrigido como efeito colateral). M03.4 endureceu `firestore.rules` (`amount>0` + transição de status validada — última linha de defesa pros caminhos client SDK que ainda não usam o núcleo; não validado via emulador nesta sessão por falta de Java no ambiente). PIX/Boleto/OCR/Open Banking são 100% stub confirmado. DRE/fluxo de caixa só existem no V2; Orçamento é tipo declarado sem nenhum uso.
  - **Plano detalhado: `docs/paridade/M03_PLANO_IMPLEMENTACAO.md`** — diferente de M06, não é convergência (não existe núcleo pra convergir pra ele ainda). Ordem recomendada: ~~testes de conciliação (M03.5)~~ ✅ → ~~baseline/auditoria (M03.0)~~ ✅ → ~~contrato de domínio (M03.1)~~ ✅ → ~~núcleo de criação/transição novo (M03.2)~~ ✅ → ~~migração dos caminhos de maior risco (M03.3, incl. follow-ups de PDV e agente)~~ ✅ → ~~enforcement no servidor (M03.4)~~ ✅ → ~~inventário de paridade V1/V2 pra apoiar a decisão~~ ✅ → **checkpoint com o usuário: decisão V1 vs V2** (M03.6, não é decisão de engenharia — único item restante) → DRE/fluxo/orçamento conforme a decisão (M03.7) → aceite (M03.9). PIX/Boleto/OCR/Open Banking permanecem deliberadamente fora de escopo, dormentes até sinal real de demanda (mesmo tratamento do backlog fiscal).
  - **Inventário de paridade V1/V2 concluído em 04/09/2026** (`docs/financeiro/FINANCEIRO_M03_6_PARIDADE_V1_V2.md`), a pedido do usuário antes de decidir: achado não é "V2 superset faltando 1-2 gaps" — V2 lidera em relatórios somente-leitura (DRE, caixa físico, churn de assinatura) mas fica bem atrás em escrita operacional (não edita/cancela lançamento, não parcela, não gerencia recorrência além de "repete mensal", não cria conta bancária — o que ironicamente bloqueia sua própria feature de caixa físico). Risco de dado real: `bankAccounts.balance` é semântica DIVERGENTE entre as duas UIs (manual no clássico, ledger automático no V2). Corrigido de passagem: a afirmação anterior de que "projeção de caixa só existe no V2" estava errada, o clássico tem a sua própria.
  - **Decisão V1 vs V2 tomada em 04/09/2026 (M03.6): clássico é o Financeiro principal**, motivada diretamente pelas capacidades que o cliente pagante atual (odontologia) usa e o V2 ainda não cobre (editar/cancelar lançamento, parcelamento, comissão, "Cobrar" da Agenda). Implementado: convite de entrada do V2 (`FinancialV2EntryBanner`) removido de `app/app/page.tsx`, sem remover código/flag — quem já tivesse `financialV2Enabled` ligado continua acessando, trabalho fica disponível pra retomar no futuro. M03 fica só com M03.7 (DRE/fluxo/orçamento, baixa prioridade agora que clássico venceu) e M03.9 (aceite) em aberto.
  - Já entregue fora da sequência: `docs/agenda/AGENDA_COBRANCA.md` (vínculo Agenda→Financeiro).

- [x] **M04 — Fiscal e Contábil** 🔴 Prioridade atual (odontologia)
  - Status: `Concluído em 04/09/2026` — módulo pré-existente e maduro (~95% pronto), nunca formalmente reconciliado com esta lista até esta sessão. Primeira fatia entregue em 04/09/2026: `persistPendingAndRespond` (SEFAZ indisponível) não vinculava o documento fiscal pendente à origem (Sale/DeliveryOrder/Appointment) — achado na M06.6, risco real de nota duplicada, priorizado pelo usuário. Corrigido + UI (Agenda/Pedidos) ganhou 3º estado visual "pendente". Ver `docs/fiscal/FISCAL_VINCULO_PENDENTE.md`. Backlog residual (certificado A3, fila Redis/Bull, MDF-e — todos dormentes) em `docs/roadmap/ROADMAP_FISCAL_BACKLOG.md`.
  - Revisar certificado, NFC-e, NF-e, NFS-e, eventos, cancelamento, carta de correção, contingência e sincronização de status.
  - Adaptar rotinas contábeis e exportações ao perfil tributário dos pequenos negócios.
  - MDF-e e rotinas estritamente industriais/logísticas permanecem fora do escopo inicial.

### Fase 2 — Relacionamento e prestação de serviços

- [x] **M05 — Clientes, CRM e Jornada Comercial**
  - Status: `Concluído em 05/09/2026 (M05.1 a M05.6); resta só M05.7 (aceite, precisa de tenant real)`. Investigação de abertura (mesmo rigor de M06/M03/M07/M10/M13) confirmou o mesmo padrão: cadastro unificado, dedup, histórico, segmentos (dinâmicos, recalculados ao vivo no envio) e formulários já existem e funcionam. **Achado real**: "pipeline"/jornada comercial B2B já foi deliberadamente descontinuado na UI manual (botões removidos, comentário no próprio código) — decisão silenciosa que o roadmap não registrava; `CRMDeal` só é criável via agente/API hoje, `DealFormDialog` é 100% inalcançável pela UI. Scoring não tem motor nenhum — só aceita valor de API externa, nunca calculado internamente, o que significa a automação `high_churn_risk` (idempotência corrigida em M10.4) nunca dispara pra odontologia (sem sinal nenhum, diferente de `client_inactive`). Achado estrutural: `Client.status` (Kanban) e `Client.lifecycleStage` (trigger de automação) modelam a MESMA jornada com nomenclatura diferente e nunca sincronizam. Achados de bug pequenos: `PUT /api/v1/crm/contacts` apaga `relationshipHistory` por substituição rasa (auto-documentado no código, nunca corrigido); merge de clientes reassocia tarefas Kanban com nome de campo errado (`contactId` vs `relatedContactId`, mesma classe do M06.5c).
  - **Plano detalhado: `docs/paridade/M05_PLANO_IMPLEMENTACAO.md`** — ordem recomendada: ~~fixes de baixo risco (M05.1 shallow-replace, M05.2 campo errado no merge, M05.3 idempotência em `forms/submit`)~~ ✅ → ~~checkpoints de produto (M05.4 motor de scores, M05.5 unificar status/lifecycleStage, M05.6 destino do pipeline morto)~~ ✅ → aceite (M05.7). **Decisões do usuário**: motor de scores fica dormente até sinal real; `status`/`lifecycleStage` continuam separados por design (documentado no tipo); `DealFormDialog`/funil morto permanece no código, agente/API-only por decisão de produto (documentado em `ImportLeadModal.tsx`). Contratos Zod formais pra Client/CRMDeal na API v1 e FSM de LeadStatus deliberadamente fora de escopo por padrão, mesmo tratamento do B2B pausado em M02.6+. Resta só M05.7 (aceite, precisa de tenant real).
  - Cadastro unificado, deduplicação, histórico, scoring, origem, pipeline, atividades, segmentos e formulários.
  - Integrar cliente com vendas, agenda, conversas, financeiro e fiscal.

- [x] **M06 — Agenda, Serviços, Booking e Assinaturas** 🔴 Prioridade atual (odontologia)
  - Status: `Concluído em código em 04/09/2026 (M06.0 a M06.9) — pendente homologação real. M06.6 parcial (status fiscal ao vivo corrigido; achado de documentos pendentes sem vínculo de origem CORRIGIDO em 04/09/2026 como primeira fatia de M04, ver docs/fiscal/FISCAL_VINCULO_PENDENTE.md; memberships/assinaturas adiadas). M06.7 concluída (agente/booking público convergidos pro núcleo M06.1 — cast morto real corrigido no horário de trabalho do profissional, bloqueios e buffer passaram a valer no canal de IA, ver docs/agenda/AGENDA_M06_7_NUCLEO_AGENTE.md). M06.9 concluída (teste concorrente cross-canal novo; ver docs/agenda/AGENDA_M06_9_ACEITE.md). **M06.5d concluída em 08/09/2026**: revisitada a análise de 04/09 que tinha adiado a consolidação dos dois sistemas de lembrete — achado real não examinado antes: idempotência por campo boolean no lembrete de paciente via WhatsApp não sobrevivia a reagendamento (paciente reagendado depois do lembrete já ter disparado nunca recebia o novo). Extraído `lib/services/agenda/reminderWindow.ts` com janela+chave de idempotência por slot compartilhadas pelos dois sistemas (que continuam separados por audiência/canal/cadência). Pendências não-bloqueantes: visibilidade por profissional (decisão de produto do usuário), extração de AgendaModule.tsx/paginação de clientes/smoke manual completo (precisam de sessão com navegador)`
  - Agenda, conflitos, recursos, recorrência, comissões, lembretes, booking público e calendários.
  - Evoluir memberships, cobrança recorrente e proteção contra no-show quando o gateway estiver disponível.
  - **Plano detalhado: `docs/paridade/M06_PLANO_IMPLEMENTACAO.md`** — diagnóstico confirmado no código: 6 canais gravam `appointments` com 3 algoritmos de conflito distintos e 2 sem nenhum (PDV e CRM); check de conflito ignora `professionalIds[]`; conclusão pode ficar sem efeito se o navegador morrer entre o write e o dispatch; FSM só imposta no cliente. **Não é reescrita — é convergência**: o núcleo (guard transacional, FSM, handlers server-side, 71 testes) já existe, mas nem todo canal usa.
  - Já entregue fora da sequência: `docs/agenda/AGENDA_HARDENING_EFEITOS_SERVIDOR.md`, `docs/agenda/AGENDA_NFSE_MANUAL.md`, `docs/agenda/AGENDA_LEMBRETES_E_HISTORICO.md`, `docs/agenda/AGENDA_COBRANCA.md`.

- [x] **M07 — Conversas, Canais e Campanhas** 🟠 Prioridade atual (odontologia)
  - Status: `Concluído em código em 04/09/2026 (M07.1 a M07.7); resta só M07.8 (aceite, precisa de tenant real/navegador)`. Investigação de abertura (mesmo rigor de M06/M03) confirmou o mesmo padrão: "não iniciado" estava errado. Atribuição, roteamento automático por setor, notas internas em conversa, contrato de domínio+FSM de `Conversation`, e o envio de broadcast (CAS transacional, opt-out, consentimento LGPD, fail-closed) já existem e boa parte já é hardenizada. Achados reais: (1) visibilidade por setor é só de UI, `firestore.rules` não tem noção de `sectorIds`/`isPrivate` — exposição real de confidencialidade de paciente entre setores; (2) dedup de entrada do Baileys é check-then-act (corrida), diferente do dedup atômico já usado pelo Cloud; (3) campanha de aniversário não checa `marketingOptOuts` — mesma classe de bug LGPD já corrigida 2x nesta sessão (broadcasts, automações CRM); (4) FSM de `Conversation` existe mas não tem nenhum chamador (mesmo padrão do FSM de `Transaction` antes do M03.2); (5) "Sequências" de CRM deixa matricular contato mas não tem motor de execução nenhum — feature anunciada sem backend. Código morto real encontrado: `OmnichannelInbox.tsx` (939 linhas, zero importadores) e possivelmente `app/api/webhooks/facebook/route.ts` (precisa confirmação operacional no Meta App Dashboard antes de apagar).
  - **Plano detalhado: `docs/paridade/M07_PLANO_IMPLEMENTACAO.md`** — ordem recomendada: ~~consentimento no aniversário (M07.1)~~ ✅ → ~~dedup atômico no Baileys (M07.2)~~ ✅ → ~~visibilidade por setor no servidor (M07.3)~~ ✅ → ~~aplicar FSM de Conversation (M07.4)~~ ✅ → ~~checkpoints de decisão de produto (M07.5/6/7)~~ ✅ → aceite (M07.8). M07.3 foi a fatia de maior risco desta sessão: achado técnico central de que uma query `list` em tempo real não consegue provar uma regra que cruza `sectorIds` com o perfil do usuário via `get()` — solução foi denormalizar `Conversation.visibleToUserIds` (resolvido em toda escrita relevante + cascata quando setor muda de composição), reescrevendo o listener principal da tela de Conversas (2 queries mescladas pra non-admin) e `firestore.rules`. Não validado via emulador (Java ausente); backfill (`scripts/backfill-conversation-visible-to.ts`) ainda não executado contra dado real — recomendado rodar antes de confiar 100%. M07.4 aplicou `canTransitionConversation` nos 4 write-paths reais que mudam status (UI manual, UI em lote, tool do agente, API v1) + `firestore.rules`; `.parse()` do contrato numa fronteira real foi analisado e deliberadamente adiado (risco de derrubar ingestão de webhook com dado de produção não validado contra o schema). Checkpoints M07.5/6/7 decididos pelo usuário: `OmnichannelInbox.tsx` (código morto confirmado) removido; `app/api/webhooks/facebook/route.ts` aguarda o usuário confirmar no Meta App Dashboard antes de qualquer mudança; Sequências de CRM fica dormente por padrão (mesmo tratamento do PIX/Boleto); bounce de e-mail com `bounceType='unsubscribe'` passou a registrar opt-out automaticamente (consistência com WhatsApp/link de descadastro). Resta só M07.8 (aceite, precisa de tenant real/navegador).
  - WhatsApp, Facebook, Instagram, caixa de entrada, atribuição, setores, snippets e notas internas.
  - Campanhas, listas, aniversário, consentimento, templates, entregabilidade e auditoria.
  - Preservar deduplicação e isolamento de tenant nos webhooks.

### Fase 3 — Gestão e inteligência

- [x] **M08 — Dashboard, Relatórios e Indicadores**
  - Status: `Concluído em 05/09/2026 — M08.1 a M08.6`. Investigação de abertura confirmou o mesmo padrão: `ReportsModule.tsx` (1342 linhas) + uma superfície inteira de agente/analista (`app/api/agent/tools/reports/route.ts`) já são código maduro e real, fechados como item P2.11 de uma auditoria anterior que o roadmap nunca reconciliou. CLAUDE.md §5 ("dashboard: KPIs + heatmap presença") está factualmente errado — o heatmap real é de volume de mensagem por dia×hora e vive em Conversas, não no Dashboard. Achados e correções: (1) **corrigido** — "Comissões por profissional" agrupava por um campo (`createdByName`) que o produtor real de comissão nunca seta, colapsando todos os dentistas numa linha só; agora agrupa por `clientId`/`clientName`; (2) **corrigido** — "Total de clientes"/CLV era rotulado como total mas na verdade era filtrado por período (zerava em períodos curtos) e divergia do agente pra o mesmo relatório; query alinhada ao agente (roster inteiro) e comentário enganoso corrigido; (3) 3 listeners full-collection sem limite no Dashboard, descopados deliberadamente por proporcionalidade (volume ainda pequeno); (4) **construído** — nova aba "CMV & Estoque" (CMV do período via `stockMovements.costTotal`, margem bruta de produtos, valor em estoque, estoque baixo); atribuição de canal explicitamente NÃO construída (só 1 canal ativo hoje, mesmo tratamento do B2B pausado em M02/M03); (5) **corrigido** — 1099 linhas de código morto (`CompactMetricsStrip`/`AgentConsole`/`AnalystChatPanel`/`OperatorChatPanel`) apagadas; (6) **corrigido** — `minRole:'manager'` adicionado a "Relatórios" no Sidebar, alinhado à regra do Firestore.
  - **Plano detalhado: `docs/paridade/M08_PLANO_IMPLEMENTACAO.md`. Fixes: `docs/relatorios/RELATORIOS_M08_1_2_FIXES.md`.**
  - Indicadores confiáveis derivados dos módulos transacionais.
  - Vendas, margem, CMV, estoque, financeiro, clientes, agenda, canais e reputação.
  - Paginação/exportação e reconciliação dos números com as fontes.

- [x] **M09 — Equipe, Permissões e Colaboração**
  - Status: `Concluído em 05/09/2026 (M09.1/M09.2, deployados em produção)`. **Achado crítico já corrigido na mesma sessão, o mais grave de toda a sessão**: `firestore.rules` (`users/{userId}`) não restringia NENHUM campo em `allow update`/`allow create` — qualquer usuário autenticado podia escrever `{role:'founder', businessId:'<qualquer tenant>'}` no PRÓPRIO doc via SDK direto (console do navegador, sem exploit, sem acesso prévio) e ganhar acesso founder a QUALQUER outro negócio, porque toda a autorização do sistema (regras E `lib/utils/verifyAuth.ts` server-side) lê `role`/`businessId` direto desse mesmo documento sem nenhuma outra checagem. **Corrigido** com whitelist de campos auto-editáveis + bloqueio de `role:'founder'` em create + teto de rank em `inviteCodes`. Validado via `firebase deploy --only firestore:rules --dry-run` contra o projeto real (compilou) — primeira vez nesta sessão que uma mudança de rules foi validada contra o compilador de verdade. **DEPLOYADO EM PRODUÇÃO com autorização explícita do usuário** (`firebase deploy --only firestore:rules`, "Deploy complete!") — correção ativa a partir de 05/09/2026. Achado residual documentado, não fechado: create ainda não distingue invite real de businessId forjado pra roles não-founder (exige mudança de app code). Achados adicionais: CLAUDE.md afirma visibilidade por setor em CRM/Financeiro/Snippets que não existe no código (só Conversations/Kanban/Spreadsheets têm o padrão real); nenhum usuário `founder` real provavelmente existe em nenhum tenant criado pelo fluxo normal de signup (sempre vira `admin`).
  - **Plano detalhado: `docs/paridade/M09_PLANO_IMPLEMENTACAO.md`.**
  - Usuários, convites, funções, setores, presença e visibilidade por departamento.
  - Kanban, notas, chat de equipe, planilhas e cofre com autorização consistente.

- [x] **M10 — Automações, Notificações e Eventos de Domínio** 🟠 Prioridade atual (odontologia)
  - Status: `Concluído em 05-08/09/2026 (M10.1 a M10.7); resta só M10.9 (aceite)`. Investigação de abertura (mesmo rigor de M06/M03/M07) confirmou núcleo real em produção — 7 crons vivos (`docker-compose.yml`), bus de eventos de domínio com 3 handlers reais (appointment.completed/canceled/noShow), dedup atômico de webhook, mecanismo de missed-run já usado por aniversário. **Achado crítico, precisa de confirmação do usuário**: existem DOIS inventários de cron divergentes no repo — `docker-compose.yml` (fonte real, self-contained, sem Vercel) vs `vercel.json` (lista os 3 crons de resiliência do Mercado Pago — expire-pix/reconcile/refresh-tokens — que NÃO aparecem no Docker). Evidência de git (crons MP endurecidos DEPOIS da última edição do docker-compose) sugere que esses 3 crons — o código de cron mais bem projetado do repo — provavelmente nunca executam em produção. Achado adicional confirmado morto nos dois inventários: `/api/membership-billing/run` (cobrança de assinatura, totalmente implementado e idempotente) nunca foi agendado em lugar nenhum. Outros gaps: falha de cron é essencialmente invisível (missed-run só cobre aniversário, não o lembrete de atendimento — o job mais crítico pra clínica); automações CRM têm idempotência por episódio só em 1 de 3 triggers state-based; `sendFinancialNotifications` (cobrança) não checa opt-out, diferente dos outros 3 caminhos de envio já corrigidos nesta sessão.
  - **Plano detalhado: `docs/paridade/M10_PLANO_IMPLEMENTACAO.md`** — ordem recomendada: ~~checkpoint de topologia de deploy (M10.1)~~ ✅ → ~~checkpoint membership-billing (M10.2)~~ ✅ → ~~missed-run pro lembrete de atendimento (M10.3)~~ ✅ → ~~idempotência nos 2 triggers CRM restantes (M10.4)~~ ✅ → ~~checkpoint `sendFinancialNotifications`/opt-out (M10.5)~~ ✅ → ~~fix de doc (M10.6)~~ ✅ → ~~purga TTL webhookSeen (M10.7)~~ ✅ → aceite (M10.9). **Decisões do usuário**: só Docker roda em produção (`vercel.json` removido, os 3 crons de resiliência do Mercado Pago — que provavelmente nunca executavam — e `membership-billing/run` foram adicionados ao `docker-compose.yml`); odontologia usa assinaturas; cobrança via WhatsApp/e-mail passa a respeitar `marketingOptOuts`; canal de alerta operacional genérico pro lembrete de atendimento (M10.3 achou que o mecanismo do aniversário não se estende, varredura cross-tenant sem entidade-dona) fica dormente por decisão do usuário. Dead-letter/retry genérico deliberadamente fora de escopo, mesmo tratamento do PIX/Boleto/Sequências. M10.7 (purga TTL de `webhookSeen`) fechado em 08/09/2026 com um cron novo (`app/api/webhooks/cron/purge-seen`). Resta só M10.9 (aceite, precisa de tenant real).
  - Alertas operacionais, lembretes, jobs agendados, eventos entre módulos e reprocessamento.
  - Transformar eventos hoje apenas auditáveis em integrações controladas quando houver caso de uso.
  - Garantir idempotência, tentativas, dead-letter e rastreabilidade.

- [x] **M11 — Agente de IA, API pública e Integrações**
  - Status: `Concluído em 07/09/2026 — M11.0 a M11.6`. Investigação confirmou o mesmo padrão dos demais módulos: agente (Python FastAPI+LangGraph, 6 nós com reflection), RAG, budget diário enforced, circuit breaker, rate limit cross-worker do agente, API v1 (22 rotas, 100% autenticadas), Mercado Pago, Google Calendar e canais WhatsApp/Meta são código real e maduro — nada disso estava "Planejado". Achados e correções: (1) **corrigido** — 16 domínios de tool do agente (+ `send-interactive`, que nunca teve contrato registrado) agora validam request/response via Zod, fechando o gap de payload malformado do LLM chegar sem validação; achou e corrigiu ~10 bugs reais de divergência contrato↔handler no caminho; (2) **corrigido** — `checkBusinessRateLimit` aplicado às 19 rotas de escrita da API v1 que não tinham (300-600/hora por tenant); (3) texto da UI de reindex corrigido (não promete mais cron de 6h inexistente), automação de fato deliberadamente adiada; (5) **corrigido** — cockpit de integrações órfão (8 proxies + UI, 4398 linhas) apagado por decisão do usuário — não era central de conectores tenant-facing, era painel de operações interno do próprio SaaS nunca ligado a nenhum menu; (6) **corrigido** — idempotency-key em `/api/v1/appointments`. Posicionamento da API v1 confirmado com o usuário: interna/automação, não developer-facing pra terceiros. **Atualização 08/09/2026**: M11.1b (porte Python/Pydantic dos 16 domínios restantes, deliberadamente adiado em 07/09) também fechado — lado Python agora valida 21/21 domínios/rotas de tool, mesma cobertura do lado TS.
  - **Plano detalhado: `docs/paridade/M11_PLANO_IMPLEMENTACAO.md`. Fixes: `docs/agente/AGENTE_M11_FIXES.md`.**
  - Contratos de entrada e saída das ferramentas do agente.
  - Permissões, orçamento, memória, RAG e observabilidade.
  - API pública versionada e integrações externas com segredos protegidos no servidor.

### Fase 4 — Produto SaaS e estabilização

- [x] **M12 — Configurações, Onboarding, Planos e Billing**
  - Status: `Concluído em 07/09/2026 — M12.0/M12.1/M12.4/M12.5 + Gap 4`. Investigação confirmou que "Configurações" tem 12 abas reais (não os ~7 conceitos do bullet) e que "modo de uso" (useCase) já é configurável pós-signup (`ModoSistemaTab`) — mas nunca era setado NO signup (3-4 lugares faziam fallback independente). "Onboarding por segmento" não existe como fluxo (nem wizard, nem pergunta no cadastro) — as peças (troca de modo, filtro de sidebar) existem isoladas, nunca conectadas ao cadastro. **Achado maior**: "Planos, limites, cobrança do SaaS" está genuinamente AUSENTE do código — primeira vez nesta iniciativa inteira que "Planejado" é literalmente verdade pra um bullet inteiro (sem campo de plano em `Business`, sem processador de pagamento cobrando o dono do negócio, sem alavanca técnica pra suspender tenant inadimplente). Achado colateral: uma 2ª cópia (dentro de Settings→Enterprise) dos mesmos 8 slots de integração que o M11 já tinha apagado em outro lugar — só Resend tinha uso real, os outros 7 deixavam um admin "conectar" sem efeito nenhum. Decisões do usuário: (1) adiar billing do SaaS (só 1-2 clientes reais hoje, cobrança manual serve); (2) apagar os 7 slots de integração mortos, manter Resend e o toggle Enterprise como está; (3) adiar wizard de onboarding (configuração manual no kickoff resolve na escala atual). **Corrigido independente de checkpoint**: default de `useCase` centralizado (`DEFAULT_USE_CASE`) e setado explicitamente nos 2 fluxos de signup.
  - **Plano detalhado: `docs/paridade/M12_PLANO_IMPLEMENTACAO.md`.**
  - Perfil, empresa, modo de uso, fiscal, canais, usuários, setores e preferências.
  - Onboarding por segmento e ativação apenas dos módulos relevantes ao negócio — deliberadamente adiado.
  - Planos, limites, cobrança do SaaS e experiência de upgrade/downgrade — deliberadamente adiado, documentado como gap real.

- [x] **M13 — Segurança, Desempenho e Preparação para Produção** 🟠 Gate antes de escalar
  - Status: `Concluído em 05/09/2026 (M13.1 a M13.5); M13.4 (paginação de Conversas) fica dormente, baixa prioridade`. Investigação de abertura (mesmo rigor de M06/M03/M07/M10) encontrou 3 auditorias datadas pré-existentes no repo, não só 1: `docs/audit/PRODUCTION_CHECKUP_2026-05-29.md`, `docs/audit/PLANO_LOTE_B_custo_firebase.md`, e um terceiro documento maior nunca citado no roadmap (`docs/auditoria-producao-2026-06-01.md`, 51 achados) + um plano de refatoração nunca executado (`docs/refatoracao-monolitos.md`). Re-verificação linha a linha: a maioria esmagadora dos achados P0/P1 já está corrigida — não por sprint de segurança dedicado, mas como efeito colateral do trabalho de feature de M01/M02/M03/M06/M07 (núcleo comercial, FSM de Transaction/Appointment/Sale, centralização de estoque). **Achado mais sério, novo, não vinha de nenhuma auditoria anterior**: `scripts/wipe-financial.ts` (arquivo não versionado, presente na árvore de trabalho a sessão inteira) é um hard-delete de `transactions`/`cashSessions` por tenant sem dry-run/confirmação/soft-delete/auditoria — combinado com nenhuma estratégia de backup do Firestore verificável no repo, uma execução contra o `businessId` errado seria irrecuperável, com dado real de paciente em produção. Gaps reais restantes (custo, não segurança): lista principal de Conversas ainda sem paginação, `financialAuditLog` do Financeiro clássico (a UI principal confirmada em M03.6) baixa a coleção inteira, `conversationMessages` paga `get()` por mensagem. Zero SDK de observabilidade/APM pra aplicação em si (o proxy read-only do Sentry do tenant citado aqui em 05/09 foi removido em M12 — era 1 dos 7 slots de integração sem consumidor real). Zero runbook de deploy/incidente/rollback.
  - **Plano detalhado: `docs/paridade/M13_PLANO_IMPLEMENTACAO.md`** — ordem recomendada: ~~checkpoint `wipe-financial.ts` (M13.1)~~ ✅ apagado → ~~checkpoint backup/PITR (M13.2)~~ ✅ adiado por decisão do usuário → ~~checkpoint Sentry/APM (M13.3)~~ ✅ adiado por decisão do usuário → paginação de Conversas se priorizada (M13.4) → ~~aceite (M13.5)~~ ✅. M13 fica com o essencial resolvido: o achado mais sério (script de hard-delete sem rede de segurança) foi eliminado; backup/observabilidade têm decisão explícita e documentada de adiamento (risco aceito no volume atual de 1-2 tenants), não lacuna silenciosa. Paginação/custo residual e refatoração de monolitos deliberadamente adiados até haver mais tenants.
  - Auditoria final de regras/índices, autorização, paginação, custos do Firestore e dados sensíveis.
  - Testes de regressão, carga e concorrência dos fluxos críticos.
  - Observabilidade, backups, runbooks, deploy progressivo e plano de rollback.

## Itens do Gestão Raiz que não serão copiados integralmente

- PCP, MRP e ordens de produção industriais.
- Controle de qualidade GMP/ANVISA, FISPQ, laudos e dossiês técnicos.
- Equipamentos industriais, estabilidade e rendimento de fabricação.
- Estoques separados de matéria-prima, embalagem e produto acabado como regra obrigatória.
- MDF-e e logística industrial, até existir demanda real no AEVO.

Partes reutilizáveis desses módulos — como receitas simples, ficha técnica, custo de composição, lote e validade — poderão entrar no M01 ou M02 como recursos opcionais por segmento.

---

# Plano detalhado — M01: Catálogo, Estoque, Fornecedores e Compras

## 1. Resultado esperado

Ao concluir o M01, o AEVO deverá possuir uma fonte confiável e auditável para produtos, custos e saldos. Uma compra poderá entrar por XML ou cadastro assistido, vincular/criar fornecedor e produtos, atualizar estoque e custo, e opcionalmente gerar o compromisso financeiro sem duplicidade.

O módulo deve atender varejo, alimentação e serviços com venda de produtos, sem exigir conceitos industriais.

## 2. Estado atual confirmado

### O que o AEVO já faz bem

- Catálogo multi-tenant com produto, SKU, código de barras, categoria, unidade, custo, preço e campos fiscais.
- Cardápio, disponibilidade, categorias de menu, restrições alimentares e modificadores.
- Produto composto por `components[]` com expansão de BOM de um nível.
- Modificadores que podem consumir insumos vinculados.
- Movimentações manuais, histórico paginado, alertas de estoque mínimo e sincronização em tempo real.
- Baixa e restauração de estoque integradas com PDV e pedidos.
- Importação de XML de NF-e de compra, tentativa de match por SKU/nome e cálculo de custo médio.
- Contratos Zod para Product, PurchaseNote e StockMovement.
- Fornecedores disponíveis no domínio e nas ferramentas do agente.

### Lacunas e riscos encontrados no AEVO

1. `InventoryModule.tsx` concentra interface, upload, CRUD e orquestração de estoque em um arquivo grande.
2. `ComprasModule.tsx` interpreta XML e executa regras críticas diretamente no cliente.
3. A proteção contra importação duplicada depende de estado lido pelo cliente; dois usuários podem iniciar a entrada simultaneamente.
4. Entrada de estoque, atualização do custo e mudança do status da nota acontecem em etapas separadas.
5. O contrato exige rastreabilidade por movimentos, mas o fluxo atual não persiste todos os identificadores esperados na nota.
6. Parte do estoque usa SDK cliente com `previousStock/newStock` de melhor esforço; a auditoria exata existe apenas em caminhos server-side.
7. Ainda há caminhos cliente e servidor distintos para operações de estoque, aumentando o risco de divergência.
8. Não existe uma tela operacional completa de fornecedores, apesar da coleção e da ferramenta do agente existirem.
9. O match de itens da NF-e é limitado; falta uma etapa explícita de `vincular`, `criar` ou `ignorar` por item.
10. Faltam custo de aquisição completo, rateio de frete/seguro/desconto/impostos e vínculo consistente com contas a pagar.
11. Exclusão física de produto pode quebrar histórico e referências de vendas, pedidos, receitas ou movimentos.
12. Produtos com variações, múltiplas imagens e lotes/validade ainda não possuem um modelo final coerente para todos os segmentos.

### Referências úteis já validadas no Gestão Raiz

- CRUD e paginação de produtos e fornecedores por tenant.
- Múltiplas imagens, variações, visibilidade e estados de produto.
- Fornecedor com condições de pagamento, prazo de entrega, pedido mínimo e múltiplo de compra.
- Importação manual e sincronização de documentos recebidos na SEFAZ.
- Chave de acesso como proteção contra duplicidade.
- Criação/atualização automática de fornecedor a partir da NF-e.
- Classificação de documento, edição dos itens antes da entrada e match manual.
- Claim/lock de importação, idempotência, reimportação controlada e reversão auditada.
- Rateio de custos acessórios e cálculo de custo médio ponderado.
- Conversão de unidades de compra para unidade de estoque.
- Criação opcional de conta a pagar ou baixa em conta bancária quando a compra já foi paga.
- Lotes, validade e rastreabilidade; no AEVO isso será opcional e simplificado.

## 3. Decisões de escopo

### Portar

- Idempotência forte da entrada de compras.
- Fornecedor operacional e auto-vínculo por CNPJ.
- Match manual de itens e criação assistida de produto.
- Custo médio ponderado e custo de aquisição rateado.
- Conversão de unidade de compra para unidade de estoque.
- Integração opcional com contas a pagar/conta bancária.
- Histórico auditável e reversão controlada.

### Adaptar

- Lotes e validade como recurso opcional por produto/segmento.
- Variações para varejo sem reproduzir a separação industrial de estoques.
- Receita/ficha técnica simples aproveitando o BOM já existente.
- Sincronização SEFAZ somente para empresas com configuração fiscal compatível.

### Manter do AEVO

- Cardápio, modificadores, disponibilidade para delivery e atributos alimentares.
- Integração de estoque com pedidos, Mercado Pago e restauração por estorno.
- Tempo real para catálogo e alertas operacionais.
- Separação de serviços e produtos; serviço não deve virar produto artificialmente.

### Não aplicar agora

- Quarentena e liberação por controle de qualidade industrial.
- Laudos, FISPQ, GHS e qualificação regulatória de fornecedor.
- FEFO obrigatório para todo o catálogo e rastreabilidade industrial completa; no AEVO ele só vale para produtos opt-in.
- Múltiplos depósitos/filiais; será tratado apenas quando o produto suportar multi-location.

## 4. Arquitetura-alvo

```text
UI de Catálogo / Fornecedores / Compras
                │
                ▼
Rotas autenticadas e validadas por Zod
                │
                ▼
Serviços de domínio
  ├── catálogo e variações
  ├── fornecedores
  ├── estoque e movimentos
  ├── importação de compras
  └── custos e integração financeira
                │
                ▼
Firestore por businessId
  products | suppliers | purchaseNotes | stockMovements | stockLots
                │
                ├── transactions / bankAccounts
                └── notifications / domainEvents
```

Regras críticas de escrita devem executar no servidor. A interface pode manter listeners em tempo real, mas não deve ser a autoridade para decidir se uma nota pode ser importada ou qual é o saldo definitivo.

## 5. Etapas de implementação

### M01.0 — Baseline e testes de caracterização ✅

- [x] Documentar todos os campos usados de `products`, `stockMovements`, `purchaseNotes` e `suppliers`.
- [x] Mapear todos os escritores de `currentStock` no AEVO.
- [x] Mapear consumidores: PDV, pedidos, cardápio, fiscal, financeiro, agente e API v1.
- [x] Criar testes de caracterização dos fluxos atuais antes de mover regras.
- [x] Capturar fixture inicial de NF-e com produto simples, unidade divergente, desconto, frete e impostos. Casos adicionais ficam para M01.5.

**Saída:** mapa de dependências e suíte que detecta regressões do comportamento atual.

### M01.1 — Contratos e modelo de dados ✅

- [x] Definir `ProductV2Schema`, mantendo leitura compatível com documentos atuais.
- [x] Definir estratégia para produto simples, produto com variação e produto composto.
- [x] Formalizar `trackStock`, unidade de compra, fator de conversão, custo atual e custo médio.
- [x] Definir múltiplas imagens sem quebrar o campo legado `imageUrl`.
- [x] Definir `SupplierSchema` e normalização única de CPF/CNPJ.
- [x] Evoluir `PurchaseNoteSchema` com estados de processamento, claim e rastreabilidade.
- [x] Evoluir `StockMovementSchema` com `sourceType`, `sourceId`, `idempotencyKey` e saldo exato.
- [x] Definir `schemaVersion` e política de campos legados.

**Saída:** contratos Zod, tipos derivados e documento de migração.

### M01.2 — Núcleo server-side de estoque ✅

- [x] Criar uma operação server-side única para entrada, saída, ajuste e restauração.
- [x] Ler saldo dentro de transação e registrar `previousStock/newStock` exatos.
- [x] Gravar produto e movimento na mesma transação.
- [x] Validar tenant de todos os produtos e referências antes de escrever.
- [x] Preservar expansão de BOM e consumo de modificadores.
- [x] Adicionar chave idempotente por origem para impedir movimentos duplicados.
- [x] Impedir estoque negativo nos fluxos configurados para controle rígido.
- [x] Centralizar alertas de estoque mínimo e esgotamento.
- [x] Migrar gradualmente os chamadores cliente para as rotas server-side.

**Saída:** uma única regra confiável de saldo para Compras, PDV e Pedidos.

### M01.3 — Catálogo de produtos

- [x] Extrair persistência e upload do componente visual para serviços/rotas.
- [x] Validar unicidade de SKU e código de barras dentro do `businessId`.
- [x] Implementar inativação/arquivamento em vez de exclusão física de item referenciado.
- [x] Preservar produto simples, receita/BOM, cardápio e modificadores.
- [x] Adicionar múltiplas imagens de forma compatível.
- [x] Adicionar variações para os segmentos que necessitam, com SKU, código, preço e estoque próprios.
- [x] Melhorar categorias, filtros, importação/exportação e paginação do catálogo.
- [x] Exibir margem, custo, saldo, estoque mínimo e origem da última atualização.
- [x] Manter o modo planilha, ajustando-o aos novos contratos.

**M01.3a concluído:** núcleo compartilhado pela UI, API v1 e agente; claims de SKU/código por tenant; upload autenticado; estoque inicial auditável; soft archive; indicadores e planilha V2.

**M01.3b concluído:** editor de até oito imagens, variações com saldo auditável, categorias livres, importação CSV com relatório por linha e paginação server-side. Detalhes em `docs/paridade/M01_CATALOGO_PRODUTOS.md`.

**Saída:** catálogo modular, seguro e adequado a varejo/alimentação.

### M01.4 — Fornecedores

- [x] Criar módulo/tela de fornecedores acessível pelo menu de Compras.
- [x] Implementar listar, buscar, criar, editar, inativar e visualizar histórico.
- [x] Reutilizar um serviço único entre UI, API e agente.
- [x] Incluir razão social, fantasia, CNPJ/CPF, contatos, endereço e observações.
- [x] Incluir condições de pagamento, prazo médio, pedido mínimo e múltiplo de compra como campos opcionais.
- [x] Relacionar fornecedor com notas, produtos e movimentações de compra.
- [x] Impedir duplicidade por documento normalizado dentro do tenant.

**M01.4 concluído:** núcleo transacional V2, claims de documento por tenant, trilha de auditoria, tela operacional em Compras e relações com notas, produtos e movimentos. Detalhes em `docs/paridade/M01_FORNECEDORES.md`.

**Saída:** cadastro operacional de fornecedores conectado ao fluxo de compras.

### M01.5 — Importação de compras

- [x] Mover parsing e validação decisiva do XML para o servidor.
- [x] Validar chave de acesso, emitente, destinatário, totais e itens.
- [x] Armazenar o XML original com acesso autorizado e trilha de auditoria.
- [x] Criar ou atualizar fornecedor pelo documento da NF-e.
- [x] Apresentar para cada item as ações `vincular`, `criar produto` ou `ignorar`.
- [x] Sugerir match por código do fornecedor, SKU, GTIN, NCM e nome normalizado.
- [x] Permitir corrigir unidade/fator, quantidade de estoque, custo, lote e validade antes de confirmar.
- [x] Implementar claim transacional para impedir duas importações simultâneas.
- [x] Usar movimentos determinísticos/idempotentes por nota e item.
- [x] Criar produtos solicitados com identificador determinístico pelo núcleo do catálogo.
- [x] Atualizar custo médio ponderado com frete, seguro, desconto, ST, IPI e outras despesas rateadas.
- [x] Gravar `stockMovementIds` e resultado item a item na nota.
- [x] Suportar resultado completo, parcial e falha recuperável.
- [x] Implementar cancelamento controlado da entrada e recuperação/reprocessamento dos itens com erro.
- [x] Definir reversão controlada sem apagar histórico.

**M01.5a concluído:** preparação server-side, validação do destinatário e da estrutura fiscal, XML privado com hash, fornecedor V2, rateio preliminar e sugestões de produto. O plano e as próximas subetapas estão em `docs/paridade/M01_IMPORTACAO_COMPRAS.md`.

**M01.5b concluído:** editor por item com vínculo/criação/descarte explícitos, variações, conversão, custo e lote; revisão validada e persistida no servidor; retomada de rascunho e bloqueio do lançamento legado para notas V2.

**M01.5c concluído:** claim transacional com expiração, criação determinística de produtos, movimento idempotente por linha, custo médio atômico e fechamento completo/parcial/falha com rastreabilidade individual.

**M01.5d concluído:** retentativa exclusiva dos itens com erro usando as mesmas chaves; cancelamento da entrada por movimentos compensatórios; restauração de saldo/custo com memória exata; bloqueio seguro diante de dependências posteriores; interface e agente no mesmo núcleo autenticado.

**Saída:** entrada de compra repetível com segurança, sem duplicar saldo ou custo.

### M01.6 — Integrações financeira, fiscal e operacional

- [x] Oferecer criação de conta a pagar usando o valor total real da NF-e.
- [x] Suportar compra já paga com seleção obrigatória da conta debitada.
- [x] Vincular transação financeira à nota e ao fornecedor.
- [x] Evitar duplicidade de lançamentos em reprocessamentos.
- [x] Integrar consulta/sincronização de NF-e recebidas quando o fiscal estiver configurado.
- [x] Emitir eventos auditáveis de compra importada, estoque alterado e custo atualizado.
- [x] Disponibilizar as mesmas capacidades autorizadas para o agente e API v1.

**M01.6a concluído:** integração financeira idempotente e transacional, com conta a pagar, compra paga, débito bancário atômico, reversão auditável e ação na tela de Compras. Detalhes em `docs/paridade/M01_INTEGRACOES_COMPRAS.md`.

**M01.6b concluído:** eventos de compra determinísticos e atômicos, consulta e vínculo financeiro no agente, API v1 com ações idempotentes e escopos próprios de compras combinados aos escopos sensíveis de estoque/financeiro.

**M01.6c concluído:** caixa fiscal isolada por tenant, sincronização incremental com cursor NSU protegido, diagnóstico de CNPJ/certificado/ambiente/provedor, manifestação e download opcionais e preparação explícita pelo mesmo parser e claim de chave do upload manual.

**Saída:** compra refletida corretamente em estoque, custo e financeiro, com recebimento fiscal controlado e sem efeitos automáticos.

### M01.7 — Lotes e validade opcionais

- [x] Adicionar configuração por produto `trackLots`/`trackExpiry`.
- [x] Criar lote na entrada quando o recurso estiver habilitado.
- [x] Guardar fornecedor, nota, quantidade inicial/atual, custo e validade.
- [x] Alertar produtos próximos do vencimento.
- [x] Permitir baixa por lote em fluxo simplificado quando necessário.
- [x] Não incluir quarentena, laudos ou qualidade industrial nesta etapa.

**M01.7 concluído:** rastreamento opt-in por produto, saldo transacional em `stockLots`, entrada integrada à NF-e, baixa automática FEFO ou lote explícito, bloqueio de lote vencido em fluxos comerciais, descarte manual e restauração exata no cancelamento. A tela de Estoque reúne alertas e saldos ativos. Detalhes em `docs/paridade/M01_LOTES_VALIDADE.md`.

**Saída:** rastreabilidade leve para alimentação, cosméticos, farmácia e varejo perecível.

### M01.8 — Migração, segurança e desempenho

- [x] Criar migração idempotente para documentos legados.
- [x] Fazer backfill de `schemaVersion`, campos normalizados e referências possíveis.
- [x] Preservar `imageUrl`, `currentStock` e demais campos usados pelos módulos atuais durante a transição.
- [x] Atualizar Firestore Rules para todos os novos caminhos e negar writes críticos diretos do cliente.
- [x] Criar/validar índices para listas, busca, movimentos e notas.
- [x] Paginar produtos, movimentos, fornecedores e notas sem listeners ilimitados.
- [x] Adicionar logs estruturados e correlação por operação/idempotency key.
- [x] Tornar o dry-run obrigatório como primeira etapa operacional, sem qualquer escrita no modo padrão.

**M01.8 concluído em código:** migrador por tenant com validação V2, claims, checkpoints, backup e rollback; paginação por cursor para movimentos/notas; regras e índices; logs JSON correlacionados. A execução em produção é deliberadamente externa ao deploy e deve seguir o runbook por tenant. Detalhes em `docs/paridade/M01_MIGRACAO_SEGURANCA.md`.

**Saída:** dados existentes preservados e custo operacional controlado.

### M01.9 — Testes e validação

- [x] Testes unitários dos schemas, conversões, custo médio, rateio e BOM.
- [x] Testes de integração das transações de estoque.
- [x] Teste concorrente: duas vendas disputando o último item.
- [x] Teste concorrente: dois usuários importando a mesma NF-e.
- [x] Testes de isolamento entre dois `businessId`.
- [x] Testes de entrada, ajuste, venda, cancelamento e estorno.
- [x] Testes de compra completa, parcial, reprocessada e revertida.
- [x] Testes da integração financeira e prevenção de duplicidade.
- [x] Smoke estrutural automatizado das telas de Catálogo, Estoque, Fornecedores, Compras, PDV e Pedidos.
- [x] Criar auditoria read-only para comparar produtos, variações e lotes antes/depois por `businessId`.
- [ ] Executar o smoke manual e a comparação antes/depois em uma base de homologação.

**M01.9 concluída em código:** cenários concorrentes reais, matriz de cobertura, smoke estrutural e auditoria read-only antes/depois. O aceite operacional não foi antecipado: execução em homologação, checklist manual e validação de regras/índices continuam pendentes. Detalhes em `docs/paridade/M01_VALIDACAO_ACEITE.md`.

**Saída:** evidência objetiva de que o módulo está pronto para uso real.

## 6. Ordem de entrega recomendada

1. M01.0 — baseline e caracterização.
2. M01.1 — contratos e compatibilidade.
3. M01.2 — núcleo server-side de estoque.
4. M01.4 — fornecedores.
5. M01.5 — importação de compras.
6. M01.6 — financeiro/fiscal.
7. M01.3 — evolução visual e funcional do catálogo.
8. M01.7 — lotes/validade opcionais.
9. M01.8 — migração, regras e desempenho.
10. M01.9 — validação final e aceite.

O núcleo de estoque vem antes das novas telas porque todos os demais fluxos dependem dele. A evolução visual do catálogo pode começar depois que os contratos estiverem estáveis, sem bloquear fornecedores e compras.

## 7. Critérios para marcar M01 como concluído

- [x] Não existe alteração de saldo sem `StockMovement` correspondente nos fluxos migrados.
- [x] Saldos anterior e posterior são exatos nos caminhos críticos.
- [x] Repetir a mesma operação idempotente não altera o saldo novamente.
- [x] Dois usuários não conseguem importar a mesma NF-e simultaneamente.
- [x] Produto, fornecedor, nota, movimentos e financeiro permanecem no mesmo tenant.
- [x] Compra atualiza custo pelo método definido e deixa memória de cálculo auditável.
- [x] Fornecedor pode ser operado pela interface, API autorizada e agente usando a mesma regra de domínio.
- [x] Dados legados continuam legíveis durante e depois da migração em código.
- [x] PDV, Pedidos e Cardápio possuem cobertura automatizada contra regressão estrutural.
- [ ] Testes automatizados, smoke tests e checklist manual estão aprovados.
- [ ] Regras e índices do Firestore foram validados no ambiente de homologação.
- [x] Documentação arquitetural foi atualizada.

## 8. Riscos e controles

| Risco | Controle planejado |
|---|---|
| Duplicar saldo ao importar nota | Claim transacional + chave idempotente por nota/item |
| Quebrar PDV/Pedidos ao mudar Product | Leitura compatível + migração gradual + testes de caracterização |
| Divergir estoque cliente/servidor | Escrita crítica única no servidor; listeners apenas para leitura |
| Misturar tenants | Validação de `businessId` em cada referência e teste com dois tenants |
| Perder histórico ao excluir produto | Arquivamento e bloqueio de exclusão quando houver referência |
| Gerar financeiro duplicado | Chave determinística vinculada à nota e verificação transacional |
| Aumentar custos do Firestore | Paginação, índices e listeners limitados |
| Levar complexidade industrial ao AEVO | Lotes/validade opcionais; qualidade industrial fora de escopo |

## 9. Dependências do próximo módulo

O M02 — Vendas, PDV, Pedidos e Cardápio — só deve iniciar sua implementação estrutural após a estabilização de:

- contratos de produto;
- operação server-side de baixa/restauração;
- idempotency key de movimentos;
- modelo de variações/BOM;
- política de estoque negativo;
- compatibilidade dos dados legados.

Essas dependências estão concluídas em código na M01. O aceite operacional da M01 em homologação continua pendente e não será confundido com conclusão funcional da M02.

---

# Acompanhamento — M02: Vendas, PDV, Pedidos e Cardápio

O inventário, o diagnóstico e o plano completo estão em `docs/paridade/M02_PLANO_IMPLEMENTACAO.md`.

- [x] **M02.0 — Baseline e caracterização** — mapa, fixtures, testes e auditoria read-only concluídos.
- [x] **M02.1 — Contratos, cotação e preço autoritativo** — contratos V2, adaptadores legados, preço em centavos e fronteiras server-side concluídos.
- [x] **M02.2 — Coordenador de operação comercial** — checkpoints, replay, efeitos determinísticos, estoque M01 e compensação concluídos.
- [x] **M02.3 — PDV e venda de serviços** — preço autoritativo, pagamentos por alocação, estoque, cliente, comissão e estados operacionais concluídos.
- [x] **M02.4 — Cupons, gift cards e fidelidade** — ledgers determinísticos de cupom, gift card e fidelidade integrados ao coordenador comercial concluídos.
- [ ] **M02.5 — Delivery, cardápio e agente** — M02.5a (cardápio público), M02.5b (pedido manual), M02.5c (agente) e M02.5d (FSM central de transições/efeitos, incluindo bloqueio de edição pós-efeito) concluídas; M02.5e (`variantId`) e M02.5f (Mercado Pago com `operationId`) ⚪ **pausadas — restaurante, não é foco odontologia agora**.
- [ ] **M02.6 — Venda B2B e condicional** ⚪ pausado — restaurante/varejo, não é foco odontologia agora.
- [ ] **M02.7 — Cancelamento, devolução e reembolso** ⚪ pausado — idem.
- [ ] **M02.8 — Experiência e desempenho comercial** ⚪ pausado — idem.
- [ ] **M02.9 — Migração, regras e observabilidade** ⚪ pausado — idem.
- [ ] **M02.10 — Testes, homologação e aceite** ⚪ pausado — idem.

Decisões estruturais da M02:

- preservar `sales`, `deliveryOrders` e `orders`, sem merge destrutivo;
- compartilhar contratos, cotação, coordenador e efeitos server-side;
- migrar por canal, começando pelo PDV;
- reverter estoque pelos movimentos/lotes originais, não pelo catálogo mutável;
- preservar cardápio, modificadores, cupons, gift cards, fidelidade e Mercado Pago do AEVO.

---

## Histórico de decisões

| Data | Decisão | Motivo |
|---|---|---|
| 25/08/2026 | Usar o Gestão Raiz como referência, não como código-fonte para cópia direta | Os produtos têm públicos e arquiteturas distintas |
| 25/08/2026 | Começar por Catálogo, Estoque, Fornecedores e Compras | É a base transacional de vendas, custos, financeiro e fiscal |
| 25/08/2026 | Manter recursos industriais fora do núcleo do AEVO | Evitar complexidade sem demanda de pequenos negócios |
| 25/08/2026 | Tratar lote/validade como capacidade opcional | Há valor para alguns segmentos sem exigir processo industrial |
| 26/08/2026 | Cancelar entrada de compra por compensação, sem excluir movimentos | Preservar auditoria e impedir restauração insegura de saldo/custo |
| 28/08/2026 | Não inventar validade quando a NF-e não a informa | Produto com `trackExpiry` exige uma data real; ausência vira pendência operacional |
| 28/08/2026 | Usar FEFO apenas para lotes válidos e devolver cancelamentos ao lote original | Evita vender vencidos e mantém produto, lote e ledger conciliados |
| 28/08/2026 | Exigir migração M01 por tenant, com dry-run padrão, confirmação textual e backup reversível | Evita varredura global, sobrescrita de conflitos e publicação prematura das regras restritivas |
| 28/08/2026 | Preservar `sales`, `deliveryOrders` e `orders` na M02, unificando regras por um núcleo comercial e adaptadores | Evita migração destrutiva e mantém as diferenças reais entre PDV, delivery e B2B |
| 28/08/2026 | Migrar a M02 por canal, começando pelo PDV | O PDV já possui entrada server-side e oferece a menor superfície para validar o núcleo comum |
| 28/08/2026 | Tratar preço do cliente, contrato público divergente e ausência comercial de variações como lacunas explícitas do baseline M02 | Impede que a migração altere comportamento sem teste ou esconda riscos já existentes |
| 29/08/2026 | Calcular a cotação comercial em centavos e aceitar apenas IDs/quantidades como intenção do cliente | Elimina confiança em snapshots adulteráveis e cria resultado uniforme para todos os canais |
| 29/08/2026 | Manter a cotação sem escrita e adiar a migração dos canais até existir `commercialOperations` | Evita trocar os escritores antes de haver checkpoints, replay seguro e recuperação de falhas |
| 29/08/2026 | Coordenar operações comerciais por checkpoints e IDs determinísticos, mantendo os documentos legados por canal | Permite retomar falhas sem repetir estoque ou dinheiro e prepara uma migração gradual começando pelo PDV |
| 29/08/2026 | Criar um lançamento financeiro legado determinístico por alocação aplicável do PDV e registrar pagamento, financeiro, estoque e fiscal separadamente | Preserva pagamentos divididos e diferidos agora, sem antecipar a consolidação do contas a receber da M03 |
| 29/08/2026 | Resolver preço, nome, desconto permitido e comissão no servidor, ignorando a taxa de comissão enviada pelo navegador | Impede adulteração do checkout e mantém as regras vinculadas ao tenant e ao usuário autenticado |
| 01/09/2026 | Fatiar a M02.5 (público/manual/agente/FSM/variantId/Mercado Pago) começando pelo cardápio público | O canal site já tinha a lógica mais madura (zona, horário, modificadores, cupom, gift card, tracking) e testes de caracterização prontos, reduzindo o risco da primeira migração |
| 01/09/2026 | Unificar o estoque de insumo/modificador do delivery com a regra do PDV (bloqueia saldo negativo), aceitando a rejeição de pedidos que hoje passariam | Duas regras diferentes de estoque por canal era exatamente o risco que a M02 existe para eliminar; a divergência só foi percebida ao migrar um canal com frete |
| 01/09/2026 | Gift card do delivery passa a falhar de forma dura em corrida, dentro do mesmo checkpoint transacional do cupom | Elimina o ledger paralelo de gift card do site e a inconsistência de hoje (cupom já falhava duro, só gift card era "melhor esforço") |
| 01/09/2026 | Pedido manual: zona de entrega configurada é sempre autoritativa; atendente só propõe taxa quando nenhuma zona resolve o endereço, e só com permissão de gerente+ | Preserva a flexibilidade real do balcão/telefone (endereço fora de área configurada) sem abrir mão de que uma zona bem definida nunca seja sobrescrita por digitação |
| 01/09/2026 | Pedido manual: estoque insuficiente passa a bloquear a criação, igual PDV/cardápio (antes era só aviso) | Consistência entre os três canais é o objetivo central da M02; decisão confirmada com o usuário |
| 01/09/2026 | Remover a capacidade do agente de IA de aplicar desconto manual ou taxa de entrega livre, em vez de só restringir | O contrato hoje permite qualquer valor sem revisão humana — um vetor real de manipulação via conversa (prompt injection); negociação real de desconto passa a exigir escalar para um humano (pedido manual, gerente+) |
| 01/09/2026 | Centralizar transições de status de deliveryOrders num único serviço server-side, reaproveitado pela UI e pelo agente | Duas implementações independentes já haviam divergido de verdade (fidelidade ausente no agente, exclusão sem FSM na UI, restauro de estoque mais fraco na UI) — a duplicação deixou de ser só estilo de código e virou bug real |
| 03/09/2026 | Pausar a sequência formal a partir de M02.5e e priorizar M06/M04/M03/M07/M10/M13 pela lente da odontologia; restaurante de hotel recebe só o mínimo funcional | Dois clientes pagantes reais definem a prioridade agora, não a ordem original do roadmap; a odontologia é o foco confirmado, o restaurante não deve consumir mais esforço sem pedido explícito. Classificação completa de relevância por módulo na seção "Prioridade atual" |
