// Fiscal input masks for CPF/CNPJ, CEP, phone and currency fields.
// Pattern: mask*() formats for display; unmaskDigits() strips to raw digits for API payloads.
//
// Usage:
//   <input value={maskCpfCnpj(raw)} onChange={e => setRaw(maskCpfCnpj(e.target.value))} />
//   payload = { document: unmaskDigits(raw) }

export function unmaskDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function maskCpfCnpj(value: string): string {
  const d = unmaskDigits(value);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskCpf(value: string): string {
  const d = unmaskDigits(value).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskCnpj(value: string): string {
  const d = unmaskDigits(value).slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskPhone(value: string): string {
  const d = unmaskDigits(value).slice(0, 11);
  if (d.length <= 2) return d.replace(/(\d{1,2})/, '($1');
  if (d.length <= 6) return d.replace(/(\d{2})(\d{1,4})/, '($1) $2');
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{1,4})/, '($1) $2-$3');
}

export function maskCep(value: string): string {
  const d = unmaskDigits(value).slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})/, '$1-$2');
}
