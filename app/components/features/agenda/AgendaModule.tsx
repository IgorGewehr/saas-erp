'use client';

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import {
  format,
  addDays,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  getDay,
  getHours,
  getMinutes,
  setHours,
  setMinutes,
  differenceInMinutes,
  isAfter,
  isBefore,
  startOfDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  User,
  Phone,
  Mail,
  X,
  Check,
  Edit3,
  Trash2,
  MapPin,
  DollarSign,
  FileText,
  LayoutGrid,
  Columns3,
  CalendarDays,
  Search,
  ChevronDown,
} from 'lucide-react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Tooltip from '@mui/material/Tooltip';
import Chip from '@mui/material/Chip';
import Popover from '@mui/material/Popover';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { cn } from '@/lib/utils';
import { formatCurrency, getStatusColor, getStatusLabel } from '@/lib/utils/format';
import type { Appointment, AppointmentStatus, Service } from '@/lib/types';

// ==========================================
// CONSTANTS
// ==========================================

const HOUR_HEIGHT = 64; // px per hour row
const HALF_HOUR_HEIGHT = HOUR_HEIGHT / 2;
const START_HOUR = 6;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const TIME_SLOTS: string[] = [];

for (let h = START_HOUR; h <= END_HOUR; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  if (h < END_HOUR) {
    TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
  }
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  agendado: '#3B82F6',
  confirmado: '#10B981',
  em_andamento: '#F59E0B',
  concluido: '#6366F1',
  cancelado: '#EF4444',
  nao_compareceu: '#6B7280',
};

const STATUS_BG_COLORS: Record<AppointmentStatus, string> = {
  agendado: 'rgba(59,130,246,0.12)',
  confirmado: 'rgba(16,185,129,0.12)',
  em_andamento: 'rgba(245,158,11,0.12)',
  concluido: 'rgba(99,102,241,0.12)',
  cancelado: 'rgba(239,68,68,0.12)',
  nao_compareceu: 'rgba(107,114,128,0.12)',
};

const STATUS_OPTIONS: { value: AppointmentStatus; label: string }[] = [
  { value: 'agendado', label: 'Agendado' },
  { value: 'confirmado', label: 'Confirmado' },
  { value: 'em_andamento', label: 'Em Andamento' },
  { value: 'concluido', label: 'Concluído' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'nao_compareceu', label: 'Não Compareceu' },
];

const DURATION_OPTIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1h 30min' },
  { value: 120, label: '2 horas' },
];

type ViewMode = 'day' | 'week' | 'month';

// ==========================================
// MOCK DATA
// ==========================================

function generateMockAppointments(): Appointment[] {
  const today = new Date();
  const monday = startOfWeek(today, { weekStartsOn: 1 });

  const mockClients = [
    { id: 'c1', name: 'Maria Silva', phone: '(11) 98765-4321', email: 'maria@email.com' },
    { id: 'c2', name: 'João Santos', phone: '(11) 91234-5678', email: 'joao@email.com' },
    { id: 'c3', name: 'Ana Oliveira', phone: '(21) 99876-5432', email: 'ana@email.com' },
    { id: 'c4', name: 'Carlos Souza', phone: '(11) 97654-3210', email: 'carlos@email.com' },
    { id: 'c5', name: 'Beatriz Lima', phone: '(31) 98765-1234', email: 'beatriz@email.com' },
    { id: 'c6', name: 'Pedro Mendes', phone: '(11) 96543-2109', email: 'pedro@email.com' },
    { id: 'c7', name: 'Juliana Costa', phone: '(21) 95432-1098', email: 'juliana@email.com' },
    { id: 'c8', name: 'Roberto Alves', phone: '(11) 94321-0987', email: 'roberto@email.com' },
    { id: 'c9', name: 'Fernanda Dias', phone: '(31) 93210-9876', email: 'fernanda@email.com' },
    { id: 'c10', name: 'Lucas Pereira', phone: '(11) 92109-8765', email: 'lucas@email.com' },
  ];

  const mockServices = [
    { id: 's1', name: 'Corte de Cabelo', duration: 45, price: 80, color: '#3B82F6' },
    { id: 's2', name: 'Coloração', duration: 120, price: 250, color: '#8B5CF6' },
    { id: 's3', name: 'Manicure', duration: 60, price: 60, color: '#EC4899' },
    { id: 's4', name: 'Pedicure', duration: 60, price: 70, color: '#F97316' },
    { id: 's5', name: 'Hidratação', duration: 90, price: 150, color: '#06B6D4' },
    { id: 's6', name: 'Barba', duration: 30, price: 45, color: '#84CC16' },
    { id: 's7', name: 'Progressiva', duration: 180, price: 350, color: '#F59E0B' },
    { id: 's8', name: 'Escova', duration: 45, price: 65, color: '#10B981' },
  ];

  const statuses: AppointmentStatus[] = [
    'agendado',
    'confirmado',
    'em_andamento',
    'concluido',
    'agendado',
    'confirmado',
  ];

  const appointments: Appointment[] = [];
  const now = new Date();

  // Appointment definitions: [dayOffset from monday, hour, minuteOffset, clientIdx, serviceIdx, statusIdx]
  const defs: [number, number, number, number, number, number][] = [
    [0, 9, 0, 0, 0, 3],   // Monday 09:00 - Maria - Corte - concluido
    [0, 10, 0, 1, 5, 3],  // Monday 10:00 - João - Barba - concluido
    [0, 14, 0, 2, 2, 1],  // Monday 14:00 - Ana - Manicure - confirmado
    [1, 8, 30, 3, 0, 0],  // Tuesday 08:30 - Carlos - Corte - agendado
    [1, 11, 0, 4, 1, 1],  // Tuesday 11:00 - Beatriz - Coloração - confirmado
    [1, 15, 30, 5, 4, 0], // Tuesday 15:30 - Pedro - Hidratação - agendado
    [2, 9, 0, 6, 7, 1],   // Wednesday 09:00 - Juliana - Escova - confirmado
    [2, 10, 30, 7, 0, 2], // Wednesday 10:30 - Roberto - Corte - em_andamento
    [2, 13, 0, 8, 3, 0],  // Wednesday 13:00 - Fernanda - Pedicure - agendado
    [2, 16, 0, 9, 6, 0],  // Wednesday 16:00 - Lucas - Progressiva - agendado
    [3, 8, 0, 0, 2, 1],   // Thursday 08:00 - Maria - Manicure - confirmado
    [3, 10, 0, 1, 4, 0],  // Thursday 10:00 - João - Hidratação - agendado
    [3, 14, 30, 2, 0, 4], // Thursday 14:30 - Ana - Corte - agendado
    [4, 9, 30, 3, 7, 1],  // Friday 09:30 - Carlos - Escova - confirmado
    [4, 11, 0, 4, 5, 0],  // Friday 11:00 - Beatriz - Barba - agendado
    [4, 14, 0, 5, 1, 1],  // Friday 14:00 - Pedro - Coloração - confirmado
    [4, 16, 30, 6, 3, 0], // Friday 16:30 - Juliana - Pedicure - agendado
    [5, 9, 0, 7, 0, 0],   // Saturday 09:00 - Roberto - Corte - agendado
    [5, 11, 0, 8, 2, 1],  // Saturday 11:00 - Fernanda - Manicure - confirmado
  ];

  defs.forEach(([dayOff, hour, minute, cIdx, sIdx, stIdx], idx) => {
    const client = mockClients[cIdx];
    const service = mockServices[sIdx];
    const date = addDays(monday, dayOff);
    const startH = String(hour).padStart(2, '0');
    const startM = String(minute).padStart(2, '0');
    const endDate = new Date(date);
    endDate.setHours(hour, minute + service.duration);
    const endH = String(endDate.getHours()).padStart(2, '0');
    const endM = String(endDate.getMinutes()).padStart(2, '0');

    // For past appointments, mark as concluido
    const appointmentDate = new Date(date);
    appointmentDate.setHours(hour, minute);
    let status = statuses[stIdx];
    if (isBefore(appointmentDate, now) && status !== 'cancelado' && status !== 'nao_compareceu') {
      if (differenceInMinutes(now, appointmentDate) > service.duration) {
        status = 'concluido';
      } else if (differenceInMinutes(now, appointmentDate) > 0) {
        status = 'em_andamento';
      }
    }

    appointments.push({
      id: `mock-${idx + 1}`,
      businessId: 'mock-business',
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      serviceId: service.id,
      serviceName: service.name,
      professionalId: 'prof-1',
      professionalName: 'Dr. Ricardo',
      date: format(date, 'yyyy-MM-dd'),
      startTime: `${startH}:${startM}`,
      endTime: `${endH}:${endM}`,
      duration: service.duration,
      status,
      price: service.price,
      notes: idx % 3 === 0 ? 'Cliente preferencial' : undefined,
      color: service.color,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  return appointments;
}

const MOCK_SERVICES: Service[] = [
  { id: 's1', businessId: 'mock', name: 'Corte de Cabelo', duration: 45, price: 80, color: '#3B82F6', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's2', businessId: 'mock', name: 'Coloração', duration: 120, price: 250, color: '#8B5CF6', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's3', businessId: 'mock', name: 'Manicure', duration: 60, price: 60, color: '#EC4899', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's4', businessId: 'mock', name: 'Pedicure', duration: 60, price: 70, color: '#F97316', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's5', businessId: 'mock', name: 'Hidratação', duration: 90, price: 150, color: '#06B6D4', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's6', businessId: 'mock', name: 'Barba', duration: 30, price: 45, color: '#84CC16', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's7', businessId: 'mock', name: 'Progressiva', duration: 180, price: 350, color: '#F59E0B', isActive: true, createdAt: '', updatedAt: '' },
  { id: 's8', businessId: 'mock', name: 'Escova', duration: 45, price: 65, color: '#10B981', isActive: true, createdAt: '', updatedAt: '' },
];

const MOCK_CLIENTS = [
  { id: 'c1', name: 'Maria Silva', phone: '(11) 98765-4321', email: 'maria@email.com' },
  { id: 'c2', name: 'João Santos', phone: '(11) 91234-5678', email: 'joao@email.com' },
  { id: 'c3', name: 'Ana Oliveira', phone: '(21) 99876-5432', email: 'ana@email.com' },
  { id: 'c4', name: 'Carlos Souza', phone: '(11) 97654-3210', email: 'carlos@email.com' },
  { id: 'c5', name: 'Beatriz Lima', phone: '(31) 98765-1234', email: 'beatriz@email.com' },
  { id: 'c6', name: 'Pedro Mendes', phone: '(11) 96543-2109', email: 'pedro@email.com' },
  { id: 'c7', name: 'Juliana Costa', phone: '(21) 95432-1098', email: 'juliana@email.com' },
  { id: 'c8', name: 'Roberto Alves', phone: '(11) 94321-0987', email: 'roberto@email.com' },
  { id: 'c9', name: 'Fernanda Dias', phone: '(31) 93210-9876', email: 'fernanda@email.com' },
  { id: 'c10', name: 'Lucas Pereira', phone: '(11) 92109-8765', email: 'lucas@email.com' },
];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getAppointmentTop(startTime: string): number {
  const minutes = timeToMinutes(startTime);
  const offsetMinutes = minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
}

function getAppointmentHeight(duration: number): number {
  return Math.max((duration / 60) * HOUR_HEIGHT, 24);
}

function getCurrentTimeOffset(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const offsetMinutes = minutes - START_HOUR * 60;
  return (offsetMinutes / 60) * HOUR_HEIGHT;
}

function generateTimeOptions(): string[] {
  const options: string[] = [];
  for (let h = 6; h <= 21; h++) {
    options.push(`${String(h).padStart(2, '0')}:00`);
    options.push(`${String(h).padStart(2, '0')}:30`);
  }
  return options;
}

const TIME_OPTIONS = generateTimeOptions();

function addDurationToTime(startTime: string, duration: number): string {
  const totalMinutes = timeToMinutes(startTime) + duration;
  return minutesToTime(totalMinutes);
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

// ---- Current Time Line ----
function CurrentTimeLine() {
  const [offset, setOffset] = useState(getCurrentTimeOffset());

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(getCurrentTimeOffset());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const now = new Date();
  const currentHour = now.getHours();
  if (currentHour < START_HOUR || currentHour >= END_HOUR) return null;

  return (
    <div
      className="absolute left-0 right-0 z-30 pointer-events-none flex items-center"
      style={{ top: `${offset}px` }}
    >
      <div className="w-2.5 h-2.5 rounded-full bg-red-600 -ml-1 shadow-sm shadow-red-600/40" />
      <div className="flex-1 h-[2px] bg-red-600 shadow-sm shadow-red-600/30" />
    </div>
  );
}

// ---- Mini Calendar ----
interface MiniCalendarProps {
  selectedDate: Date;
  onSelect: (date: Date) => void;
  appointments: Appointment[];
}

function MiniCalendar({ selectedDate, onSelect, appointments }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(selectedDate));

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const datesWithAppointments = useMemo(() => {
    const set = new Set<string>();
    appointments.forEach((a) => set.add(a.date));
    return set;
  }, [appointments]);

  return (
    <div className="p-3 w-[280px]">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <ChevronLeft className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 capitalize">
          {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
        </span>
        <button
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          className="p-1 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-md transition-colors"
        >
          <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[11px] font-medium text-gray-400 dark:text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const isCurrentMonth = isSameMonth(day, viewMonth);
          const isSelected = isSameDay(day, selectedDate);
          const isTodayDate = isToday(day);
          const hasAppt = datesWithAppointments.has(format(day, 'yyyy-MM-dd'));

          return (
            <button
              key={i}
              onClick={() => onSelect(day)}
              className={cn(
                'relative w-9 h-9 flex items-center justify-center text-[13px] rounded-lg transition-all duration-150',
                !isCurrentMonth && 'text-gray-300 dark:text-gray-600',
                isCurrentMonth && !isSelected && !isTodayDate && 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                isTodayDate && !isSelected && 'text-red-600 font-bold',
                isSelected && 'bg-red-600 text-white font-semibold shadow-sm',
              )}
            >
              {format(day, 'd')}
              {hasAppt && !isSelected && (
                <span
                  className={cn(
                    'absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full',
                    isTodayDate ? 'bg-red-600' : 'bg-gray-400 dark:bg-gray-500',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Appointment Block (for Day/Week views) ----
interface AppointmentBlockProps {
  appointment: Appointment;
  onClick: (appt: Appointment) => void;
  compact?: boolean;
}

function AppointmentBlock({ appointment, onClick, compact = false }: AppointmentBlockProps) {
  const color = STATUS_COLORS[appointment.status];
  const bgColor = STATUS_BG_COLORS[appointment.status];
  const height = getAppointmentHeight(appointment.duration);
  const isShort = compact || height < 48;

  return (
    <Tooltip
      title={
        <div className="text-xs space-y-1 p-1">
          <div className="font-semibold">{appointment.clientName}</div>
          <div>{appointment.serviceName}</div>
          <div>{appointment.startTime} - {appointment.endTime}</div>
          <div>{getStatusLabel(appointment.status)}</div>
          <div>{formatCurrency(appointment.price)}</div>
        </div>
      }
      arrow
      placement="right"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
        whileHover={{ scale: 1.02, zIndex: 50 }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(appointment);
        }}
        className={cn(
          'absolute left-1 right-1 z-10 rounded-lg cursor-pointer overflow-hidden',
          'border-l-[3px] transition-shadow duration-200',
          'hover:shadow-lg hover:shadow-black/10',
          appointment.status === 'cancelado' && 'opacity-50',
        )}
        style={{
          top: `${getAppointmentTop(appointment.startTime)}px`,
          height: `${height}px`,
          backgroundColor: bgColor,
          borderLeftColor: color,
        }}
      >
        <div className={cn('px-2 h-full flex flex-col justify-center', isShort ? 'py-0.5' : 'py-1.5')}>
          <div
            className={cn(
              'font-semibold truncate leading-tight',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
            style={{ color }}
          >
            {compact ? appointment.clientName.split(' ')[0] : appointment.clientName}
          </div>
          {!isShort && (
            <>
              <div className="text-[10px] text-gray-600 dark:text-gray-400 truncate leading-tight mt-0.5">
                {appointment.serviceName}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight mt-0.5">
                {appointment.startTime} - {appointment.endTime}
              </div>
            </>
          )}
          {isShort && (
            <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate leading-tight">
              {compact
                ? `${appointment.startTime} ${appointment.serviceName.split(' ')[0]}`
                : appointment.startTime}
            </div>
          )}
        </div>
      </motion.div>
    </Tooltip>
  );
}

// ---- New/Edit Appointment Dialog ----
interface AppointmentFormData {
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  duration: number;
  professionalId: string;
  professionalName: string;
  notes: string;
  status: AppointmentStatus;
  price: number;
}

interface AppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: AppointmentFormData) => void;
  onDelete?: () => void;
  initialData?: Partial<AppointmentFormData>;
  isEditing?: boolean;
}

function AppointmentFormDialog({
  open,
  onClose,
  onSave,
  onDelete,
  initialData,
  isEditing = false,
}: AppointmentDialogProps) {
  const [formData, setFormData] = useState<AppointmentFormData>({
    clientId: '',
    clientName: '',
    clientPhone: '',
    serviceId: '',
    serviceName: '',
    date: format(new Date(), 'yyyy-MM-dd'),
    startTime: '09:00',
    duration: 60,
    professionalId: '',
    professionalName: '',
    notes: '',
    status: 'agendado',
    price: 0,
  });
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && initialData) {
      setFormData((prev) => ({ ...prev, ...initialData }));
      setClientSearch(initialData.clientName || '');
    } else if (open) {
      setFormData({
        clientId: '',
        clientName: '',
        clientPhone: '',
        serviceId: '',
        serviceName: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        startTime: '09:00',
        duration: 60,
        professionalId: '',
        professionalName: '',
        notes: '',
        status: 'agendado',
        price: 0,
      });
      setClientSearch('');
    }
  }, [open, initialData]);

  const filteredClients = useMemo(() => {
    if (!clientSearch) return MOCK_CLIENTS;
    return MOCK_CLIENTS.filter((c) =>
      c.name.toLowerCase().includes(clientSearch.toLowerCase())
    );
  }, [clientSearch]);

  const handleServiceChange = (serviceId: string) => {
    const service = MOCK_SERVICES.find((s) => s.id === serviceId);
    if (service) {
      setFormData((prev) => ({
        ...prev,
        serviceId: service.id,
        serviceName: service.name,
        duration: service.duration,
        price: service.price,
      }));
    }
  };

  const handleClientSelect = (client: typeof MOCK_CLIENTS[0]) => {
    setFormData((prev) => ({
      ...prev,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
    }));
    setClientSearch(client.name);
    setShowClientDropdown(false);
  };

  const handleSubmit = () => {
    if (!formData.clientName || !formData.serviceName || !formData.date || !formData.startTime) {
      return;
    }
    onSave(formData);
  };

  const endTime = addDurationToTime(formData.startTime, formData.duration);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          overflow: 'visible',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          pt: 2.5,
          pb: 1,
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {isEditing ? 'Editar Agendamento' : 'Novo Agendamento'}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>
      </DialogTitle>

      <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
        <div className="space-y-4 py-2">
          {/* Client search */}
          <div ref={clientSearchRef} className="relative">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Cliente *
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowClientDropdown(true);
                  setFormData((prev) => ({ ...prev, clientName: e.target.value }));
                }}
                onFocus={() => setShowClientDropdown(true)}
                placeholder="Buscar cliente..."
                className={cn(
                  'w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
            <AnimatePresence>
              {showClientDropdown && filteredClients.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
                >
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => handleClientSelect(client)}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/[0.04] flex items-center gap-3 transition-colors first:rounded-t-xl last:rounded-b-xl"
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {client.name.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{client.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{client.phone}</div>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Service select */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Serviço *
            </label>
            <select
              value={formData.serviceId}
              onChange={(e) => handleServiceChange(e.target.value)}
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
              )}
            >
              <option value="">Selecionar serviço</option>
              {MOCK_SERVICES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} - {formatCurrency(s.price)} ({s.duration} min)
                </option>
              ))}
            </select>
          </div>

          {/* Date and time row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Data *
              </label>
              <input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData((prev) => ({ ...prev, date: e.target.value }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Horário Início *
              </label>
              <select
                value={formData.startTime}
                onChange={(e) => setFormData((prev) => ({ ...prev, startTime: e.target.value }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration and end time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Duração
              </label>
              <select
                value={formData.duration}
                onChange={(e) => setFormData((prev) => ({ ...prev, duration: Number(e.target.value) }))}
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Término
              </label>
              <div className="px-4 py-2.5 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 text-sm text-gray-500 dark:text-gray-400">
                {endTime}
              </div>
            </div>
          </div>

          {/* Professional */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Profissional
            </label>
            <select
              value={formData.professionalName}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  professionalName: e.target.value,
                  professionalId: e.target.value ? 'prof-1' : '',
                }))
              }
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
              )}
            >
              <option value="">Selecionar profissional</option>
              <option value="Dr. Ricardo">Dr. Ricardo</option>
              <option value="Dra. Camila">Dra. Camila</option>
              <option value="Especialista Ana">Especialista Ana</option>
            </select>
          </div>

          {/* Status and Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Status
              </label>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, status: e.target.value as AppointmentStatus }))
                }
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
                  'text-sm text-gray-900 dark:text-gray-100 appearance-none',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                Valor (R$)
              </label>
              <input
                type="number"
                value={formData.price || ''}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, price: Number(e.target.value) }))
                }
                placeholder="0,00"
                className={cn(
                  'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700',
                  'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                  'bg-white dark:bg-gray-800',
                  'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                  'transition-all duration-200',
                )}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
              Observações
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
              rows={3}
              placeholder="Observações adicionais..."
              className={cn(
                'w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 resize-none',
                'text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500',
                'bg-white dark:bg-gray-800',
                'focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500',
                'transition-all duration-200',
              )}
            />
          </div>
        </div>
      </DialogContent>

      <DialogActions
        sx={{
          px: 3,
          py: 2.5,
          gap: 1,
          justifyContent: isEditing ? 'space-between' : 'flex-end',
        }}
      >
        {isEditing && onDelete && (
          <button
            onClick={onDelete}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium',
              'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
            )}
          >
            <Trash2 className="w-4 h-4 inline mr-1.5" />
            Excluir
          </button>
        )}
        <div className="flex gap-2">
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
          <button
            onClick={handleSubmit}
            className={cn(
              'px-5 py-2.5 rounded-xl text-sm font-semibold',
              'bg-red-600 text-white hover:bg-red-700',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            disabled={!formData.clientName || !formData.serviceName}
          >
            {isEditing ? 'Salvar Alterações' : 'Agendar'}
          </button>
        </div>
      </DialogActions>
    </Dialog>
  );
}

// ---- View Appointment Dialog ----
interface ViewAppointmentDialogProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  onEdit: () => void;
  onStatusChange: (status: AppointmentStatus) => void;
}

function ViewAppointmentDialog({
  open,
  onClose,
  appointment,
  onEdit,
  onStatusChange,
}: ViewAppointmentDialogProps) {
  if (!appointment) return null;

  const color = STATUS_COLORS[appointment.status];
  const client = MOCK_CLIENTS.find((c) => c.id === appointment.clientId);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
        },
      }}
    >
      <div className="relative">
        {/* Colored top bar */}
        <div
          className="h-1.5 rounded-t-2xl"
          style={{ backgroundColor: color }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.06] rounded-lg transition-colors z-10"
        >
          <X className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </button>

        <div className="px-6 pt-5 pb-6">
          {/* Header */}
          <div className="flex items-start gap-4 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {appointment.clientName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {appointment.clientName}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{appointment.serviceName}</p>
              <Chip
                label={getStatusLabel(appointment.status)}
                size="small"
                sx={{
                  mt: 1,
                  backgroundColor: STATUS_BG_COLORS[appointment.status],
                  color: color,
                  fontWeight: 600,
                  fontSize: '11px',
                  height: '24px',
                }}
              />
            </div>
          </div>

          {/* Details grid */}
          <div className="space-y-3">
            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <CalendarIcon className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Data</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {format(parseISO(appointment.date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <Clock className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Horário</div>
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {appointment.startTime} - {appointment.endTime} ({appointment.duration} min)
                </div>
              </div>
            </div>

            {client && (
              <>
                <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Telefone</div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{client.phone}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                  <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Email</div>
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{client.email}</div>
                  </div>
                </div>
              </>
            )}

            {appointment.professionalName && (
              <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <User className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Profissional</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{appointment.professionalName}</div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
              <DollarSign className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Valor</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatCurrency(appointment.price)}</div>
              </div>
            </div>

            {appointment.notes && (
              <div className="flex items-start gap-3 py-2.5 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl">
                <FileText className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Observações</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{appointment.notes}</div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button
              onClick={onEdit}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors',
              )}
            >
              <Edit3 className="w-3.5 h-3.5" />
              Editar
            </button>

            {appointment.status === 'agendado' && (
              <button
                onClick={() => onStatusChange('confirmado')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors',
                )}
              >
                <Check className="w-3.5 h-3.5" />
                Confirmar
              </button>
            )}

            {(appointment.status === 'agendado' || appointment.status === 'confirmado') && (
              <button
                onClick={() => onStatusChange('cancelado')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors',
                )}
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </button>
            )}

            {(appointment.status === 'confirmado' || appointment.status === 'em_andamento') && (
              <button
                onClick={() => onStatusChange('concluido')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium',
                  'text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors',
                )}
              >
                <Check className="w-3.5 h-3.5" />
                Concluir
              </button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ==========================================
// MAIN AGENDA MODULE
// ==========================================

export default function AgendaModule() {
  // ---- State ----
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>(() => generateMockAppointments());
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showViewDialog, setShowViewDialog] = useState(false);
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [formInitialData, setFormInitialData] = useState<Partial<AppointmentFormData>>({});
  const [calendarAnchor, setCalendarAnchor] = useState<HTMLElement | null>(null);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const calendarOpen = Boolean(calendarAnchor);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Auto-scroll to current time on mount
  useEffect(() => {
    if (scrollContainerRef.current) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const offsetMinutes = currentMinutes - START_HOUR * 60;
      const scrollTarget = (offsetMinutes / 60) * HOUR_HEIGHT - 200;
      scrollContainerRef.current.scrollTop = Math.max(0, scrollTarget);
    }
  }, [viewMode]);

  // Default to day view on mobile
  useEffect(() => {
    if (isMobile && viewMode === 'week') {
      setViewMode('day');
    }
  }, [isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Computed values ----
  const weekStart = useMemo(() => startOfWeek(currentDate, { weekStartsOn: 0 }), [currentDate]);
  const weekEnd = useMemo(() => endOfWeek(currentDate, { weekStartsOn: 0 }), [currentDate]);
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [weekStart, weekEnd]);
  const monthStart = useMemo(() => startOfMonth(currentDate), [currentDate]);
  const monthEnd = useMemo(() => endOfMonth(currentDate), [currentDate]);

  const monthCalendarDays = useMemo(() => {
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    const end = endOfWeek(monthEnd, { weekStartsOn: 0 });
    return eachDayOfInterval({ start, end });
  }, [monthStart, monthEnd]);

  // Appointments for current view
  const visibleAppointments = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return appointments.filter((a) =>
          isSameDay(parseISO(a.date), currentDate)
        );
      case 'week':
        return appointments.filter((a) => {
          const d = parseISO(a.date);
          return !isBefore(d, weekStart) && !isAfter(d, weekEnd);
        });
      case 'month':
        return appointments.filter((a) => {
          const d = parseISO(a.date);
          return isSameMonth(d, currentDate);
        });
      default:
        return [];
    }
  }, [appointments, viewMode, currentDate, weekStart, weekEnd]);

  // Group appointments by date
  const appointmentsByDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach((a) => {
      const existing = map.get(a.date) || [];
      existing.push(a);
      map.set(a.date, existing);
    });
    return map;
  }, [appointments]);

  // ---- Navigation ----
  const navigatePrev = useCallback(() => {
    setSlideDirection('left');
    switch (viewMode) {
      case 'day':
        setCurrentDate((d) => subDays(d, 1));
        break;
      case 'week':
        setCurrentDate((d) => subWeeks(d, 1));
        break;
      case 'month':
        setCurrentDate((d) => subMonths(d, 1));
        break;
    }
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setSlideDirection('right');
    switch (viewMode) {
      case 'day':
        setCurrentDate((d) => addDays(d, 1));
        break;
      case 'week':
        setCurrentDate((d) => addWeeks(d, 1));
        break;
      case 'month':
        setCurrentDate((d) => addMonths(d, 1));
        break;
    }
  }, [viewMode]);

  const navigateToday = useCallback(() => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  }, []);

  const navigateToDate = useCallback((date: Date) => {
    setCurrentDate(date);
    setSelectedDate(date);
    setCalendarAnchor(null);
  }, []);

  // ---- Period display text ----
  const periodText = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return format(currentDate, "EEEE, dd 'de' MMMM", { locale: ptBR });
      case 'week': {
        const wStart = weekStart;
        const wEnd = weekEnd;
        if (isSameMonth(wStart, wEnd)) {
          return `${format(wStart, 'dd', { locale: ptBR })} - ${format(wEnd, "dd 'de' MMMM yyyy", { locale: ptBR })}`;
        }
        return `${format(wStart, "dd 'de' MMM", { locale: ptBR })} - ${format(wEnd, "dd 'de' MMM yyyy", { locale: ptBR })}`;
      }
      case 'month':
        return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
    }
  }, [viewMode, currentDate, weekStart, weekEnd]);

  // ---- Appointment Actions ----
  const handleAppointmentClick = useCallback((appt: Appointment) => {
    setSelectedAppointment(appt);
    setShowViewDialog(true);
  }, []);

  const handleNewAppointment = useCallback((date?: string, time?: string) => {
    setEditingAppointment(null);
    setFormInitialData({
      date: date || format(currentDate, 'yyyy-MM-dd'),
      startTime: time || '09:00',
    });
    setShowFormDialog(true);
  }, [currentDate]);

  const handleEditAppointment = useCallback(() => {
    if (!selectedAppointment) return;
    setShowViewDialog(false);
    setEditingAppointment(selectedAppointment);
    setFormInitialData({
      clientId: selectedAppointment.clientId,
      clientName: selectedAppointment.clientName,
      clientPhone: selectedAppointment.clientPhone || '',
      serviceId: selectedAppointment.serviceId || '',
      serviceName: selectedAppointment.serviceName,
      date: selectedAppointment.date,
      startTime: selectedAppointment.startTime,
      duration: selectedAppointment.duration,
      professionalId: selectedAppointment.professionalId || '',
      professionalName: selectedAppointment.professionalName || '',
      notes: selectedAppointment.notes || '',
      status: selectedAppointment.status,
      price: selectedAppointment.price,
    });
    setShowFormDialog(true);
  }, [selectedAppointment]);

  const handleSaveAppointment = useCallback((data: AppointmentFormData) => {
    const endTime = addDurationToTime(data.startTime, data.duration);
    const service = MOCK_SERVICES.find((s) => s.id === data.serviceId);

    if (editingAppointment) {
      // Update existing
      setAppointments((prev) =>
        prev.map((a) =>
          a.id === editingAppointment.id
            ? {
                ...a,
                clientId: data.clientId,
                clientName: data.clientName,
                clientPhone: data.clientPhone,
                serviceId: data.serviceId,
                serviceName: data.serviceName,
                date: data.date,
                startTime: data.startTime,
                endTime,
                duration: data.duration,
                professionalId: data.professionalId,
                professionalName: data.professionalName,
                notes: data.notes,
                status: data.status,
                price: data.price,
                color: service?.color || a.color,
                updatedAt: new Date().toISOString(),
              }
            : a,
        ),
      );
      setSnackbar({ open: true, message: 'Agendamento atualizado com sucesso!', severity: 'success' });
    } else {
      // Create new
      const newAppointment: Appointment = {
        id: `new-${Date.now()}`,
        businessId: 'mock-business',
        clientId: data.clientId,
        clientName: data.clientName,
        clientPhone: data.clientPhone,
        serviceId: data.serviceId,
        serviceName: data.serviceName,
        date: data.date,
        startTime: data.startTime,
        endTime,
        duration: data.duration,
        professionalId: data.professionalId,
        professionalName: data.professionalName,
        notes: data.notes,
        status: data.status,
        price: data.price,
        color: service?.color || '#3B82F6',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setAppointments((prev) => [...prev, newAppointment]);
      setSnackbar({ open: true, message: 'Agendamento criado com sucesso!', severity: 'success' });
    }

    setShowFormDialog(false);
    setEditingAppointment(null);
  }, [editingAppointment]);

  const handleDeleteAppointment = useCallback(() => {
    if (!editingAppointment) return;
    setAppointments((prev) => prev.filter((a) => a.id !== editingAppointment.id));
    setShowFormDialog(false);
    setEditingAppointment(null);
    setSnackbar({ open: true, message: 'Agendamento excluído.', severity: 'info' });
  }, [editingAppointment]);

  const handleStatusChange = useCallback((status: AppointmentStatus) => {
    if (!selectedAppointment) return;
    setAppointments((prev) =>
      prev.map((a) =>
        a.id === selectedAppointment.id
          ? { ...a, status, updatedAt: new Date().toISOString() }
          : a,
      ),
    );
    setSelectedAppointment((prev) => (prev ? { ...prev, status } : null));
    setSnackbar({
      open: true,
      message: `Status alterado para "${getStatusLabel(status)}"`,
      severity: 'success',
    });
  }, [selectedAppointment]);

  const handleSlotClick = useCallback((date: Date, time: string) => {
    handleNewAppointment(format(date, 'yyyy-MM-dd'), time);
  }, [handleNewAppointment]);

  // ---- Time column ----
  const timeColumn = useMemo(
    () => (
      <div className="w-16 flex-shrink-0 border-r border-gray-100 dark:border-gray-800 relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
          const hour = START_HOUR + i;
          return (
            <div
              key={hour}
              className="absolute right-0 w-full pr-2 flex items-center justify-end"
              style={{ top: `${i * HOUR_HEIGHT - 6}px` }}
            >
              <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 tabular-nums">
                {String(hour).padStart(2, '0')}:00
              </span>
            </div>
          );
        })}
      </div>
    ),
    [],
  );

  // ---- Horizontal grid lines ----
  const gridLines = useMemo(
    () => (
      <>
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => (
          <div
            key={`line-${i}`}
            className="absolute left-0 right-0 border-t border-gray-100 dark:border-gray-800"
            style={{ top: `${i * HOUR_HEIGHT}px` }}
          />
        ))}
        {Array.from({ length: TOTAL_HOURS }, (_, i) => (
          <div
            key={`half-${i}`}
            className="absolute left-0 right-0 border-t border-gray-50 dark:border-gray-800/50 border-dashed"
            style={{ top: `${i * HOUR_HEIGHT + HALF_HOUR_HEIGHT}px` }}
          />
        ))}
      </>
    ),
    [],
  );

  // ==========================================
  // RENDER: DAY VIEW
  // ==========================================
  const renderDayView = () => {
    const dayAppointments = appointments.filter((a) =>
      isSameDay(parseISO(a.date), currentDate)
    );

    return (
      <motion.div
        key={`day-${format(currentDate, 'yyyy-MM-dd')}`}
        initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
        transition={{ duration: 0.25 }}
        className="flex-1 overflow-hidden"
      >
        {/* Day header */}
        <div className="flex items-center px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="w-16 flex-shrink-0" />
          <div className="flex-1 text-center">
            <div className={cn(
              'text-xs font-medium uppercase tracking-wider',
              isToday(currentDate) ? 'text-red-600' : 'text-gray-500 dark:text-gray-400',
            )}>
              {format(currentDate, 'EEEE', { locale: ptBR })}
            </div>
            <div className={cn(
              'inline-flex items-center justify-center w-10 h-10 rounded-full text-lg font-semibold mt-1',
              isToday(currentDate)
                ? 'bg-red-600 text-white'
                : 'text-gray-900 dark:text-gray-100',
            )}>
              {format(currentDate, 'd')}
            </div>
          </div>
        </div>

        {/* Time grid */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overflow-x-hidden"
          style={{ height: 'calc(100vh - 240px)' }}
        >
          <div className="flex relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
            {/* Time column */}
            {timeColumn}

            {/* Appointments area */}
            <div className="flex-1 relative">
              {gridLines}
              <CurrentTimeLine />

              {/* Clickable slots */}
              {Array.from({ length: TOTAL_HOURS * 2 }, (_, i) => {
                const hour = START_HOUR + Math.floor(i / 2);
                const minute = (i % 2) * 30;
                const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                return (
                  <div
                    key={`slot-${i}`}
                    className="absolute left-0 right-0 cursor-pointer hover:bg-red-50/30 dark:hover:bg-red-500/5 transition-colors z-[5]"
                    style={{
                      top: `${i * HALF_HOUR_HEIGHT}px`,
                      height: `${HALF_HOUR_HEIGHT}px`,
                    }}
                    onClick={() => handleSlotClick(currentDate, timeStr)}
                  />
                );
              })}

              {/* Appointment blocks */}
              {dayAppointments.map((appt) => (
                <AppointmentBlock
                  key={appt.id}
                  appointment={appt}
                  onClick={handleAppointmentClick}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  // ==========================================
  // RENDER: WEEK VIEW
  // ==========================================
  const renderWeekView = () => (
    <motion.div
      key={`week-${format(weekStart, 'yyyy-MM-dd')}`}
      initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
      transition={{ duration: 0.25 }}
      className="flex-1 overflow-hidden"
    >
      {/* Weekday headers */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-20">
        <div className="w-16 flex-shrink-0 border-r border-gray-100 dark:border-gray-800" />
        {weekDays.map((day, i) => {
          const isTodayCol = isToday(day);
          const dayAppointmentsCount = appointmentsByDate.get(format(day, 'yyyy-MM-dd'))?.length || 0;
          return (
            <div
              key={i}
              className={cn(
                'flex-1 text-center py-2.5 border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-w-[100px]',
                isTodayCol && 'bg-red-50/40 dark:bg-red-500/5',
              )}
            >
              <div className={cn(
                'text-[11px] font-medium uppercase tracking-wider',
                isTodayCol ? 'text-red-600' : 'text-gray-400 dark:text-gray-500',
              )}>
                {WEEKDAY_LABELS[i]}
              </div>
              <div
                className={cn(
                  'inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold mt-0.5 cursor-pointer',
                  isTodayCol
                    ? 'bg-red-600 text-white'
                    : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/[0.06]',
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode('day');
                }}
              >
                {format(day, 'd')}
              </div>
              {dayAppointmentsCount > 0 && (
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {dayAppointmentsCount} agend.
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        ref={scrollContainerRef}
        className="overflow-auto"
        style={{ height: 'calc(100vh - 260px)' }}
      >
        <div className="flex relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px`, minWidth: isMobile ? '800px' : 'auto' }}>
          {/* Time column */}
          {timeColumn}

          {/* Day columns */}
          {weekDays.map((day, dayIdx) => {
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayAppts = appointmentsByDate.get(dayKey) || [];
            const isTodayCol = isToday(day);

            return (
              <div
                key={dayIdx}
                className={cn(
                  'flex-1 relative border-r border-gray-100 dark:border-gray-800 last:border-r-0 min-w-[100px]',
                  isTodayCol && 'bg-red-50/20 dark:bg-red-500/5',
                )}
              >
                {gridLines}
                {isTodayCol && <CurrentTimeLine />}

                {/* Clickable slots */}
                {Array.from({ length: TOTAL_HOURS * 2 }, (_, i) => {
                  const hour = START_HOUR + Math.floor(i / 2);
                  const minute = (i % 2) * 30;
                  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                  return (
                    <div
                      key={`slot-${dayIdx}-${i}`}
                      className="absolute left-0 right-0 cursor-pointer hover:bg-red-50/30 dark:hover:bg-red-500/5 transition-colors z-[5]"
                      style={{
                        top: `${i * HALF_HOUR_HEIGHT}px`,
                        height: `${HALF_HOUR_HEIGHT}px`,
                      }}
                      onClick={() => handleSlotClick(day, timeStr)}
                    />
                  );
                })}

                {/* Appointment blocks */}
                {dayAppts.map((appt) => (
                  <AppointmentBlock
                    key={appt.id}
                    appointment={appt}
                    onClick={handleAppointmentClick}
                    compact
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  // ==========================================
  // RENDER: MONTH VIEW
  // ==========================================
  const renderMonthView = () => (
    <motion.div
      key={`month-${format(currentDate, 'yyyy-MM')}`}
      initial={{ opacity: 0, x: slideDirection === 'right' ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: slideDirection === 'right' ? -20 : 20 }}
      transition={{ duration: 0.25 }}
      className="flex-1 overflow-hidden"
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
        {WEEKDAY_LABELS.map((label, i) => (
          <div key={i} className="text-center py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 border-r border-gray-100 dark:border-gray-800 last:border-r-0">
            {label}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div
        className="overflow-y-auto"
        style={{ height: 'calc(100vh - 220px)' }}
      >
        <div className="grid grid-cols-7">
          {monthCalendarDays.map((day, idx) => {
            const isCurrentMonthDay = isSameMonth(day, currentDate);
            const isTodayDate = isToday(day);
            const dayKey = format(day, 'yyyy-MM-dd');
            const dayAppts = appointmentsByDate.get(dayKey) || [];
            const maxPreview = 3;
            const overflow = dayAppts.length - maxPreview;

            return (
              <div
                key={idx}
                className={cn(
                  'min-h-[120px] border-r border-b border-gray-100 dark:border-gray-800 last:border-r-0',
                  'p-1.5 cursor-pointer transition-colors hover:bg-gray-50/50 dark:hover:bg-white/[0.02]',
                  !isCurrentMonthDay && 'bg-gray-50/30 dark:bg-gray-800/30',
                )}
                onClick={() => {
                  setCurrentDate(day);
                  setSelectedDate(day);
                  setViewMode('day');
                }}
              >
                {/* Day number */}
                <div className="flex justify-center mb-1">
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium',
                      isTodayDate && 'bg-red-600 text-white font-bold',
                      !isTodayDate && isCurrentMonthDay && 'text-gray-900 dark:text-gray-100',
                      !isTodayDate && !isCurrentMonthDay && 'text-gray-300 dark:text-gray-600',
                    )}
                  >
                    {format(day, 'd')}
                  </span>
                </div>

                {/* Appointment previews */}
                <div className="space-y-0.5">
                  {dayAppts.slice(0, maxPreview).map((appt) => (
                    <motion.div
                      key={appt.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAppointmentClick(appt);
                      }}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] truncate cursor-pointer',
                        'transition-all duration-150 hover:shadow-sm',
                      )}
                      style={{
                        backgroundColor: STATUS_BG_COLORS[appt.status],
                        color: STATUS_COLORS[appt.status],
                        borderLeft: `2px solid ${STATUS_COLORS[appt.status]}`,
                      }}
                    >
                      <span className="font-semibold">{appt.startTime}</span>{' '}
                      {appt.clientName.split(' ')[0]}
                    </motion.div>
                  ))}
                  {overflow > 0 && (
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-medium text-center py-0.5">
                      +{overflow} mais
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );

  // ==========================================
  // STATUS SUMMARY BAR
  // ==========================================
  const statusSummary = useMemo(() => {
    const counts: Record<AppointmentStatus, number> = {
      agendado: 0,
      confirmado: 0,
      em_andamento: 0,
      concluido: 0,
      cancelado: 0,
      nao_compareceu: 0,
    };
    visibleAppointments.forEach((a) => {
      counts[a.status]++;
    });
    return counts;
  }, [visibleAppointments]);

  // ==========================================
  // MAIN RENDER
  // ==========================================
  return (
    <div className="h-full flex flex-col surface rounded-2xl overflow-hidden">
      {/* ========== HEADER BAR ========== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
        {/* Left: Navigation */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Prev / Today / Next */}
          <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-0.5">
            <button
              onClick={navigatePrev}
              className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-sm"
              title="Anterior"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
            <button
              onClick={navigateToday}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200',
                isToday(currentDate)
                  ? 'bg-red-600 text-white shadow-sm shadow-red-600/20'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm',
              )}
            >
              Hoje
            </button>
            <button
              onClick={navigateNext}
              className="p-2 hover:bg-white dark:hover:bg-gray-700 rounded-lg transition-all duration-200 hover:shadow-sm"
              title="Próximo"
            >
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          </div>

          {/* Date display / calendar trigger */}
          <button
            onClick={(e) => setCalendarAnchor(e.currentTarget)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] rounded-xl transition-colors"
          >
            <CalendarIcon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
            <span className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 capitalize whitespace-nowrap">
              {periodText}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
          </button>

          {/* Mini calendar popover */}
          <Popover
            open={calendarOpen}
            anchorEl={calendarAnchor}
            onClose={() => setCalendarAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{
              sx: {
                borderRadius: '16px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)',
                mt: 1,
              },
            }}
          >
            <MiniCalendar
              selectedDate={selectedDate}
              onSelect={navigateToDate}
              appointments={appointments}
            />
          </Popover>
        </div>

        {/* Right: View toggles + New button */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* View mode toggle */}
          <div className="flex items-center bg-gray-50 dark:bg-gray-800 rounded-xl p-0.5">
            {([
              { mode: 'day' as ViewMode, icon: CalendarDays, label: 'Dia' },
              { mode: 'week' as ViewMode, icon: Columns3, label: 'Semana' },
              { mode: 'month' as ViewMode, icon: LayoutGrid, label: 'Mês' },
            ]).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
                  viewMode === mode
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* New appointment button */}
          <button
            onClick={() => handleNewAppointment()}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-xl',
              'bg-red-600 text-white text-sm font-semibold',
              'hover:bg-red-700 active:bg-red-800',
              'shadow-sm shadow-red-600/20',
              'transition-all duration-200',
            )}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo Agendamento</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* ========== STATUS SUMMARY ========== */}
      <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2 bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 whitespace-nowrap">
          {visibleAppointments.length} agendamento{visibleAppointments.length !== 1 ? 's' : ''}
        </span>
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
        {STATUS_OPTIONS.filter((s) => statusSummary[s.value] > 0).map((s) => (
          <span
            key={s.value}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium whitespace-nowrap"
            style={{
              backgroundColor: STATUS_BG_COLORS[s.value],
              color: STATUS_COLORS[s.value],
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[s.value] }}
            />
            {statusSummary[s.value]} {s.label}
          </span>
        ))}
      </div>

      {/* ========== CALENDAR VIEW AREA ========== */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {viewMode === 'day' && renderDayView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'month' && renderMonthView()}
        </AnimatePresence>
      </div>

      {/* ========== DIALOGS ========== */}
      <ViewAppointmentDialog
        open={showViewDialog}
        onClose={() => {
          setShowViewDialog(false);
          setSelectedAppointment(null);
        }}
        appointment={selectedAppointment}
        onEdit={handleEditAppointment}
        onStatusChange={handleStatusChange}
      />

      <AppointmentFormDialog
        open={showFormDialog}
        onClose={() => {
          setShowFormDialog(false);
          setEditingAppointment(null);
        }}
        onSave={handleSaveAppointment}
        onDelete={editingAppointment ? handleDeleteAppointment : undefined}
        initialData={formInitialData}
        isEditing={!!editingAppointment}
      />

      {/* ========== SNACKBAR ========== */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{
            borderRadius: '12px',
            fontFamily: 'Inter, sans-serif',
            fontSize: '13px',
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </div>
  );
}
