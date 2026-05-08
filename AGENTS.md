# ServicePro — Guia para Agentes de IA

> **Leia este arquivo inteiro antes de modificar qualquer código.**
> Este sistema é um **SaaS multi-tenant**. Cada empresa é um tenant independente.
> Toda leitura e escrita no Firestore **deve** ser filtrada por `businessId`.

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Framework | Next.js 15 (App Router, `'use client'`) |
| UI | Tailwind CSS + MUI v6 + Framer Motion |
| Backend | Firebase (Auth + Firestore + Storage) |
| Estado servidor | TanStack React Query v5 |
| Linguagem | TypeScript (strict mode) |
| Ícones | Lucide React |
| Fontes | Inter (corpo) · Plus Jakarta Sans (títulos, `.font-display`) |

---

## Arquitetura Multi-Tenant — REGRA CRÍTICA

```
Firebase Auth (UID)
       │
       ▼
users/{uid}          ← perfil do usuário, inclui businessId
       │
       ▼
businesses/{businessId}   ← empresa/tenant
       │
       ├── clients/{id}         where('businessId', '==', businessId)
       ├── appointments/{id}    where('businessId', '==', businessId)
       ├── transactions/{id}    where('businessId', '==', businessId)
       ├── products/{id}        where('businessId', '==', businessId)
       ├── kanbanBoards/{id}    where('businessId', '==', businessId)
       ├── crmContacts/{id}     where('businessId', '==', businessId)
       ├── fiscalDocuments/{id} where('businessId', '==', businessId)
       ├── sales/{id}           where('businessId', '==', businessId)
       ├── inviteCodes/{code}   where('businessId', '==', businessId)
       ├── sectors/{id}         where('businessId', '==', businessId)
       ├── snippets/{id}        where('businessId', '==', businessId)
       ├── segments/{id}        where('businessId', '==', businessId)
       ├── broadcasts/{id}      where('businessId', '==', businessId)
       └── broadcastMessages/{id} where('businessId','==',businessId) + broadcastId
```

### Regras obrigatórias para qualquer nova feature

1. **Todo documento novo** deve incluir `businessId: business.id` no momento da criação.
2. **Toda query** ao Firestore deve ter `where('businessId', '==', user.businessId)`.
3. **Nunca** leia ou escreva sem o filtro de `businessId` — isso quebraria o isolamento entre tenants.
4. Use `useAuth()` para obter `user.businessId` e `business.id`.

```typescript
// ✅ CORRETO
const { user, business } = useAuth();
const q = query(
  collection(db, 'minhaColecao'),
  where('businessId', '==', business.id),
  orderBy('createdAt', 'desc')
);

// ❌ ERRADO — sem filtro de tenant
const q = query(collection(db, 'minhaColecao'));
```

---

## Roles de Usuário

```typescript
type UserRole = 'founder' | 'admin' | 'manager' | 'operator' | 'viewer';

// Hierarquia numérica (maior = mais permissão)
ROLE_HIERARCHY = { founder: 100, admin: 80, manager: 60, operator: 40, viewer: 20 }
```

| Role | Acesso |
|------|--------|
| `founder` | Total. Pode deletar empresa. Tem ícone de coroa na UI. |
| `admin` | Total exceto deletar empresa. Pode gerar códigos de convite. |
| `manager` | Clientes, agenda, financeiro, estoque. Sem configurações. |
| `operator` | PDV, agenda, clientes. Sem financeiro. |
| `viewer` | Somente leitura. |

Verificação de permissão:
```typescript
const { user } = useAuth();
const canEdit = ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['manager'];
```

---

## Sistema de Convite por Código (InviteCode)

### Fluxo
1. Admin/Founder abre **Settings → Usuários**, escolhe um role e clica "Gerar Código".
2. Um documento é criado em `inviteCodes/{CODIGO}` (o código de 6 chars é o próprio document ID).
3. O novo usuário entra no cadastro, ativa "Tenho um código" e digita o código.
4. `signUp()` no AuthProvider valida o código, cria o usuário com o `businessId` e `role` do código, e marca o código como `isActive: false`.

### Estrutura do documento `inviteCodes/{code}`
```typescript
interface InviteCode {
  businessId: string;      // tenant do admin que gerou
  code: string;            // igual ao document ID (6 chars uppercase)
  role: UserRole;          // role que o novo usuário receberá
  createdBy: string;       // uid do admin
  createdByName: string;
  usedBy?: string;         // uid de quem usou (pós uso)
  usedByName?: string;
  usedAt?: string;
  expiresAt: string;       // ISO string — padrão: +7 dias
  isActive: boolean;       // false após uso ou revogação
  createdAt: string;
}
```

### Geração do código
- 6 caracteres uppercase, sem caracteres ambíguos (sem 0, O, 1, I).
- Charset: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- Document ID = o próprio código (permite lookup O(1) sem query).

---

## Sistema de Presença Online

### Campos no documento `users/{uid}`
```typescript
isOnline: boolean;         // true quando usuário está ativo (heartbeat automático)
lastSeenAt: string;        // ISO — atualizado a cada 60s (heartbeat)
lastLoginAt: string;       // ISO — atualizado a cada login
userStatus: UserStatus;    // status manual definido pelo próprio usuário
```

### UserStatus — Status Manual do Usuário

```typescript
type UserStatus = 'online' | 'busy' | 'invisible' | 'offline';
```

| Status | Cor dot | Visível para outros | Significado |
|--------|---------|---------------------|-------------|
| `online` | `bg-emerald-400` | Online (verde) | Disponível |
| `busy` | `bg-amber-400` | Ocupado (âmbar) | Em reunião ou ocupado |
| `invisible` | `bg-gray-400` | **Offline** (cinza) | Oculto — aparece offline para a equipe |
| `offline` | `bg-gray-400` | Offline (cinza) | Ausente / desconectado |

**Regra crítica — invisível:** Um usuário com `userStatus === 'invisible'` **sempre aparece offline** para os outros membros, independente de `isOnline` ser `true`. Isso é verificado **antes** de qualquer outra lógica de presença.

### Lógica de detecção (client-side)

```typescript
// NUNCA use isOnline isoladamente. Use getMemberDisplayStatus:
function getMemberDisplayStatus(member: User): 'online' | 'busy' | 'offline' {
  if (member.userStatus === 'invisible') return 'offline'; // ← SEMPRE offline para outros
  if (!member.isOnline || !member.lastSeenAt) return 'offline';
  if (Date.now() - new Date(member.lastSeenAt).getTime() >= 3 * 60 * 1000) return 'offline';
  return member.userStatus === 'busy' ? 'busy' : 'online';
}

// isOnline é apenas um atalho para "não está offline"
function isOnline(member: User): boolean {
  return getMemberDisplayStatus(member) !== 'offline';
}
```

O `AuthProvider` mantém a presença automática através de:
- **Login**: `isOnline: true` + `lastLoginAt` + `lastSeenAt`
- **Heartbeat**: `setInterval(60s)` → atualiza `lastSeenAt`
- **`visibilitychange`**: toggle online/offline quando troca de aba
- **`beforeunload`**: set offline ao fechar aba (best-effort)
- **Logout**: `isOnline: false` explícito antes de `signOut()`

### Alterar status do usuário

Usando `updateUserProfile` do `useAuth()` — não existe função separada:

```typescript
const { updateUserProfile } = useAuth();

// Mudar para ocupado
await updateUserProfile({ userStatus: 'busy' });

// Mudar para invisível
await updateUserProfile({ userStatus: 'invisible' });
```

### Como exibir presença em qualquer módulo

```typescript
const displayStatus = getMemberDisplayStatus(member);
const dotClass = { online: 'bg-emerald-400', busy: 'bg-amber-400', offline: 'bg-gray-300 dark:bg-gray-600' }[displayStatus];
```

Status é exibido/controlado em: Dashboard header, TopBar avatar/dropdown/TeamPresencePanel, Settings perfil/usuários.

---

## AuthProvider (`app/components/providers/AuthProvider.tsx`)

### Hook
```typescript
const {
  user,               // User | null — perfil completo do Firestore
  firebaseUser,       // FirebaseUser | null — objeto nativo do Firebase Auth
  business,           // Business | null — empresa do usuário
  isLoading,          // boolean
  isAuthenticated,    // boolean = !!user
  sectors,            // Sector[] — todos os setores do business (carregados no login)
  userSectorIds,      // string[] — IDs dos setores do usuário atual
  signIn,
  signUp,             // aceita inviteCode opcional
  signInWithGoogle,
  signOut,
  updateUserProfile,
  refreshUser,
} = useAuth();
```

### `signUp` — dois modos
```typescript
// Modo 1: cria nova empresa (padrão)
await signUp(email, password, name);

// Modo 2: entra em empresa existente via código
await signUp(email, password, name, 'AB3K9M');
```

---

## Padrão de Data Fetching

```typescript
// 1. Obter businessId
const { business } = useAuth();

// 2. React Query com Firestore
const { data: clients } = useQuery({
  queryKey: ['clients', business?.id],
  queryFn: async () => {
    if (!business?.id) return [];
    const q = query(
      collection(db, 'clients'),
      where('businessId', '==', business.id),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  },
  enabled: !!business?.id,
  staleTime: 5 * 60 * 1000,
});

// 3. Invalidar cache após mutação
const queryClient = useQueryClient();
await setDoc(/* ... */);
queryClient.invalidateQueries({ queryKey: ['clients', business?.id] });
```

Para dados em **tempo real** (como presença), use `onSnapshot` diretamente:
```typescript
useEffect(() => {
  if (!business?.id) return;
  const q = query(collection(db, 'users'), where('businessId', '==', business.id));
  const unsub = onSnapshot(q, (snap) => {
    setMembers(snap.docs.map(d => ({ ...d.data(), id: d.id } as User)));
  });
  return () => unsub();
}, [business?.id]);
```

---

## Estrutura de Arquivos

```
app/
├── login/page.tsx              ← autenticação (email+senha, Google, código de convite)
├── app/
│   ├── layout.tsx              ← shell autenticado (sidebar + topbar + animações)
│   ├── page.tsx                ← roteador de módulos via AppContext
│   └── AppContext.tsx          ← { activePage, setActivePage, sidebarCollapsed }
├── components/
│   ├── providers/
│   │   ├── AuthProvider.tsx    ← FONTE DA VERDADE: user, business, presença
│   │   ├── ThemeProvider.tsx   ← dark/light mode (class na <html>)
│   │   └── QueryProvider.tsx   ← TanStack Query
│   ├── layout/
│   │   ├── Sidebar.tsx         ← nav retrátil (collapsed via AppContext)
│   │   └── TopBar.tsx          ← busca, presença da equipe, tema, user menu
│   └── features/
│       ├── dashboard/          ← KPIs, gráficos de receita
│       ├── clients/            ← CRUD de clientes (PF/PJ)
│       ├── agenda/             ← agendamentos
│       ├── crm/                ← leads, deals, pipeline, campanhas (broadcasts)
│       ├── kanban/             ← boards e cards (visibilidade por setor)
│       ├── conversations/      ← omnichannel (WhatsApp, Facebook, Instagram), notas internas, quick replies
│       ├── pdv/                ← ponto de venda
│       ├── financial/          ← contas a pagar/receber, relatórios enterprise (receita por canal/setor, ROI campanhas, CLV)
│       ├── inventory/          ← estoque e produtos
│       ├── fiscal/             ← NF-e, NFC-e, NFSe
│       ├── integrations/       ← dashboard Enterprise (tabs/, shared/)
│       │   ├── IntegrationsModule.tsx  ← orquestrador
│       │   ├── tabs/           ← OverviewTab, RevenueTab, AICostsTab, DevelopmentTab, CommunicationTab, TeamTab
│       │   └── shared/         ← KPICard, ProgressBar, IntegrationSkeleton, utils
│       └── settings/           ← empresa, fiscal, usuários/convites, setores, enterprise
app/api/
├── channels/meta-signup/route.ts  ← Token exchange para Embedded Signup (Meta)
├── broadcasts/send/route.ts       ← Processador de campanhas em massa (WhatsApp/FB/IG)
├── integrations/                  ← Proxy routes para APIs externas (Stripe, OpenAI, etc.)
└── webhooks/                      ← Webhooks WhatsApp/Facebook/Instagram
lib/
├── types/index.ts              ← TODOS os tipos TypeScript do sistema
├── config/firebase.ts          ← instâncias: auth, db, storage
├── utils/
│   ├── format.ts               ← formatCurrency, formatDate, getInitials...
│   └── validators.ts           ← validateCNPJ, validateCPF...
└── services/api/firebaseService.ts ← CRUD genérico
```

---

## Tipos Principais (`lib/types/index.ts`)

> Sempre adicione novos tipos aqui. Não crie tipos locais em componentes.

```typescript
UserStatus   → 'online' | 'busy' | 'invisible' | 'offline'  (status manual do usuário)
User         → id, uid, email, name, role, businessId, isOnline, userStatus,
               lastSeenAt, lastLoginAt, phone?, photoURL?, profileAddress?, sectorIds?
Business     → id, razaoSocial, cnpj, crt, ownerUserId, memberIds, fiscal?, settings?
InviteCode   → businessId, code, role, createdBy, expiresAt, isActive, usedBy?, sectorId?
Client       → businessId, tipo (pf|pj), cpfCnpj, phone, totalSpent, visitCount
Appointment  → businessId, clientId, date, startTime, status (6 estados)
Sale         → businessId, items[], payments[], operatorId, channelType?, conversationId?, sectorId?
Transaction  → businessId, type (receita|despesa), amount, dueDate, status, channelType?, conversationId?, contactId?, campaignId?, sectorId?
Product      → businessId, sku, currentStock, minStock, salePrice
FiscalDocument → businessId, type (nfse|nfce|nfe), status (6 estados)
KanbanBoard  → businessId, columns[], memberIds, sectorIds?, visibility ('all'|'members'|'sectors')
CRMContact   → businessId, status (7 estados), source (7 tipos), assignedTo?,
               lifecycleStage?, channelIdentities?, preferredChannel?, lastConversationId?,
               customFields?, sectorId?, optInMarketing?
Conversation → businessId, channel, sectorIds?, assignedToSectorId?, isPrivate?, priority?, labels?
ConversationMessage → ... isInternal?, mentionedUserIds?
Sector       → businessId, name, description?, color, icon?, leaderId?, memberIds, isActive
Snippet      → businessId, shortcode, content, category?, sectorId?, createdBy
Segment      → businessId, name, filters: SegmentFilter[], contactCount?, createdBy
Broadcast    → businessId, name, channel, audienceType, status, stats{total,sent,delivered,read,failed,replied}
BroadcastMessage → broadcastId, businessId, contactId, recipientId, status
EnterpriseSettings → isEnabled, enabledAt, integrations[], apiKeys[]
IntegrationConfig  → provider, apiKey, isActive, status, connectedAt
SaasApiKey   → businessId, name, keyPrefix, keyHash, scopes[], status
```

### Campos do perfil pessoal (`users/{uid}`)

Além dos campos de negócio, o documento do usuário armazena dados de perfil pessoal:

```typescript
interface User {
  // ...campos base...
  phone?: string;         // telefone pessoal
  photoURL?: string;      // URL da foto (Firebase Storage: users/{uid}/avatar)
  userStatus?: UserStatus; // status manual — lido por todos os módulos de presença
  profileAddress?: {      // endereço residencial/pessoal (opcional)
    logradouro?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    municipio?: string;
    uf?: string;
    cep?: string;
  };
}
```

---

## Utilitários de Formatação

```typescript
import { formatCurrency, formatDate, formatDateTime, getInitials } from '@/lib/utils/format';

formatCurrency(1234.56)      // "R$ 1.234,56"
formatDate('2024-01-15')     // "15/01/2024"       — retorna '-' se inválido
formatDateTime('2024-01-15T10:30:00') // "15/01/24, 10:30" — retorna '-' se inválido
getInitials('João Silva')    // "JS"
```

**Atenção**: `formatDate` e `formatDateTime` aceitam `string | null | undefined` e retornam `'-'` para valores inválidos. Nunca chame `new Date(valor)` diretamente sem validar.

---

## Estilo e Componentes

### Classes CSS globais (em `globals.css`)
```css
.shimmer          /* skeleton loading animado */
.surface          /* card white/dark com border e shadow */
.surface-hover    /* hover lift no card */
.hover-lift       /* translateY(-3px) no hover */
.gradient-text    /* texto vermelho gradiente */
.glass            /* glassmorphism */
.glow-red         /* box-shadow vermelho brilhante */
.stagger-children /* anima filhos em cascata */
.number-reveal    /* entrada animada de número */
.nav-progress-bar /* barra de progresso de navegação */
```

### Convenções
- **Tailwind first**, MUI apenas para componentes complexos (DataGrid, DatePicker, Dialog).
- Dark mode via classe `.dark` na `<html>` — sempre use variantes `dark:`.
- Animações de página: `framer-motion` com `AnimatePresence mode="wait"`.
- Ícones: sempre `lucide-react`. Tamanho padrão: `w-4 h-4` ou `w-[17px] h-[17px]`.
- Arredondamento: `rounded-xl` (padrão), `rounded-2xl` (cards maiores).
- Cor primária: `red-600` / `red-500` (gradiente). Nunca hardcode hex fora de tailwind.

### Sidebar
- **Expandida**: `w-[264px]` — logo + seções com headers destacados.
- **Retraída (collapsed)**: `w-[64px]` — só ícones + seta de expandir no topo.
- `sidebarCollapsed` disponível via `useAppContext()` para módulos ajustarem seu layout.

---

## Sistema de Navegação e Loading States

### Arquitetura de Transição de Páginas

A navegação entre módulos usa três camadas cooperando:

1. **`AnimatePresence mode="wait"`** em `app/app/layout.tsx` — aguarda o exit do módulo atual antes de montar o novo. A `key={activePage}` no `motion.div` força a desmontagem/remontagem ao trocar de página.
2. **`NavProgress`** — barra vermelha no topo que auto-completa (scaleX 0→1, opacity 1→0) a cada troca de página. Sem `AnimatePresence`, auto-reset via `key={trigger}`.
3. **`Suspense`** em `app/app/page.tsx` — cada módulo é lazy-loaded. O fallback só aparece na primeira visita (chunks são cacheados após o primeiro carregamento).

### Dois tipos de fallback (em `app/app/page.tsx`)

```typescript
// Páginas de conteúdo padrão → skeleton animado com stagger
<ModuleLoadingFallback />  // header + KPIs + bloco principal + rodapé

// Páginas canvas full-height (Agenda, PDV, Kanban, Conversas) → spinner centralizado
<FullHeightFallback />

// O sistema escolhe automaticamente via FULL_HEIGHT_PAGES Set:
const FULL_HEIGHT_PAGES = new Set(['Agenda', 'PDV', 'Kanban', 'Conversas']);
const fallback = isFullHeight ? <FullHeightFallback /> : <ModuleLoadingFallback />;
```

### Regras críticas de animação

```typescript
// ✅ CORRETO — exit sem filter:blur (blur no exit pode travar em GPUs fracos)
exit: { opacity: 0, y: -4, scale: 0.998, transition: { duration: 0.15 } }

// ❌ ERRADO — blur no exit causa instabilidade em AnimatePresence
exit: { opacity: 0, filter: 'blur(3px)' }

// ✅ CORRETO — blur apenas no enter (efeito de materialização)
initial: { opacity: 0, y: 12, filter: 'blur(4px)' }
animate: { opacity: 1, y: 0, filter: 'blur(0px)' }
```

### Skeletons e Loading

- Use classe `.shimmer` do `globals.css` para skeletons (já inclui animação + dark mode)
- `Suspense` em page.tsx só cobre JS chunk. Para dados do Firestore, cada módulo deve ter skeleton inline com `isLoading` do useQuery

### Sidebar — padrões visuais obrigatórios

- **Setas de expandir/recolher**: sempre `text-red-500 dark:text-red-400` (nunca cinza)
- **Section headers** ("Principal", "Gestão", etc.): `text-red-500 dark:text-red-400` com linha de fade vermelho à direita
- **Click ripple**: cada botão de menu usa `motion.button` com `whileTap={{ scale: 0.93 }}` + burst radial `AnimatePresence` com `bg-red-400/20`
- **Active pill**: usa `layoutId="sidebar-active-pill"` com spring animation para deslizar suavemente entre itens

---

## Adicionando um Novo Módulo

1. Crie `app/components/features/{modulo}/{Modulo}Module.tsx` com `'use client'`.
2. Exporte como default. Adicione a lazy import em `app/app/page.tsx`.
3. Adicione o `MenuPage` type em `app/components/layout/Sidebar.tsx`.
4. Adicione o item ao array `menuSections` no Sidebar com ícone e label.
5. Adicione `pageMeta` no TopBar (`app/components/layout/TopBar.tsx`).
6. Todo documento criado no módulo deve incluir `businessId: business!.id`.
7. Toda query deve ter `where('businessId', '==', business.id)`.

---

## Módulo de Configurações — Controle de Acesso por Role

O `SettingsModule` (`app/components/features/settings/SettingsModule.tsx`) possui **6 abas**, com visibilidade controlada por role.

### Abas e quem pode ver

| Aba | ID | Quem vê | Conteúdo |
|-----|----|---------|----------|
| **Meu Perfil** | `perfil` | **Todos os usuários** | Foto, nome, telefone, endereço, seletor de status |
| **Empresa** | `empresa` | admin / founder | Dados da empresa, logo, CNPJ, endereço fiscal |
| **Fiscal** | `fiscal` | admin / founder | Certificado digital, config NFe/NFCe/NFSe, ambiente |
| **Usuários** | `usuarios` | admin / founder | Lista de membros, geração de códigos de convite |
| **Setores** | `setores` | admin / founder | CRUD de setores, atribuição de membros, líder, cores |
| **Enterprise** | `enterprise` | admin / founder | Toggle enterprise, integrações, API keys, Embedded Signup (Canais) |

### Implementação da restrição

```typescript
const { user } = useAuth();
const isAdmin = ROLE_HIERARCHY[user?.role || 'viewer'] >= ROLE_HIERARCHY['admin'];

const allTabs = [
  { id: 'perfil',   label: 'Meu Perfil', icon: UserCircle },
  { id: 'empresa',  label: 'Empresa',    icon: Building2  },
  { id: 'fiscal',   label: 'Fiscal',     icon: FileText   },
  { id: 'usuarios', label: 'Usuários',   icon: Users      },
];

// Usuários comuns (manager, operator, viewer) só veem a aba de perfil
const tabs = isAdmin ? allTabs : allTabs.filter(t => t.id === 'perfil');
```

### Aba padrão

A aba inicial é **sempre `'perfil'`** para todos os roles. Isso garante que ao navegar para Configurações (seja pelo menu de usuário ou pela sidebar), o usuário cai direto na página de perfil, que é a mais relevante para ele.

### ProfileTab — o que edita

- **Foto**: upload para `users/{uid}/avatar` no Firebase Storage
- **Nome, Telefone**: salvos via `updateUserProfile({ name, phone })`
- **Email**: exibido como read-only (não editável via Auth)
- **Endereço pessoal**: CEP com auto-fill via ViaCEP → salvo em `user.profileAddress`
- **Status de presença**: 4 botões (Online / Ocupado / Invisível / Offline)

---

## Sistema de Setores/Departamentos

### Conceito

Setores são a base do sistema de permissões granulares. Um usuário pode pertencer a múltiplos setores. Conversas, boards Kanban, transações e contatos CRM podem ser associados a setores para controle de visibilidade.

### Coleção `sectors/{id}`

```typescript
interface Sector {
  id: string;
  businessId: string;
  name: string;              // "Comercial", "Suporte", "Marketing"
  description?: string;
  color: string;             // cor hex para badges
  icon?: string;             // lucide icon name
  leaderId?: string;         // uid do líder
  leaderName?: string;
  memberIds: string[];       // uids dos membros
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
```

### Contexto via AuthProvider

```typescript
const { sectors, userSectorIds } = useAuth();
// sectors: todos os setores do business
// userSectorIds: IDs dos setores do usuário logado (derivado de user.sectorIds ou sector.memberIds)
```

### Filtragem por setor (padrão)

```typescript
// Admins/Founders veem tudo. Demais filtram por setor:
if (isAdmin) return allItems;
return allItems.filter(item => {
  if (!item.sectorIds?.length) return true; // sem restrição
  return item.sectorIds.some(s => userSectorIds.includes(s));
});
```

### Onde setores são usados

| Módulo | Campo | Efeito |
|--------|-------|--------|
| **Conversas** | `conversation.sectorIds`, `assignedToSectorId`, `isPrivate` | Filtra visibilidade de conversas por setor |
| **Kanban** | `board.sectorIds`, `board.visibility` | Boards visíveis apenas para setores selecionados |
| **CRM** | `crmContact.sectorId` | Contato atribuído a setor |
| **Financeiro** | `transaction.sectorId` | Receita/despesa por departamento (enterprise) |
| **Settings** | Tab "Setores" (admin/founder) | CRUD de setores, atribuição de membros |

---

## Conversas — Features Avançadas

### Notas Internas
- Mensagens com `isInternal: true` não são enviadas ao contato via Meta API
- Renderizadas com fundo amber e ícone de cadeado
- Toggle no composer para alternar entre "Mensagem" e "Nota interna"

### Quick Replies (Snippets)
- Coleção `snippets/{id}` com `shortcode` e `content`
- Digitando `/` no composer abre autocomplete de snippets
- Snippets podem ser globais ou restritos a um setor (`sectorId?`)

### Prioridade e Labels
- `conversation.priority`: 'low' | 'medium' | 'high' | 'urgent'
- `conversation.labels`: string[] para tags personalizadas

---

## CRM — Campanhas e Segmentação

### Lifecycle Stages

```typescript
type LifecycleStage = 'new_lead' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'customer' | 'churned';
```

### Segmentos Dinâmicos (`segments/{id}`)
- Filtros AND/OR por campo do contato (status, tags, lifecycleStage, etc.)
- Usado para selecionar audiência de broadcasts

### Broadcasts (`broadcasts/{id}`)
- Campanhas em massa via WhatsApp/Facebook/Instagram
- Status: draft → scheduled → sending → sent (ou paused/failed)
- API Route `/api/broadcasts/send` processa fila com throttle (`sendRate` msgs/seg)
- Stats em tempo real: total, sent, delivered, read, failed, replied

---

## Financeiro Enterprise

Quando `business.enterprise.isEnabled`, o módulo financeiro exibe cards adicionais:

| Card | Fonte de dados |
|------|---------------|
| **Receita por Canal** | `transaction.channelType` (whatsapp/facebook/instagram) |
| **Receita por Setor** | `transaction.sectorId` → nome/cor do setor |
| **ROI de Campanhas** | `transaction.campaignId` → custo estimado vs receita |
| **CLV Top 10** | `transaction.contactId` → valor acumulado por contato CRM |

Transações com `sectorId` podem ser filtradas por departamento nos relatórios.

---

## Embedded Signup (Meta)

### Fluxo
1. Admin clica "Conectar com Meta" em Settings → Canais
2. FB JS SDK carrega e abre `FB.login()` com scopes omnichannel
3. Código é enviado para `/api/channels/meta-signup`
4. Backend troca código por token de acesso via Graph API
5. Retorna credenciais (WhatsApp WABA, Facebook Page, Instagram)
6. Frontend salva em `businesses/{businessId}.channels`

### Variáveis de ambiente necessárias
```env
NEXT_PUBLIC_META_APP_ID=         # FB SDK client-side
META_APP_SECRET=                 # Token exchange server-side
META_CONFIG_ID=                  # Login for Business config
```

---

## Adicionando Campos a Registros Existentes

Quando adicionar presença/último login a qualquer exibição de usuário, use **sempre 3 estados** (não mais 2):

```typescript
// ✅ CORRETO — padrão com 3 estados
const displayStatus = getMemberDisplayStatus(member); // 'online' | 'busy' | 'offline'

<div className={cn('w-2 h-2 rounded-full',
  displayStatus === 'online' ? 'bg-emerald-400' :
  displayStatus === 'busy'   ? 'bg-amber-400' :
  'bg-gray-300 dark:bg-gray-600'
)} />

// ❌ ANTIGO — não use mais (ignora busy e invisible)
const online = isOnline(member);
<div className={cn('w-2 h-2 rounded-full', online ? 'bg-emerald-400' : 'bg-gray-300')} />
```

Ao criar ou atualizar qualquer documento que envolve um usuário (assignedTo, operatorId, etc.), inclua também o nome para evitar lookups extras:
```typescript
await setDoc(doc(db, 'colecao', id), {
  operatorId: user.uid,
  operatorName: user.name,   // sempre inclua o nome junto
  businessId: business.id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
```

---

## Arquitetura da TopBar (`app/components/layout/TopBar.tsx`)

A TopBar é composta por sub-componentes internos ao arquivo:

| Componente | Responsabilidade |
|------------|-----------------|
| `TeamPresencePanel` | Dropdown com todos os membros em tempo real (`onSnapshot`). Exibe dot tricolor. Conta apenas online + busy como "ativos". |
| `ThemeToggle` | Dropdown: Claro / Escuro / Sistema |
| `TopBar` (export default) | Container principal — avatar, status dot, user dropdown com mini picker de status |

### Status dot no avatar

O avatar do usuário (no botão da TopBar e dentro do dropdown) exibe um dot colorido no canto inferior direito:
- Verde (`bg-emerald-400`) → online
- Âmbar (`bg-amber-400`) → busy
- Cinza (`bg-gray-400`) → invisible ou offline

### Mini picker de status no dropdown

O user dropdown tem um picker interativo de status que substitui o antigo "Online agora" estático:
- Exibe o status atual como botão colorido (com `bg` e `text` do `STATUS_CFG`)
- Ao clicar, expande um sub-painel com 4 opções
- Persiste via `updateUserProfile({ userStatus: status })`
- O `TeamPresencePanel` atualiza automaticamente via `onSnapshot` — sem polling

### `STATUS_CFG` — cores por status

Definido em `TopBar.tsx`, `DashboardModule.tsx` e `SettingsModule.tsx` (manter consistente):
- online: emerald-400/50/700 | busy: amber-400/50/700 | invisible/offline: gray-400/100/500

---

## Firebase — Variáveis de Ambiente

```env
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

Sem essas vars, o app usa valores demo (`demo-api-key` etc.) e não conecta ao Firebase real.

---

## Coleções Firestore — Referência Rápida

| Coleção | Filter obrigatório | Doc ID |
|---------|-------------------|--------|
| `users` | — (lookup por uid) | `uid` do Firebase Auth |
| `businesses` | — (lookup por id) | `{uid}_biz` ou gerado |
| `inviteCodes` | `businessId` | o próprio código 6-char |
| `clients` | `businessId` | auto (addDoc) |
| `appointments` | `businessId` | auto |
| `sales` | `businessId` | auto |
| `transactions` | `businessId` | auto |
| `products` | `businessId` | auto |
| `kanbanBoards` | `businessId` | auto |
| `kanbanCards` | `boardId` + `businessId` | auto |
| `crmContacts` | `businessId` | auto |
| `crmDeals` | `businessId` | auto |
| `fiscalDocuments` | `businessId` | auto |
| `saasApiKeys` | `businessId` | auto |
| `sectors` | `businessId` | auto |
| `snippets` | `businessId` | auto |
| `segments` | `businessId` | auto |
| `broadcasts` | `businessId` | auto |
| `broadcastMessages` | `businessId` + `broadcastId` | auto |

---

## Erros Comuns — Nunca Faça Isso

```typescript
// ❌ Query sem businessId
const q = query(collection(db, 'clients'));

// ❌ new Date() sem validação
new Intl.DateTimeFormat().format(new Date(undefined)); // RangeError!
// ✅ Use formatDate() que já valida

// ❌ Criar documento sem businessId
await setDoc(doc(db, 'products', id), { name: 'Produto' });
// ✅ Sempre inclua businessId

// ❌ Confiar apenas em user.isOnline para determinar status
if (user.isOnline) { ... }
// ✅ Use getMemberDisplayStatus() — leva em conta invisible, busy e heartbeat
const status = getMemberDisplayStatus(member); // 'online' | 'busy' | 'offline'

// ❌ Ignorar userStatus === 'invisible' ao exibir presença de outros
// Um usuário invisível TEM isOnline: true mas DEVE aparecer como offline para os outros
const visible = member.isOnline; // ERRADO
const visible = getMemberDisplayStatus(member) !== 'offline'; // CORRETO

// ❌ Mostrar apenas 2 estados (online/offline) — ignora o estado "ocupado"
// ✅ Sempre trate 3 estados: online (verde) | busy (âmbar) | offline (cinza)

// ❌ Importar firebase diretamente em Server Components
// ✅ Todo acesso ao Firebase é 'use client' ou API routes

// ❌ Usar ROLE_HIERARCHY para comparação de string
if (user.role === 'admin' || user.role === 'founder') { ... }
// ✅ Preferível usar hierarquia numérica
if (ROLE_HIERARCHY[user.role] >= ROLE_HIERARCHY['admin']) { ... }

// ❌ Renderizar abas de empresa/fiscal/usuários para todos os roles em Settings
// ✅ Essas abas são exclusivas de admin e founder — verificar com ROLE_HIERARCHY

// ❌ Alterar o status via campo isOnline diretamente para representar "busy" ou "invisible"
// ✅ Use o campo userStatus: 'busy' | 'invisible' — isOnline é apenas para heartbeat automático
await updateUserProfile({ userStatus: 'busy' }); // CORRETO
```

---

## Modo Enterprise & Integrações

### Visão Geral

O sistema possui um **modo Enterprise** que transforma o ServicePro de um ERP para prestadores de serviço em uma plataforma de gestão para equipes de SaaS modernas. Quando ativado, habilita:

1. **Integrações externas** com serviços via API key (Stripe, OpenAI, Anthropic, GitHub, Vercel, Resend, Discord)
2. **Dashboard de integrações** multi-tab com dados em tempo real de cada serviço
3. **API Keys próprias** do ServicePro para acesso externo (ex: automação via WhatsApp)

### Ativação

O Enterprise mode é ativado em **Configurações → Enterprise** (aba visível apenas para admin/founder). Um toggle salva `enterprise.isEnabled: true` no documento `businesses/{businessId}`.

### Estrutura no Firestore

```typescript
// No documento businesses/{businessId}
enterprise?: {
  isEnabled: boolean;
  enabledAt?: string;
  integrations: IntegrationConfig[];  // API keys das integrações externas
  apiKeys: SaasApiKey[];              // API keys do próprio ServicePro
}

// Coleção separada para API keys (com businessId filter)
saasApiKeys/{id}: {
  businessId: string;
  name: string;
  keyPrefix: string;    // primeiros 8 chars para exibição
  keyHash: string;      // SHA-256 hash (nunca armazena plaintext)
  scopes: ApiKeyScope[];
  status: 'active' | 'revoked';
  createdAt: string;
  expiresAt?: string;
  // ...
}
```

### Integrações Disponíveis

| Provedor | Auth | Dados Exibidos |
|----------|------|----------------|
| **Stripe** | Secret Key (`sk_live_...`) | MRR, assinaturas, receita, disputas, cobranças recentes |
| **OpenAI** | Admin Key (`sk-admin-...`) | Custo 30d, tokens (input/output/cache), uso por modelo, custo diário |
| **Anthropic** | Admin Key (`sk-ant-admin-...`) | Custo 30d, tokens, cache efficiency, uso por modelo e workspace |
| **GitHub** | PAT (`ghp_...`) | Repos, PRs abertos, issues, contribuidores, atividade recente |
| **Vercel** | Access Token | Projetos, deploys, taxa de sucesso, domínios |
| **Resend** | API Key (`re_...`) | E-mails enviados, taxa de entrega, domínios, e-mails recentes |
| **Discord** | Bot Token + Guild ID | Membros, online, canais, boost level |

### API Routes (Server-side Proxy)

Todas as chamadas às APIs externas passam por rotas server-side para proteger as API keys:

```
app/api/integrations/
├── stripe/route.ts      GET — proxy para Stripe API
├── openai/route.ts      GET — proxy para OpenAI Usage API
├── anthropic/route.ts   GET — proxy para Anthropic Usage API
├── github/route.ts      GET — proxy para GitHub REST API
├── vercel/route.ts      GET — proxy para Vercel API
├── resend/route.ts      GET — proxy para Resend API
└── discord/route.ts     GET — proxy para Discord API
```

Cada rota recebe a API key via header `x-api-key` e retorna dados estruturados para o dashboard.

### Arquitetura

Organizado por **função** em `integrations/tabs/` (OverviewTab, RevenueTab, AICostsTab, DevelopmentTab, CommunicationTab, TeamTab) + `integrations/shared/` (KPICard, ProgressBar, utils). O item "Integrações" aparece na sidebar com badge "Pro" (gradiente violeta). `MenuPage` inclui `'Integrações'`. O IntegrationsModule busca membros via `onSnapshot` e passa como prop para todos os tabs.
