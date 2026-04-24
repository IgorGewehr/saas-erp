# Aevo — Pre-Production Checklist

**Proposito:** Bateria de verificacoes a serem executadas antes de enviar o app para producao.
**Ultima atualizacao:** 2026-04-23

> Cada secao e uma checagem independente. Marque com [x] conforme for verificando.
> Execute na ordem: Seguranca → Dados → CRUD → UI → Performance → Integracao → Acessibilidade → Deploy

---

## 1. SEGURANCA & MULTI-TENANT (Critica — fazer primeiro)

> Falhas aqui podem expor dados de um tenant para outro. Prioridade maxima.

### 1.1 Isolamento de Dados (businessId)

- [ ] **Todas as queries Firestore** tem `where('businessId', '==', business.id)` — auditar CADA modulo:
  - [ ] Dashboard — queries de appointments, sales, transactions
  - [ ] Agenda — appointments CRUD
  - [ ] PDV — sales, products, stock movements
  - [ ] Financeiro — transactions, bank accounts
  - [ ] Estoque — products, stock movements
  - [ ] CRM — crmContacts, crmDeals, activities
  - [ ] Kanban — kanbanBoards, kanbanCards
  - [ ] Conversas — conversations, messages
  - [ ] Fiscal — fiscalDocuments
  - [ ] Relatorios — todas as queries de leitura
  - [ ] Configuracoes — inviteCodes, sectors, users (verificar scope)
  - [ ] Notas — notes (query so por businessId, filtro scope/authorId client-side)
  - [ ] Senhas — passwordVaultEntries (via admin SDK no server, businessId validado na API route)
  - [ ] Notificacoes — notifications (userId + businessId filter)
  - [ ] Formularios — formTemplates, formResponses (businessId filter)
  - [ ] Reviews — reviews (businessId filter, POST publico rate-limited)
  - [ ] Automacoes CRM — automationRules (businessId filter)
  - [ ] Conciliacao — bankStatementImports, reconciliationItems (businessId filter)
  - [ ] Memberships — memberships, clientMemberships (businessId filter)
  - [ ] Calendar Sync — calendarSyncTokens (server-only via Admin SDK)
- [ ] **Todas as criações de documento** incluem `businessId` no payload
- [ ] **Nenhuma query** usa collection group sem filtro de businessId
- [ ] **API Routes** (`app/api/`) validam businessId em TODAS as rotas
- [ ] **Firestore Rules** no console Firebase — verificar se regras existem e estao corretas
- [ ] **CRITICO:** Deploy das Firestore Rules para colecao `notes` — executar `firebase deploy --only firestore:rules`

### 1.2 Isolamento de Notas Pessoais

- [ ] Nota com `scope: 'personal'` de usuario A **nao aparece** para usuario B do mesmo business
- [ ] Nota com `scope: 'team'` aparece para todos os membros do business
- [ ] Regra Firestore: `resource.data.authorId == request.auth.uid` bloqueia leitura cruzada de notas pessoais

### 1.3 Autenticacao & Autorizacao

- [ ] Paginas protegidas redirecionam para `/login` quando nao autenticado
- [ ] Pagina de login nao permite acesso a `/app` quando nao autenticado
- [ ] `useAuth()` retorna `isLoading: true` durante carregamento (sem flash de conteudo)
- [ ] Roles sao verificados antes de exibir acoes restritas:
  - [ ] Settings: abas empresa/fiscal/usuarios/setores/enterprise so para admin/founder
  - [ ] Geração de invite codes: so admin/founder
  - [ ] Exclusao de empresa: so founder
  - [ ] Senhas/Cofre: acesso restrito a admin/founder
  - [ ] Kanban: arquivar/restaurar/excluir coluna restrito a manager+
- [ ] Invite codes expiram corretamente (verificar `expiresAt` no signup)
- [ ] Invite codes marcados como `isActive: false` apos uso
- [ ] `ROLE_HIERARCHY` verificado com `>=` (nunca string comparison)

### 1.4 Dados Sensiveis

- [ ] **Nenhuma API key** hardcoded no frontend (verificar com `grep -r "sk_live\|sk-ant\|ghp_\|re_" app/`)
- [ ] `.env` e `.env.local` estao no `.gitignore`
- [ ] API keys de integracoes passam por rotas server-side (`app/api/integrations/`)
- [ ] `saasApiKeys` armazena `keyHash` (SHA-256), nunca plaintext
- [ ] **Senhas/Cofre:** `encryptedPassword` usa AES-256-GCM, nunca exposto via `/list` (campo stripado, so via `/reveal`)
- [ ] **Senhas/Cofre:** `/reveal` loga acesso em `lastAccessedAt` e incrementa `accessCount`
- [ ] Firebase config usa `NEXT_PUBLIC_` prefix apenas para variaveis publicas
- [ ] Nenhum `console.log` expoe dados sensiveis em producao
- [ ] Meta/WhatsApp tokens nao sao logados

### 1.5 Validacao de Input

- [ ] CPF/CNPJ validados com `validateCPF`/`validateCNPJ` antes de salvar
- [ ] Emails validados (formato basico) antes de operacoes de auth
- [ ] Valores monetarios nunca usam `parseFloat` de input do usuario sem validacao
- [ ] Campos de texto sanitizados contra XSS (React ja escapa por padrao, mas verificar `dangerouslySetInnerHTML`)
- [ ] Upload de arquivos: limite de tamanho verificado antes de upload ao Storage
- [ ] Nomes de arquivo de upload sanitizados (sem path traversal)

---

## 2. INTEGRIDADE DE DADOS

### 2.1 Transacoes Atomicas

- [ ] **PDV → confirmSale**: venda + deducao estoque + transacao financeira + fidelidade + gift card — tudo atomico ou com rollback
- [ ] **Loyalty**: `addLoyaltyPoints` e `redeemLoyaltyPoints` usam `runTransaction` com ref criado FORA da transacao
- [ ] **Gift Card**: `redeemGiftCard` usa `runTransaction`, valida status e saldo dentro da transacao
- [ ] **Comissoes**: `maybeCreateCommission` nao cria duplicada (verificar idempotencia)
- [ ] **Parcelas**: batch write de N parcelas — verificar se todas sao criadas ou nenhuma

### 2.2 Consistencia de Estado

- [ ] PDV: ao cancelar venda, estoque e revertido? Gift card redemptions sao revertidas?
- [ ] Agenda: ao cancelar agendamento concluido, comissao e cancelada/revertida?
- [ ] Financeiro: deletar transacao nao deixa orfaos (parcelas vinculadas)
- [ ] CRM: deletar contato limpa deals e atividades vinculados?
- [ ] Kanban: deletar board limpa cards vinculados?
- [ ] Kanban: restaurar board arquivado restaura com colunas e cards intactos
- [ ] Gift card: status muda para 'used' quando `remainingValue <= 0`
- [ ] Gift card: status muda para 'expired' quando `expiresAt < now`
- [ ] Loyalty: `balanceAfter` nunca fica negativo
- [ ] `createdAt` e `updatedAt` sao sempre ISO strings (nunca Timestamp do Firestore)

### 2.3 Campos Obrigatorios

- [ ] Todo documento tem `businessId`
- [ ] Todo documento tem `createdAt` e `updatedAt`
- [ ] Users tem `role` valido (founder/admin/manager/operator/viewer)
- [ ] Sales tem `payments[]` com soma igual ao total
- [ ] Transactions tem `amount > 0` e `type` valido
- [ ] Appointments tem `date`, `startTime`, `status` validos
- [ ] Products tem `currentStock >= 0`
- [ ] Notes tem `authorId`, `scope` ('personal'|'team'), `content` nao vazio
- [ ] passwordVaultEntries tem `title` (senha e opcional — campo `encryptedPassword` pode estar ausente)

---

## 3. CRUD — Operacoes por Modulo

> Para cada modulo, verificar CREATE, READ, UPDATE, DELETE funciona corretamente.

### 3.1 Dashboard
- [ ] KPIs carregam sem erro com dados vazios (business novo)
- [ ] KPIs carregam corretamente com dados existentes
- [ ] Graficos renderizam sem erro quando nao ha dados

### 3.2 Agenda
- [ ] Criar agendamento: salva todos os campos, aparece no calendario
- [ ] Editar agendamento: atualiza status, horario, profissional
- [ ] Cancelar agendamento: muda status, reverte comissao se concluido
- [ ] Concluir agendamento: cria comissao automatica, acumula pontos fidelidade
- [ ] Servicos: CRUD no ServiceManagementDialog, campo commissionRate salva
- [ ] Filtro por profissional funciona
- [ ] Visualizacoes: dia/semana/mes todas renderizam

### 3.3 PDV
- [ ] Busca de produtos/servicos funciona
- [ ] Adicionar/remover item do carrinho
- [ ] Alterar quantidade no carrinho
- [ ] Cada forma de pagamento funciona: dinheiro, pix, credito, debito, boleto, outros
- [ ] Pagamento com pontos: calcula corretamente, valida saldo
- [ ] Pagamento com gift card: lookup por codigo, resgate parcial, valida status/saldo
- [ ] Pagamentos multiplos (split): soma igual ao total
- [ ] Parcelas (credito 1-12x): selecao funciona
- [ ] Confirmar venda: cria sale + transaction + stock movement
- [ ] Historico de vendas: lista corretamente
- [ ] NFC-e toggle: emissao funciona, exibe chave de acesso
- [ ] Recibo: impressao gera layout correto
- [ ] Vender gift card: modal funciona, cria gift card no Firestore
- [ ] Selecionar cliente: busca funciona, exibe pontos de fidelidade
- [ ] Cancelar venda: limpa carrinho, reseta estados

### 3.4 Financeiro
- [ ] Criar transacao receita: todos os campos salvam
- [ ] Criar transacao despesa: todos os campos salvam
- [ ] Editar transacao: atualiza corretamente
- [ ] Deletar transacao
- [ ] Parcelas: criar transacao com parcelas gera N documentos
- [ ] Contas a pagar/receber: filtro por status funciona
- [ ] Aging report: buckets calculam corretamente
- [ ] Fluxo de caixa: projecao previsto vs realizado
- [ ] DRE: calculo correto por periodo (mensal/trimestral/anual)
- [ ] DRE: export PDF gera arquivo valido
- [ ] Comissoes tab: lista por profissional, filtro por periodo
- [ ] Comissoes: botao Pagar atualiza status
- [ ] Contas bancarias: CRUD funciona

### 3.5 Estoque
- [ ] Criar produto: todos os campos salvam, upload de imagem funciona
- [ ] Editar produto
- [ ] Movimentacao: entrada, saida, ajuste atualizam `currentStock`
- [ ] Alerta de estoque baixo: `currentStock <= minStock`
- [ ] Categorias e filtros funcionam
- [ ] Grid/list view toggle

### 3.6 CRM
- [ ] Criar contato: todos os campos, lifecycle stage
- [ ] Editar contato
- [ ] Pipeline de deals: criar, mover entre etapas
- [ ] Atividades: criar ligacao, email, reuniao, whatsapp, tarefa, nota
- [ ] Tags: adicionar, remover
- [ ] Broadcasts: criar campanha, enviar (verificar rate limit)
- [ ] Segmentos: criar com filtros, usar em broadcast

### 3.7 Kanban
- [ ] Criar board: nome, colunas, visibilidade por setor
- [ ] Criar card: titulo, descricao, prioridade, due date, assignees
- [ ] Drag-and-drop entre colunas
- [ ] Checklists: adicionar items, toggle completado
- [ ] Labels: adicionar, remover
- [ ] Comentarios: adicionar, exibir thread
- [ ] Anexos: upload funciona, preview exibe
- [ ] Templates: salvar card como template, criar card a partir de template
- [ ] Automacoes: configurar trigger + action, verificar execucao
- [ ] Recorrencia: completar card gera proxima ocorrencia
- [ ] Views: Board, Lista, Calendario, Minhas Tarefas — todas renderizam
- [ ] **Arquivar board:** confirmacao aparece, board some da lista ativa
- [ ] **Restaurar board:** dropdown de arquivados exibe boards, restaurar traz de volta com colunas/cards
- [ ] **Excluir coluna:** confirmacao aparece com nome da coluna, coluna e removida; bloqueado se ha cards
- [ ] **Icones distintos:** botao arquivar (ArchiveX) diferente de ver arquivados (FolderOpen)

### 3.8 Conversas
- [ ] Lista de conversas carrega
- [ ] Enviar mensagem de texto: WhatsApp, Facebook, Instagram
- [ ] Receber mensagem: real-time via onSnapshot
- [ ] **Scroll automatico:** ao abrir qualquer conversa (WhatsApp, Facebook, Instagram), scroll vai para ultima mensagem sem interacao manual
- [ ] **Audio recebido:** player inline aparece e reproduz (WhatsApp OGG convertido para M4A)
- [ ] **Audio enviado:** arquivo enviado corretamente, status 'sent' atualiza apos envio
- [ ] **Video recebido:** player inline exibe e reproduz
- [ ] **Imagem recebida:** exibe inline, clique expande
- [ ] **Nome/foto do contato:** perfis do Facebook e Instagram exibem nome e foto reais (nao "Usuario do Facebook")
- [ ] Notas internas: toggle funciona, nao envia para contato, aparece com fundo amber
- [ ] Snippets: `/` abre autocomplete, insere conteudo
- [ ] Read/unread tracking
- [ ] Sem canais conectados: exibe instrucoes de conexao

### 3.9 Fiscal
- [ ] NFSe: emitir com dados completos, combobox LC 116
- [ ] NFCe: emitir, verificar status SEFAZ
- [ ] NFe: emitir, verificar status SEFAZ
- [ ] Cancelar nota: funciona, atualiza status
- [ ] Certificado digital: upload e validacao

### 3.10 Relatorios
- [ ] Tab Vendas: dados corretos, filtro por periodo
- [ ] Tab Agenda: dados corretos, taxa de no-show
- [ ] Tab Financeiro: dados corretos por categoria
- [ ] Tab Clientes: dados corretos, CLV — nenhum cliente sem `name` causa crash
- [ ] Tab Comissoes: dados corretos por profissional
- [ ] Export PDF: gera arquivo valido para cada tab

### 3.11 Configuracoes
- [ ] Perfil: editar nome, telefone, foto, endereco, status
- [ ] Empresa: editar dados, upload logo
- [ ] Fiscal: configurar certificado, ambiente
- [ ] Usuarios: listar membros, gerar invite code
- [ ] Setores: CRUD, atribuir membros, definir lider
- [ ] Enterprise: toggle, configurar integracoes, API keys

### 3.12 Mural de Notas (modulo novo)
- [ ] Aba Pessoal: notas criadas aparecem apenas para o proprio usuario
- [ ] Aba Equipe: notas criadas aparecem para todos os membros do business
- [ ] Criar nota: sem titulo funciona, sem conteudo bloqueia o botao Criar
- [ ] Cor: 8 opcoes do color picker funcionam, card reflete cor escolhida
- [ ] Fixar nota: icone de pin move nota para o topo da grid
- [ ] Desafixar nota: volta para ordem cronologica
- [ ] Editar nota: modal abre com dados preenchidos, salva corretamente
- [ ] Excluir nota: confirmacao inline (check/X), nota removida do Firestore
- [ ] Busca: filtra por titulo e conteudo em tempo real
- [ ] Modal redimensionavel: arrastar canto inferior direito aumenta/diminui
- [ ] Tamanho do modal persiste no localStorage entre aberturas
- [ ] Soltar resize nao fecha o modal (distancia de drag > 6px ignorada)
- [ ] Color picker abre para cima (nao e cortado pelo modal)
- [ ] Isolamento: usuario de outro business nao ve as notas

### 3.13 Senhas / Cofre (modulo existente nao documentado)
- [ ] Criar entrada: so titulo e obrigatorio (senha e opcional)
- [ ] Criar entrada sem senha: exibe badge "Sem credencial" na listagem
- [ ] Criar entrada com senha: gerador funciona (opcoes upper/lower/numbers/symbols)
- [ ] Forca da senha: barra de progresso aparece e indica nivel correto
- [ ] Revelar senha: decripta e exibe por tempo limitado (auto-oculta)
- [ ] Copiar senha: copia para clipboard, limpa em 20s
- [ ] Editar entrada: campo senha vazio mantem a atual
- [ ] Excluir entrada: confirmacao via `confirm()`, removida do Firestore
- [ ] Acesso restrito: somente admin/founder visualiza o modulo
- [ ] `encryptedPassword` nunca aparece na listagem (stripado na API)

### 3.14 Notificacoes (Sprint 1)
- [ ] Badge no sino da TopBar mostra contagem unificada (notifs + mensagens)
- [ ] Dropdown abre com lista de notificacoes em tempo real
- [ ] Mark-as-read individual e "marcar todas como lidas" funciona
- [ ] Clear all remove todas as notificacoes
- [ ] Ao atribuir tarefa no Kanban, assignees recebem notificacao
- [ ] Cron gera notificacoes para tarefas vencendo/atrasadas (idempotente)

### 3.15 Recorrencia Financeira (Sprint 1)
- [ ] Toggle "Recorrente" aparece no form de lancamento quando parcelas = 1
- [ ] 5 frequencias disponiveis (semanal, quinzenal, mensal, trimestral, anual)
- [ ] Data de encerramento opcional funciona
- [ ] Cron gera proxima ocorrencia quando nextDueDate <= hoje
- [ ] Recorrencia desativa quando endDate e ultrapassada

### 3.16 Google Calendar (Sprint 1)
- [ ] Botao "Conectar" no Settings → Perfil redireciona para OAuth Google
- [ ] Callback salva tokens criptografados no Firestore
- [ ] Criar agendamento → evento aparece no Google Calendar
- [ ] Editar agendamento → evento atualizado no GCal
- [ ] Deletar agendamento → evento removido do GCal
- [ ] Desconectar remove tokens do Firestore

### 3.17 Apple Calendar (Sprint 1)
- [ ] URL .ics aparece no Settings → Perfil quando business tem slug
- [ ] Copiar URL funciona
- [ ] Acessar URL retorna .ics valido com agendamentos futuros
- [ ] Agendamentos cancelados nao aparecem no feed

### 3.18 Automacoes CRM (Sprint 1)
- [ ] Aba "Automacoes" no CRM com lista de regras
- [ ] Criar regra com trigger + config + acoes funciona
- [ ] Toggle ativar/desativar regra funciona
- [ ] Excluir regra funciona
- [ ] Cron executa regras ativas (verificar lastRunAt idempotencia)

### 3.19 Formularios Intake (Sprint 1)
- [ ] Aba "Formularios" no CRM com builder visual
- [ ] 8 tipos de campo (text, textarea, number, date, select, radio, checkbox, file)
- [ ] Pagina publica /forms/[formId] renderiza formulario corretamente
- [ ] Submit valida campos obrigatorios
- [ ] Respostas aparecem no LeadDetailPanel do contato

### 3.20 Gestao de Reputacao (Sprint 1)
- [ ] Pagina publica /review/[slug] com estrelas interativas
- [ ] Submit rate-limited (5/hora/IP)
- [ ] Aba "Avaliacoes" nos Relatorios com KPIs (total, media, NPS, %5 estrelas)
- [ ] Distribuicao de estrelas e ranking por profissional corretos

### 3.21 AI Analyst (Sprint 1)
- [ ] Painel colapsavel no Dashboard com visual violet
- [ ] Prompts sugeridos funcionam
- [ ] Enviar pergunta retorna resposta do agente
- [ ] Visivel apenas quando aiAgent.enabled = true

### 3.22 Conciliacao Bancaria (Sprint 1)
- [ ] Aba "Conciliacao" no Financeiro
- [ ] Upload de .ofx processa corretamente
- [ ] Upload de .csv (formato BR) processa corretamente
- [ ] Auto-matching encontra correspondencias por valor + data
- [ ] Stats bar mostra contagem correta (matched/pending/divergent)
- [ ] Salvar conciliacao persiste import + items no Firestore
- [ ] Historico de importacoes anteriores aparece

### 3.23 Memberships (Sprint 2)
- [ ] Aba "Planos" no CRM com CRUD de planos
- [ ] Cards visuais com preco e ciclo
- [ ] Warning aparece quando gateway nao configurado
- [ ] Criar/editar/desativar plano funciona

---

## 4. UI/UX — Interface e Experiencia

### 4.1 Responsividade
- [ ] **Desktop** (1920x1080): todos os modulos renderizam corretamente
- [ ] **Laptop** (1366x768): sem overflow horizontal, tabelas responsivas
- [ ] **Tablet** (768px): sidebar recolhe, conteudo se adapta
- [ ] **Mobile** (375px): layout nao quebra (ou exibe mensagem "use desktop")
- [ ] Sidebar collapsed: modulos ajustam layout via `sidebarCollapsed`

### 4.2 Dark Mode
- [ ] **Todos os modulos** tem variantes `dark:` corretas — nenhum texto invisivel
- [ ] Cards usam classe `.surface` (branco/dark com border)
- [ ] Graficos (Recharts) se adaptam ao tema
- [ ] Modais/dialogs tem fundo escuro correto (sem transparencia indesejada)
- [ ] **Mural de Notas:** cards coloridos em dark mode tem fundo solido (nao transparente)
- [ ] Inputs e selects: border visivel em dark mode, sem outline vermelho do browser
- [ ] Status dots: cores corretas em dark mode (emerald, amber, gray)
- [ ] ThemeToggle: Claro/Escuro/Sistema todos funcionam

### 4.3 Loading States
- [ ] **Suspense fallback**: `ModuleLoadingFallback` para modulos padrao, `FullHeightFallback` para canvas
- [ ] **useQuery isLoading**: cada modulo exibe skeleton enquanto dados carregam
- [ ] **Nenhum flash** de conteudo vazio antes dos dados carregarem
- [ ] Botoes de acao mostram loading state (spinner/disabled) durante operacoes
- [ ] Formularios: submit desabilitado durante salvamento

### 4.4 Animacoes e Transicoes
- [ ] `AnimatePresence mode="wait"` funciona na troca de paginas (sem sobreposicao)
- [ ] `NavProgress` barra vermelha aparece e desaparece corretamente
- [ ] Exit animations: sem `filter: blur()` no exit (pode travar GPU)
- [ ] `layoutId="sidebar-active-pill"` anima suavemente entre itens
- [ ] Sidebar collapse/expand animado
- [ ] Modais abrem/fecham com animacao

### 4.5 Mensagens de Feedback
- [ ] **Toast/Snackbar** para operacoes de sucesso (criar, editar, deletar)
- [ ] **Toast de erro** para falhas (vermelho, mensagem descritiva)
- [ ] **Confirmacao** antes de acoes destrutivas (deletar, cancelar, arquivar board, excluir coluna Kanban)
- [ ] Mensagens em portugues (ou ingles se i18n ativo)
- [ ] Nenhuma mensagem generica "Erro" — sempre com contexto

### 4.6 Tipografia e Espacamento
- [ ] Titulos usam `font-display` (Plus Jakarta Sans)
- [ ] Corpo usa Inter
- [ ] Icones sao todos de `lucide-react` (nenhum mix com outro pack)
- [ ] Tamanho padrao de icones: `w-4 h-4` ou `w-[17px] h-[17px]`
- [ ] Arredondamento: `rounded-xl` padrao, `rounded-2xl` em cards maiores
- [ ] Cor primaria: red-600/red-500 (nunca hex hardcoded)

### 4.7 Tabelas e Listas
- [ ] Tabelas: header fixo, scroll vertical quando muitas linhas
- [ ] Empty states: mensagem + icone quando lista esta vazia
- [ ] Paginacao: funciona quando ha muitos registros
- [ ] Filtros: resetam corretamente, nao quebram com dados vazios
- [ ] Ordenacao: funciona por colunas relevantes

### 4.8 Formularios
- [ ] Validacao inline (borda vermelha + mensagem de erro)
- [ ] Required fields marcados com asterisco ou indicador
- [ ] CEP auto-fill (ViaCEP) funciona no perfil e empresa
- [ ] Mascaras: CPF, CNPJ, telefone, CEP formatam corretamente
- [ ] Select/Combobox: opcoes carregam, busca funciona
- [ ] DatePicker: formato brasileiro (DD/MM/YYYY)

---

## 5. PERFORMANCE

### 5.1 Queries e Cache
- [ ] React Query `staleTime` configurado (padrao: 5 min) — nao refetch desnecessario
- [ ] Queries com `enabled: !!business?.id` (nao disparam sem auth)
- [ ] `invalidateQueries` chamado apos mutacoes (cache atualizado)
- [ ] Nenhuma query sem limite (`limit()`) em colecoes grandes
- [ ] `onSnapshot` listeners sao limpos no `useEffect` cleanup (`return () => unsub()`)
- [ ] **Notas:** query unica por `businessId` sem indice composto — confirmar que funciona sem erro de indice no Firebase Console

### 5.2 Bundle e Carregamento
- [ ] Modulos sao lazy-loaded (`React.lazy` + `Suspense`)
- [ ] `jsPDF` e `jspdf-autotable` importados via dynamic import (nao no bundle principal)
- [ ] Imagens no Firebase Storage com tamanho razoavel (< 2MB avatars, < 5MB logos)
- [ ] Nenhum import circular (verificar com `npx madge --circular`)

### 5.3 Renderizacao
- [ ] `useMemo` para calculos pesados (DRE, relatorios, listas filtradas)
- [ ] `useCallback` para handlers passados como props
- [ ] Nenhum re-render infinito (verificar React DevTools Profiler)
- [ ] Listas grandes usam key unica e estavel (nunca `index`)
- [ ] Componentes pesados (graficos Recharts) nao re-renderizam a cada keystroke

### 5.4 Firestore
- [ ] Indices compostos necessarios criados no Firebase Console
- [ ] Queries com `orderBy` tem indice correspondente
- [ ] Nenhuma leitura de colecao inteira sem filtro
- [ ] `runTransaction` nao aninhados (sem transacao dentro de transacao)

---

## 6. INTEGRACOES EXTERNAS

### 6.1 Meta/WhatsApp/Instagram/Facebook
- [ ] Webhook `/api/webhooks/meta`: verifica signature antes de processar
- [ ] Token exchange `/api/channels/meta-signup`: valida estado e nonce
- [ ] **Token de longa duracao:** page access token armazenado e o token de longa duracao (nao expira em 60 dias)
- [ ] **Nomes/fotos de perfil:** contatos do Facebook e Instagram exibem nome e foto reais apos reconexao
- [ ] **Audio OGG → M4A:** conversao automatica para compatibilidade com Safari
- [ ] Envio de mensagens: retry com backoff em caso de rate limit
- [ ] Lembretes automaticos: cron funciona, nao envia duplicados (campos sentAt)

### 6.2 Firebase
- [ ] Auth: signIn, signUp, signOut, Google login — todos funcionam
- [ ] Storage: upload/download de arquivos funciona
- [ ] Firestore: leitura/escrita funciona em todos os modulos
- [ ] **Security Rules deployadas** — incluindo regras da colecao `notes` (deploy obrigatorio pre-producao)

### 6.3 SEFAZ (Fiscal)
- [ ] Ambiente de homologacao configurado para testes
- [ ] Certificado digital: upload, validacao de validade
- [ ] NFe/NFCe/NFSe: emissao, cancelamento, consulta status
- [ ] Erro SEFAZ: exibe mensagem descritiva ao usuario

### 6.4 Integracoes Enterprise
- [ ] Stripe: API key valida, dados retornam corretamente
- [ ] OpenAI: custo e tokens calculam corretamente
- [ ] GitHub: repos e PRs listam
- [ ] Vercel: deploys e projetos listam
- [ ] Resend: emails e dominios listam
- [ ] Todas as rotas proxy protegem API key (nunca exposta ao frontend)

---

## 7. ACESSIBILIDADE (a11y)

### 7.1 Navegacao
- [ ] Tab order logico em todos os formularios
- [ ] Focus visible em elementos interativos (botoes, inputs, links)
- [ ] Skip-to-content link ou alternativa
- [ ] Sidebar navegavel por teclado

### 7.2 Semantica
- [ ] Botoes usam `<button>` (nao `<div onClick>`)
- [ ] Links usam `<a>` com href (ou Next.js `<Link>`)
- [ ] Formularios usam `<label>` vinculado ao input (htmlFor/id)
- [ ] Tabelas usam `<table>`, `<thead>`, `<tbody>`, `<th>`
- [ ] Modais capturam focus e restauram ao fechar

### 7.3 Screen Readers
- [ ] Imagens tem `alt` text
- [ ] Icones decorativos tem `aria-hidden="true"`
- [ ] Status dots tem `aria-label` descritivo
- [ ] Toast/alertas usam `role="alert"` ou `aria-live`
- [ ] Loading states tem `aria-busy="true"`

### 7.4 Contraste
- [ ] Texto principal: ratio >= 4.5:1 (light e dark mode)
- [ ] Texto secundario/muted: ratio >= 3:1
- [ ] Botoes: texto legivel sobre fundo colorido
- [ ] Verificar com ferramenta (axe DevTools, Lighthouse)

---

## 8. TRATAMENTO DE ERROS & EDGE CASES

### 8.1 Erros de Rede
- [ ] App funciona com internet lenta (exibe loading, nao quebra)
- [ ] Firestore offline: React Query exibe dados em cache
- [ ] API routes retornam status codes corretos (400, 401, 403, 404, 500)
- [ ] fetch/axios tem timeout configurado

### 8.2 Estados Vazios
- [ ] Business novo (sem dados): todos os modulos renderizam sem erro
- [ ] Dashboard: KPIs mostram 0, graficos mostram "sem dados"
- [ ] Listas vazias: mensagem amigavel + CTA para criar primeiro registro
- [ ] Relatorios: mensagem quando nao ha dados no periodo
- [ ] **Mural de Notas:** empty state aparece na aba correta, CTA "Criar primeira nota" funciona

### 8.3 Edge Cases por Modulo
- [ ] PDV: carrinho vazio nao permite confirmar venda
- [ ] PDV: gift card expirado/usado mostra erro claro
- [ ] PDV: pontos insuficientes mostra erro com saldo atual
- [ ] Financeiro: DRE com periodo sem transacoes mostra zeros
- [ ] Agenda: agendamento no passado — permitir ou bloquear?
- [ ] Kanban: board sem colunas — exibe CTA para criar coluna
- [ ] Kanban: tentar excluir coluna com cards — exibe toast de erro (nao abre confirmacao)
- [ ] Kanban: tentar arquivar ultimo board — botao nao aparece (boards.length > 1)
- [ ] CRM: contato sem deals — deal panel mostra empty state
- [ ] Fiscal: emissao sem certificado — erro claro antes de enviar
- [ ] Conversas: sem canais conectados — exibe instrucoes
- [ ] **Relatorios:** cliente sem campo `name` no Firestore nao causa crash (exibe '—')
- [ ] **Notas:** nota com titulo muito longo nao quebra o layout do card
- [ ] **Senhas:** entrada sem senha exibe "Sem credencial", nao tenta revelar

### 8.4 Concorrencia
- [ ] Dois usuarios editando mesmo agendamento — ultimo salva (ou conflict detection?)
- [ ] Gift card resgatado simultaneamente por dois PDVs — `runTransaction` evita double-spend
- [ ] Loyalty points: resgate simultaneo — `runTransaction` evita saldo negativo
- [ ] Estoque: duas vendas simultaneas do mesmo produto — `runTransaction` ou batch garante

---

## 9. PRE-DEPLOY — Infraestrutura

### 9.1 Variaveis de Ambiente
- [ ] `.env.production` configurado com valores reais (nao demo)
- [ ] Todas as `NEXT_PUBLIC_FIREBASE_*` apontam para projeto de producao
- [ ] `META_APP_SECRET` e `META_CONFIG_ID` configurados
- [ ] `CRON_SECRET` configurado para proteger rota de cron
- [ ] Verificar que nenhuma variavel esta faltando (app nao usa fallback demo)

### 9.2 Build
- [ ] `npm run build` — zero erros TypeScript
- [ ] `npm run build` — zero warnings criticos
- [ ] Bundle size razoavel (verificar com `npx next build --analyze`)
- [ ] Sem dependencias desnecessarias no `package.json`

### 9.3 Firebase Console
- [ ] **Firestore Security Rules deployadas** — incluindo regras de `notes` e `passwordVaultEntries` atualizadas
- [ ] Firestore indices compostos criados (verificar Console → Firestore → Indices)
- [ ] Storage Rules configuradas (acesso por auth)
- [ ] Auth providers habilitados (Email/Password, Google)

### 9.4 Vercel / Hosting
- [ ] Dominio configurado e SSL ativo
- [ ] Variaveis de ambiente configuradas no painel do host
- [ ] Cron job (`/api/agent/scheduled/run`) configurado em vercel.json
- [ ] Redirects e rewrites configurados se necessario

### 9.5 Monitoramento
- [ ] Error tracking configurado (Sentry ou similar)
- [ ] Logs estruturados nas API routes
- [ ] Alertas para erros criticos (Auth failure, Firestore permission denied)

---

## Progresso Geral

| Secao | Items | Verificados | Status |
|-------|-------|------------|--------|
| 1. Seguranca & Multi-tenant | 43 | 0 | ⬜ Pendente |
| 2. Integridade de Dados | 24 | 0 | ⬜ Pendente |
| 3. CRUD por Modulo | 162 | 0 | ⬜ Pendente |
| 4. UI/UX | 51 | 0 | ⬜ Pendente |
| 5. Performance | 18 | 0 | ⬜ Pendente |
| 6. Integracoes | 19 | 0 | ⬜ Pendente |
| 7. Acessibilidade | 16 | 0 | ⬜ Pendente |
| 8. Erros & Edge Cases | 22 | 0 | ⬜ Pendente |
| 9. Pre-Deploy | 14 | 0 | ⬜ Pendente |
| **TOTAL** | **369** | **0** | ⬜ |

---

*Este checklist deve ser executado em ambiente de staging/homologacao antes do deploy para producao.*
*Cada secao pode ser delegada a um agente ou executada manualmente no navegador.*
