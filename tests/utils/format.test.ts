import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatCPF,
  formatCNPJ,
  formatPhone,
  formatCPFCNPJ,
  formatDate,
  formatDateTime,
  formatPercentage,
  truncate,
  generateId,
  getInitials,
  getStatusColor,
  getStatusLabel,
} from '@/lib/utils/format';

// ==========================================
// formatCurrency
// ==========================================
describe('formatCurrency', () => {
  it('formats a positive number as BRL currency', () => {
    const result = formatCurrency(1234.56);
    // pt-BR format: R$ 1.234,56 (non-breaking space may vary)
    expect(result).toContain('R$');
    expect(result).toContain('1.234,56');
  });

  it('formats zero', () => {
    const result = formatCurrency(0);
    expect(result).toContain('R$');
    expect(result).toContain('0,00');
  });

  it('formats negative numbers', () => {
    const result = formatCurrency(-500.99);
    expect(result).toContain('R$');
    expect(result).toContain('500,99');
  });

  it('formats large numbers with thousands separators', () => {
    const result = formatCurrency(1000000);
    expect(result).toContain('R$');
    expect(result).toContain('1.000.000,00');
  });

  it('formats small decimal values', () => {
    const result = formatCurrency(0.01);
    expect(result).toContain('R$');
    expect(result).toContain('0,01');
  });

  it('rounds to two decimal places', () => {
    const result = formatCurrency(10.999);
    expect(result).toContain('R$');
    expect(result).toContain('11,00');
  });
});

// ==========================================
// formatCPF
// ==========================================
describe('formatCPF', () => {
  it('formats a valid 11-digit CPF string', () => {
    expect(formatCPF('12345678901')).toBe('123.456.789-01');
  });

  it('strips non-numeric characters before formatting', () => {
    expect(formatCPF('123.456.789-01')).toBe('123.456.789-01');
  });

  it('returns unformatted string if too short', () => {
    // regex won't match if not exactly 11 digits, so no replacement occurs
    const result = formatCPF('12345');
    expect(result).toBe('12345');
  });

  it('handles empty string', () => {
    expect(formatCPF('')).toBe('');
  });
});

// ==========================================
// formatCNPJ
// ==========================================
describe('formatCNPJ', () => {
  it('formats a valid 14-digit CNPJ string', () => {
    expect(formatCNPJ('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('strips non-numeric characters before formatting', () => {
    expect(formatCNPJ('12.345.678/0001-95')).toBe('12.345.678/0001-95');
  });

  it('returns unformatted string if too short', () => {
    const result = formatCNPJ('1234');
    expect(result).toBe('1234');
  });

  it('handles empty string', () => {
    expect(formatCNPJ('')).toBe('');
  });
});

// ==========================================
// formatPhone
// ==========================================
describe('formatPhone', () => {
  it('formats an 11-digit phone (mobile with 9)', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formats a 10-digit phone (landline)', () => {
    expect(formatPhone('1134567890')).toBe('(11) 3456-7890');
  });

  it('strips non-numeric characters', () => {
    expect(formatPhone('(11) 98765-4321')).toBe('(11) 98765-4321');
  });

  it('handles empty string', () => {
    expect(formatPhone('')).toBe('');
  });
});

// ==========================================
// formatCPFCNPJ
// ==========================================
describe('formatCPFCNPJ', () => {
  it('formats as CPF when cleaned digits are 11 or fewer', () => {
    expect(formatCPFCNPJ('12345678901')).toBe('123.456.789-01');
  });

  it('formats as CNPJ when cleaned digits exceed 11', () => {
    expect(formatCPFCNPJ('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('handles already formatted CPF', () => {
    expect(formatCPFCNPJ('123.456.789-01')).toBe('123.456.789-01');
  });

  it('handles already formatted CNPJ', () => {
    expect(formatCPFCNPJ('12.345.678/0001-95')).toBe('12.345.678/0001-95');
  });
});

// ==========================================
// formatDate
// ==========================================
describe('formatDate', () => {
  it('formats a valid date string (YYYY-MM-DD)', () => {
    const result = formatDate('2024-01-15');
    expect(result).toBe('15/01/2024');
  });

  it('formats a valid ISO datetime string', () => {
    const result = formatDate('2024-01-15T10:30:00');
    expect(result).toBe('15/01/2024');
  });

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns dash for empty string', () => {
    expect(formatDate('')).toBe('-');
  });

  it('returns dash for invalid date', () => {
    expect(formatDate('not-a-date')).toBe('-');
  });
});

// ==========================================
// formatDateTime
// ==========================================
describe('formatDateTime', () => {
  it('formats a valid ISO datetime string', () => {
    const result = formatDateTime('2024-01-15T10:30:00');
    // pt-BR short date + short time, e.g. "15/01/2024, 10:30" or "15/01/24 10:30"
    expect(result).not.toBe('-');
    expect(result).toContain('15/01');
    expect(result).toContain('10:30');
  });

  it('returns dash for null', () => {
    expect(formatDateTime(null)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDateTime(undefined)).toBe('-');
  });

  it('returns dash for empty string', () => {
    expect(formatDateTime('')).toBe('-');
  });

  it('returns dash for invalid date', () => {
    expect(formatDateTime('not-a-date')).toBe('-');
  });
});

// ==========================================
// formatPercentage
// ==========================================
describe('formatPercentage', () => {
  it('formats an integer percentage', () => {
    expect(formatPercentage(50)).toBe('50.0%');
  });

  it('formats a decimal percentage with one decimal place', () => {
    expect(formatPercentage(33.333)).toBe('33.3%');
  });

  it('formats zero', () => {
    expect(formatPercentage(0)).toBe('0.0%');
  });

  it('formats 100%', () => {
    expect(formatPercentage(100)).toBe('100.0%');
  });

  it('formats negative percentage', () => {
    expect(formatPercentage(-5.5)).toBe('-5.5%');
  });
});

// ==========================================
// truncate
// ==========================================
describe('truncate', () => {
  it('returns the string as-is if within maxLength', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns the string as-is if exactly maxLength', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ellipsis when exceeding maxLength', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('truncates to zero length', () => {
    expect(truncate('hello', 0)).toBe('...');
  });
});

// ==========================================
// generateId
// ==========================================
describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique IDs on consecutive calls', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('generates IDs using alphanumeric characters (base36)', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

// ==========================================
// getInitials
// ==========================================
describe('getInitials', () => {
  it('returns two initials for a full name', () => {
    expect(getInitials('João Silva')).toBe('JS');
  });

  it('returns one initial for a single name', () => {
    expect(getInitials('João')).toBe('J');
  });

  it('returns at most two initials for multi-word names', () => {
    expect(getInitials('Ana Maria da Silva')).toBe('AM');
  });

  it('returns uppercase initials', () => {
    expect(getInitials('maria santos')).toBe('MS');
  });

  it('handles empty string', () => {
    expect(getInitials('')).toBe('');
  });
});

// ==========================================
// getStatusColor
// ==========================================
describe('getStatusColor', () => {
  it('returns correct color for agendado', () => {
    expect(getStatusColor('agendado')).toBe('#3B82F6');
  });

  it('returns correct color for confirmado', () => {
    expect(getStatusColor('confirmado')).toBe('#10B981');
  });

  it('returns correct color for em_andamento', () => {
    expect(getStatusColor('em_andamento')).toBe('#F59E0B');
  });

  it('returns correct color for concluido', () => {
    expect(getStatusColor('concluido')).toBe('#6366F1');
  });

  it('returns correct color for cancelado', () => {
    expect(getStatusColor('cancelado')).toBe('#EF4444');
  });

  it('returns correct color for nao_compareceu', () => {
    expect(getStatusColor('nao_compareceu')).toBe('#6B7280');
  });

  it('returns correct color for pendente', () => {
    expect(getStatusColor('pendente')).toBe('#F59E0B');
  });

  it('returns correct color for pago', () => {
    expect(getStatusColor('pago')).toBe('#10B981');
  });

  it('returns correct color for atrasado', () => {
    expect(getStatusColor('atrasado')).toBe('#EF4444');
  });

  it('returns correct color for autorizada', () => {
    expect(getStatusColor('autorizada')).toBe('#10B981');
  });

  it('returns correct color for rejeitada', () => {
    expect(getStatusColor('rejeitada')).toBe('#EF4444');
  });

  it('returns correct color for processando', () => {
    expect(getStatusColor('processando')).toBe('#3B82F6');
  });

  it('returns correct color for rascunho', () => {
    expect(getStatusColor('rascunho')).toBe('#6B7280');
  });

  it('returns correct color for erro', () => {
    expect(getStatusColor('erro')).toBe('#EF4444');
  });

  it('returns default gray for unknown status', () => {
    expect(getStatusColor('unknown_status')).toBe('#6B7280');
  });
});

// ==========================================
// getStatusLabel
// ==========================================
describe('getStatusLabel', () => {
  it('returns correct label for agendado', () => {
    expect(getStatusLabel('agendado')).toBe('Agendado');
  });

  it('returns correct label for confirmado', () => {
    expect(getStatusLabel('confirmado')).toBe('Confirmado');
  });

  it('returns correct label for em_andamento', () => {
    expect(getStatusLabel('em_andamento')).toBe('Em Andamento');
  });

  it('returns correct label for concluido', () => {
    expect(getStatusLabel('concluido')).toBe('Concluído');
  });

  it('returns correct label for cancelado', () => {
    expect(getStatusLabel('cancelado')).toBe('Cancelado');
  });

  it('returns correct label for nao_compareceu', () => {
    expect(getStatusLabel('nao_compareceu')).toBe('Não Compareceu');
  });

  it('returns correct label for pendente', () => {
    expect(getStatusLabel('pendente')).toBe('Pendente');
  });

  it('returns correct label for pago', () => {
    expect(getStatusLabel('pago')).toBe('Pago');
  });

  it('returns correct label for atrasado', () => {
    expect(getStatusLabel('atrasado')).toBe('Atrasado');
  });

  it('returns correct label for autorizada', () => {
    expect(getStatusLabel('autorizada')).toBe('Autorizada');
  });

  it('returns correct label for rejeitada', () => {
    expect(getStatusLabel('rejeitada')).toBe('Rejeitada');
  });

  it('returns correct label for processando', () => {
    expect(getStatusLabel('processando')).toBe('Processando');
  });

  it('returns correct label for rascunho', () => {
    expect(getStatusLabel('rascunho')).toBe('Rascunho');
  });

  it('returns correct label for erro', () => {
    expect(getStatusLabel('erro')).toBe('Erro');
  });

  it('returns correct label for aberta', () => {
    expect(getStatusLabel('aberta')).toBe('Aberta');
  });

  it('returns correct label for finalizada', () => {
    expect(getStatusLabel('finalizada')).toBe('Finalizada');
  });

  it('returns the status string itself for unknown status', () => {
    expect(getStatusLabel('xyz_unknown')).toBe('xyz_unknown');
  });
});
