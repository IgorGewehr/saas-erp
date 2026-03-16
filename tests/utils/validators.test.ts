import { describe, it, expect } from 'vitest';
import {
  validateCNPJ,
  validateCPF,
  validateEmail,
  formatCNPJInput,
  formatCPFInput,
  formatPhoneInput,
  formatCEPInput,
  UF_LIST,
} from '@/lib/utils/validators';

// ==========================================
// validateCNPJ
// ==========================================
describe('validateCNPJ', () => {
  it('validates a known valid CNPJ (11.222.333/0001-81)', () => {
    expect(validateCNPJ('11222333000181')).toBe(true);
  });

  it('validates a valid CNPJ with punctuation', () => {
    expect(validateCNPJ('11.222.333/0001-81')).toBe(true);
  });

  it('rejects a CNPJ with wrong checksum', () => {
    expect(validateCNPJ('11222333000199')).toBe(false);
  });

  it('rejects all repeated digits', () => {
    expect(validateCNPJ('11111111111111')).toBe(false);
    expect(validateCNPJ('00000000000000')).toBe(false);
    expect(validateCNPJ('99999999999999')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateCNPJ('1122233300018')).toBe(false); // 13 digits
    expect(validateCNPJ('112223330001811')).toBe(false); // 15 digits
    expect(validateCNPJ('')).toBe(false);
  });

  it('rejects completely invalid CNPJ', () => {
    expect(validateCNPJ('12345678901234')).toBe(false);
  });
});

// ==========================================
// validateCPF
// ==========================================
describe('validateCPF', () => {
  it('validates a known valid CPF (529.982.247-25)', () => {
    expect(validateCPF('52998224725')).toBe(true);
  });

  it('validates a valid CPF with punctuation', () => {
    expect(validateCPF('529.982.247-25')).toBe(true);
  });

  it('rejects a CPF with wrong checksum', () => {
    expect(validateCPF('52998224700')).toBe(false);
  });

  it('rejects all repeated digits', () => {
    expect(validateCPF('00000000000')).toBe(false);
    expect(validateCPF('11111111111')).toBe(false);
    expect(validateCPF('22222222222')).toBe(false);
    expect(validateCPF('99999999999')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(validateCPF('1234567890')).toBe(false); // 10 digits
    expect(validateCPF('123456789012')).toBe(false); // 12 digits
    expect(validateCPF('')).toBe(false);
  });

  it('rejects completely invalid CPF', () => {
    expect(validateCPF('12345678901')).toBe(false);
  });
});

// ==========================================
// validateEmail
// ==========================================
describe('validateEmail', () => {
  it('accepts a standard email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toBe(true);
  });

  it('accepts email with plus sign', () => {
    expect(validateEmail('user+tag@example.com')).toBe(true);
  });

  it('accepts email with dots in local part', () => {
    expect(validateEmail('first.last@example.com')).toBe(true);
  });

  it('rejects email without @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  it('rejects email without domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  it('rejects email without local part', () => {
    expect(validateEmail('@example.com')).toBe(false);
  });

  it('rejects email with spaces', () => {
    expect(validateEmail('user @example.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateEmail('')).toBe(false);
  });

  it('rejects email without TLD', () => {
    expect(validateEmail('user@domain')).toBe(false);
  });
});

// ==========================================
// formatCNPJInput (progressive formatting)
// ==========================================
describe('formatCNPJInput', () => {
  it('returns digits only for up to 2 digits', () => {
    expect(formatCNPJInput('12')).toBe('12');
    expect(formatCNPJInput('1')).toBe('1');
  });

  it('adds first dot after 2 digits', () => {
    expect(formatCNPJInput('123')).toBe('12.3');
    expect(formatCNPJInput('12345')).toBe('12.345');
  });

  it('adds second dot after 5 digits', () => {
    expect(formatCNPJInput('123456')).toBe('12.345.6');
    expect(formatCNPJInput('12345678')).toBe('12.345.678');
  });

  it('adds slash after 8 digits', () => {
    expect(formatCNPJInput('123456780')).toBe('12.345.678/0');
    expect(formatCNPJInput('123456780001')).toBe('12.345.678/0001');
  });

  it('adds dash after 12 digits', () => {
    expect(formatCNPJInput('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('truncates to 14 digits', () => {
    expect(formatCNPJInput('123456780001951234')).toBe('12.345.678/0001-95');
  });

  it('strips non-digit characters from input', () => {
    expect(formatCNPJInput('12.345')).toBe('12.345');
  });

  it('handles empty string', () => {
    expect(formatCNPJInput('')).toBe('');
  });
});

// ==========================================
// formatCPFInput (progressive formatting)
// ==========================================
describe('formatCPFInput', () => {
  it('returns digits only for up to 3 digits', () => {
    expect(formatCPFInput('123')).toBe('123');
    expect(formatCPFInput('1')).toBe('1');
  });

  it('adds first dot after 3 digits', () => {
    expect(formatCPFInput('1234')).toBe('123.4');
    expect(formatCPFInput('123456')).toBe('123.456');
  });

  it('adds second dot after 6 digits', () => {
    expect(formatCPFInput('1234567')).toBe('123.456.7');
    expect(formatCPFInput('123456789')).toBe('123.456.789');
  });

  it('adds dash after 9 digits', () => {
    expect(formatCPFInput('1234567890')).toBe('123.456.789-0');
    expect(formatCPFInput('12345678901')).toBe('123.456.789-01');
  });

  it('truncates to 11 digits', () => {
    expect(formatCPFInput('1234567890123')).toBe('123.456.789-01');
  });

  it('strips non-digit characters from input', () => {
    expect(formatCPFInput('123.456')).toBe('123.456');
  });

  it('handles empty string', () => {
    expect(formatCPFInput('')).toBe('');
  });
});

// ==========================================
// formatPhoneInput (progressive formatting)
// ==========================================
describe('formatPhoneInput', () => {
  it('returns digits only for up to 2 digits', () => {
    expect(formatPhoneInput('12')).toBe('12');
    expect(formatPhoneInput('1')).toBe('1');
  });

  it('adds parentheses and space after area code', () => {
    expect(formatPhoneInput('123')).toBe('(12) 3');
    expect(formatPhoneInput('1234567')).toBe('(12) 34567');
  });

  it('formats 10-digit landline phone correctly', () => {
    expect(formatPhoneInput('1234567890')).toBe('(12) 3456-7890');
  });

  it('formats 11-digit mobile phone correctly', () => {
    expect(formatPhoneInput('12345678901')).toBe('(12) 34567-8901');
  });

  it('handles 8-digit body (after area code)', () => {
    expect(formatPhoneInput('1234567890')).toBe('(12) 3456-7890');
  });

  it('truncates to 11 digits', () => {
    expect(formatPhoneInput('123456789012345')).toBe('(12) 34567-8901');
  });

  it('strips non-digit characters', () => {
    expect(formatPhoneInput('(12) 3456')).toBe('(12) 3456');
  });

  it('handles empty string', () => {
    expect(formatPhoneInput('')).toBe('');
  });
});

// ==========================================
// formatCEPInput
// ==========================================
describe('formatCEPInput', () => {
  it('returns digits only for up to 5 digits', () => {
    expect(formatCEPInput('12345')).toBe('12345');
    expect(formatCEPInput('123')).toBe('123');
  });

  it('adds dash after 5 digits', () => {
    expect(formatCEPInput('123456')).toBe('12345-6');
    expect(formatCEPInput('12345678')).toBe('12345-678');
  });

  it('truncates to 8 digits', () => {
    expect(formatCEPInput('1234567890')).toBe('12345-678');
  });

  it('strips non-digit characters', () => {
    expect(formatCEPInput('12345-678')).toBe('12345-678');
  });

  it('handles empty string', () => {
    expect(formatCEPInput('')).toBe('');
  });
});

// ==========================================
// UF_LIST
// ==========================================
describe('UF_LIST', () => {
  it('contains exactly 27 states', () => {
    expect(UF_LIST).toHaveLength(27);
  });

  it('includes all Brazilian states and DF', () => {
    const expectedStates = [
      'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
      'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
      'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
    ];
    for (const state of expectedStates) {
      expect(UF_LIST).toContain(state);
    }
  });

  it('has no duplicate entries', () => {
    const unique = new Set(UF_LIST);
    expect(unique.size).toBe(UF_LIST.length);
  });

  it('is a readonly tuple', () => {
    // UF_LIST is declared with `as const`, so it is readonly
    expect(Array.isArray(UF_LIST)).toBe(true);
  });
});
