'use client';

/**
 * Wrapper "Agendar atendimento" disparado de dentro de uma conversa.
 *
 * Decide o que mostrar baseado em `conversation.crmContactId`:
 *   - JÁ vinculada → renderiza AppointmentFormDialog direto com initialData
 *     pré-preenchido (cliente, telefone, próximo slot prático)
 *   - SEM vínculo → renderiza tela de transição com:
 *       (a) busca de cliente existente (clique linka)
 *       (b) botão "Criar a partir desta conversa" (quickCreate-like)
 *       (c) Cancelar
 *     Após escolha, transita pro AppointmentFormDialog.
 *
 * Não modifica conversa em modo (a) ou (b) — o link/criação só persiste
 * QUANDO o operador efetivamente salva o agendamento (evita Client órfão
 * se ele desistir do agendamento depois de escolher cliente).
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import { X, Search, UserPlus, AlertCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/config/firebase';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/utils/format';
import type { Appointment, Conversation, Client, Service, User } from '@/lib/types';
import {
  AppointmentFormDialog,
  type AppointmentFormData,
} from '@/app/components/features/agenda/AppointmentFormDialog';
import { nextPracticalSlot, addDurationToTime } from '@/app/components/features/agenda/shared';
import { scheduleFromConversation, AppointmentConflictError } from '@/lib/services/scheduleFromConversation';
import { sendConversationToPipeline } from '@/lib/services/conversationToPipeline';
import { checkAppointmentConflict } from '@/lib/services/appointmentConflicts';

interface Props {
  open: boolean;
  conversation: Conversation | null;
  clients: Client[];
  services: Service[];
  members: User[];
  businessId: string;
  /** Operador autenticado — usado pra audit fields ao criar Client. */
  currentUser: { id: string; name: string };
  onClose: () => void;
}

/** Sub-estado do wrapper: 'select-client' (sem crmContactId) ou 'schedule'
 *  (cliente resolvido — pronto pro AppointmentFormDialog). */
type WrapperStep = 'select-client' | 'schedule';

export function ScheduleFromConversationDialog({
  open,
  conversation,
  clients,
  services,
  members,
  businessId,
  currentUser,
  onClose,
}: Props) {
  // Cliente que vai pro form. Quando conversa já tem crmContactId, esse é
  // resolvido direto via clients.find. Quando o operador escolhe em
  // select-client, gravamos aqui pra alimentar o AppointmentFormDialog.
  const [resolvedClient, setResolvedClient] = useState<Client | null>(null);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<WrapperStep>('select-client');
  const [clientSearch, setClientSearch] = useState('');
  const [creatingClient, setCreatingClient] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Appointments futuros do tenant — usados para checagem de conflito no
  // form. Carregados via getDocs (snapshot único) ao entrar no step
  // 'schedule', filtrando por businessId + date >= hoje pra limitar payload.
  // onSnapshot seria overkill: appointments raramente mudam durante o ato
  // de agendar; basta tirar uma foto.
  const [dayAppointments, setDayAppointments] = useState<Appointment[]>([]);

  // Resolve estado inicial sempre que abre (ou conversa muda).
  useEffect(() => {
    if (!open || !conversation) return;
    const linked = conversation.crmContactId
      ? clients.find(c => c.id === conversation.crmContactId)
      : null;
    if (linked) {
      setResolvedClient(linked);
      setStep('schedule');
    } else {
      setResolvedClient(null);
      setStep('select-client');
      setClientSearch('');
      // Foco no input depois do reflow.
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [open, conversation, clients]);

  // Filtra clientes pelo termo de busca. Sem busca, mostra os 8 mais recentes
  // (sorted por updatedAt ou createdAt).
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) {
      return [...clients]
        .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))
        .slice(0, 8);
    }
    const q = clientSearch.toLowerCase();
    return clients
      .filter(c =>
        (c.name?.toLowerCase() ?? '').includes(q) ||
        (c.phone && c.phone.includes(clientSearch)) ||
        (c.whatsapp && c.whatsapp.includes(clientSearch)) ||
        (c.email?.toLowerCase() ?? '').includes(q),
      )
      .slice(0, 20);
  }, [clientSearch, clients]);

  if (!conversation) return null;

  /** Linka cliente existente. NÃO escreve no Firestore aqui — só atualiza
   *  state local. A persistência (linka conversation + escreve channelIdentities)
   *  vive em sendConversationToPipeline OU é feita pelo handler genérico de
   *  vincular cliente quando o operador clica em outro lugar. */
  const handleSelectExistingClient = (client: Client) => {
    setResolvedClient(client);
    setStep('schedule');
  };

  /** Cria cliente a partir da conversa (mesmo padrão de "Enviar para o
   *  pipeline"). Reusa sendConversationToPipeline com status='novo' —
   *  matiz: usa o caminho que já cobre matching por telefone (evita
   *  duplicata se cliente existe mas não foi linkado antes). */
  const handleCreateClientFromConversation = async () => {
    setCreatingClient(true);
    try {
      const result = await sendConversationToPipeline({
        conversation,
        clients,
        businessId,
        targetStage: 'novo',
      });
      const newOrLinkedClient = clients.find(c => c.id === result.clientId);
      // Se acabou de criar (outcome 'created'), o onSnapshot ainda não
      // reconciliou clientsList. Monta um Client mínimo pra alimentar o
      // AppointmentFormDialog sem esperar.
      const stub: Client = newOrLinkedClient ?? {
        id: result.clientId,
        businessId,
        name: (conversation.customContactName ?? conversation.contactName) || 'Novo contato',
        phone: conversation.channel === 'whatsapp' ? undefined : conversation.contactPhone,
        whatsapp: conversation.channel === 'whatsapp' ? conversation.contactPhone : undefined,
        tipo: 'pf',
        source: conversation.channel,
        status: 'novo',
        score: 0,
        isActive: true,
        totalSpent: 0,
        visitCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as Client;
      setResolvedClient(stub);
      setStep('schedule');
      const action = result.outcome === 'created' ? 'criado' : result.outcome === 'linked' ? 'vinculado' : 'atualizado';
      toast.success(`Cliente ${action} — escolha serviço e horário.`);
    } catch (err) {
      console.error('[ScheduleFromConversation] create client failed:', err);
      toast.error('Não foi possível criar o cliente. Tente vincular um existente.');
    } finally {
      setCreatingClient(false);
    }
  };

  /** Persiste o appointment via service. AppointmentFormDialog dispara
   *  via onSave. Bloqueia conflito antes do write — UI já avisa visualmente
   *  mas o save handler é a última barreira (também evita race: appointment
   *  pode ter sido criado por outro operador desde o último checkConflicts). */
  const handleSaveAppointment = async (formData: AppointmentFormData) => {
    if (!resolvedClient) {
      toast.error('Selecione um cliente antes de agendar.');
      return;
    }
    // Re-checa conflito no momento do save (snapshot pode ter mudado).
    if (formData.professionalId) {
      const conflict = checkConflicts(
        formData.professionalId,
        formData.date,
        formData.startTime,
        addDurationToTime(formData.startTime, formData.duration),
      );
      if (conflict.hasConflict) {
        toast.error(`Não foi possível agendar: ${conflict.message}`);
        return;
      }
    }
    setSaving(true);
    try {
      await scheduleFromConversation({
        formData: {
          ...formData,
          clientId: resolvedClient.id,
          clientName: resolvedClient.name,
        },
        conversation,
        businessId,
        members,
      });
      toast.success(`Agendamento criado para ${formData.date} às ${formData.startTime}.`);
      onClose();
    } catch (err) {
      // Race lost: outro operador (agenda ou outra conversa) salvou no
      // mesmo slot entre nosso pre-check e o commit da tx. Mensagem
      // detalhada vem do servidor com nome do cliente conflitante.
      if (err instanceof AppointmentConflictError) {
        toast.error(`Não foi possível agendar: ${err.message}`);
        return;
      }
      console.error('[ScheduleFromConversation] save failed:', err);
      toast.error('Falha ao criar agendamento. Tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  // Carrega appointments futuros (date >= hoje) ao entrar no step 'schedule'.
  // getDocs (não onSnapshot) — uma foto basta pra checagem de conflito da
  // operação atual. Limita por businessId + data pra payload pequeno.
  useEffect(() => {
    if (step !== 'schedule' || !open) return;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayISO = `${yyyy}-${mm}-${dd}`;
    const q = query(
      collection(db, 'appointments'),
      where('businessId', '==', businessId),
      where('date', '>=', todayISO),
    );
    getDocs(q)
      .then(snap => {
        const list = snap.docs.map(d => ({ ...(d.data() as Appointment), id: d.id }));
        setDayAppointments(list);
      })
      .catch(err => {
        // Fail-open: sem appointments carregados, checkConflicts retorna
        // sempre "sem conflito". Pior caso é operador agendar conflito sem
        // aviso — ainda assim, melhor que bloquear o agendamento.
        console.warn('[ScheduleFromConversation] failed to load appointments for conflict check:', err);
        setDayAppointments([]);
      });
  }, [step, open, businessId]);

  /** Função passada ao AppointmentFormDialog. Delega à função pura
   *  checkAppointmentConflict usando o snapshot de appointments carregado.
   *  Estável via useCallback pra não re-renderizar o form a cada keystroke. */
  const checkConflicts = useCallback(
    (professionalId: string, date: string, startTime: string, endTime: string, excludeId?: string) =>
      checkAppointmentConflict({
        appointments: dayAppointments,
        members,
        professionalId,
        date,
        startTime,
        endTime,
        excludeId,
      }),
    [dayAppointments, members],
  );

  // initialData pra AppointmentFormDialog. Próximo slot prático evita
  // operador ter que mexer em data/hora pra "agendar pra logo mais".
  const initialData: Partial<AppointmentFormData> = useMemo(() => {
    if (!resolvedClient) return {};
    const slot = nextPracticalSlot();
    return {
      clientId: resolvedClient.id,
      clientName: resolvedClient.name,
      clientPhone: resolvedClient.phone || resolvedClient.whatsapp || conversation.contactPhone || '',
      date: slot.date,
      startTime: slot.startTime,
    };
  }, [resolvedClient, conversation.contactPhone]);

  // Step 'schedule': renderiza o AppointmentFormDialog padrão. Note que ele
  // já tem seu próprio Dialog do MUI — não envelopamos.
  if (step === 'schedule') {
    return (
      <AppointmentFormDialog
        open={open}
        onClose={onClose}
        onSave={handleSaveAppointment}
        services={services}
        clients={clients}
        members={members}
        saving={saving}
        initialData={initialData}
        isEditing={false}
        checkConflicts={checkConflicts}
      />
    );
  }

  // Step 'select-client': mini-dialog próprio.
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 3, pt: 2.5, pb: 1 }}>
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Agendar atendimento</span>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
          aria-label="Fechar"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
        <div className="space-y-4 py-2">
          {/* Banner explicando o estado da conversa */}
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                Vincule um cliente pra continuar
              </div>
              <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                Esta conversa ainda não está vinculada a um cliente cadastrado. Escolha um existente ou crie um novo a partir do contato da conversa.
              </div>
            </div>
          </div>

          {/* Busca de cliente existente */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Vincular cliente existente
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <input
                ref={searchInputRef}
                type="text"
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Nome, telefone ou e-mail..."
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
            <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-gray-100 dark:border-gray-800">
              <AnimatePresence>
                {filteredClients.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                    Nenhum cliente encontrado
                  </div>
                ) : (
                  filteredClients.map((c) => (
                    <motion.button
                      key={c.id}
                      initial={{ opacity: 0, y: -2 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => handleSelectExistingClient(c)}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/[0.04] flex items-center gap-2.5 transition-colors border-b border-gray-50 dark:border-white/[0.03] last:border-b-0"
                    >
                      <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-[10px] font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
                        {getInitials(c.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{c.name}</div>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                          {c.phone || c.whatsapp || c.email || '—'}
                        </div>
                      </div>
                    </motion.button>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Separador "OU" */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
            <span className="text-[10px] font-bold text-gray-300 dark:text-gray-600 uppercase tracking-wider">ou</span>
            <div className="flex-1 h-px bg-gray-100 dark:bg-white/[0.06]" />
          </div>

          {/* Criar a partir da conversa */}
          <button
            onClick={handleCreateClientFromConversation}
            disabled={creatingClient}
            className={cn(
              'w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30',
              'bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {creatingClient ? 'Criando...' : 'Criar cliente a partir desta conversa'}
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 truncate">
                Nome: {conversation.customContactName ?? conversation.contactName ?? '—'} · Telefone: {conversation.contactPhone || '—'}
              </div>
            </div>
          </button>
        </div>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2.5 }}>
        <button
          onClick={onClose}
          className={cn(
            'px-5 py-2.5 rounded-xl text-sm font-medium',
            'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.06] border border-gray-200 dark:border-gray-700',
            'transition-all duration-200',
          )}
        >
          Cancelar
        </button>
      </DialogActions>
    </Dialog>
  );
}
