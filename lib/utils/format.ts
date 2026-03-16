export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatCPF(cpf: string): string {
  const cleaned = cpf.replace(/\D/g, '');
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function formatCNPJ(cnpj: string): string {
  const cleaned = cnpj.replace(/\D/g, '');
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  }
  return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
}

export function formatCPFCNPJ(value: string): string {
  const cleaned = value.replace(/\D/g, '');
  return cleaned.length <= 11 ? formatCPF(cleaned) : formatCNPJ(cleaned);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  if (isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    agendado: '#3B82F6',
    confirmado: '#10B981',
    em_andamento: '#F59E0B',
    concluido: '#6366F1',
    cancelado: '#EF4444',
    nao_compareceu: '#6B7280',
    pendente: '#F59E0B',
    pago: '#10B981',
    atrasado: '#EF4444',
    autorizada: '#10B981',
    rejeitada: '#EF4444',
    processando: '#3B82F6',
    rascunho: '#6B7280',
    erro: '#EF4444',
  };
  return colors[status] || '#6B7280';
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    agendado: 'Agendado',
    confirmado: 'Confirmado',
    em_andamento: 'Em Andamento',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
    nao_compareceu: 'Não Compareceu',
    pendente: 'Pendente',
    pago: 'Pago',
    atrasado: 'Atrasado',
    autorizada: 'Autorizada',
    rejeitada: 'Rejeitada',
    processando: 'Processando',
    rascunho: 'Rascunho',
    erro: 'Erro',
    aberta: 'Aberta',
    finalizada: 'Finalizada',
  };
  return labels[status] || status;
}
