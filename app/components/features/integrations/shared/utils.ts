export function formatCurrency(value: number, currency: string = 'BRL'): string {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatUSD(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatNumber(value: number | undefined): string {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('pt-BR');
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min atrás`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d atrás`;
  return new Date(timestamp).toLocaleDateString('pt-BR');
}

export function timeAgoShort(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
