# Mapeamento de Campos com Máscaras Aplicáveis

## Resumo Executivo

- **Total de campos encontrados:** 78+ campos de input/formulário
- **Distribuição por tipo de máscara:**
  - CPF/CNPJ: 18 campos
  - Telefone/WhatsApp/Celular: 12 campos
  - CEP: 8 campos
  - Data: 15 campos
  - Hora: 2 campos
  - Dinheiro/Moeda: 11 campos
  - Percentual: 3 campos
  - Outros numéricos: 9 campos

- **Bibliotecas de máscara já no projeto:** NENHUMA
- **Utilitários já implementados:** `fiscal-masks.ts`, `format.ts`, `validators.ts`, `crm/shared.ts`

---

## Utilitários Existentes

### fiscal-masks.ts
- `maskCpfCnpj()` - CPF/CNPJ combinado
- `maskCpf()`, `maskCnpj()`, `maskPhone()`, `maskCep()`
- `unmaskDigits()` - Remove não-dígitos

### validators.ts
- `formatCPFInput()`, `formatCNPJInput()`, `formatPhoneInput()`, `formatCEPInput()`
- `validateCPF()`, `validateCNPJ()`, `validateEmail()`

### format.ts
- `formatCurrency()`, `formatCPF()`, `formatCNPJ()`, `formatPhone()`, `formatDate()`

### crm/shared.ts
- `applyPhoneMask()`, `stripPhoneMask()`, `parseCurrencyInput()`, `formatCurrencyInput()`

---

## Campos por Módulo - Implementação Atual

### CLIENTES (ClientForm.tsx)
| Campo | Tipo | Status |
|---|---|---|
| CPF/CNPJ | CPF/CNPJ | ❌ SEM máscara |
| Inscrição Estadual | IE/IM | ❌ SEM máscara |
| Telefone | Telefone BR | ❌ SEM máscara |
| WhatsApp | Telefone BR | ❌ SEM máscara |
| E-mail | Email | ✅ type="email" nativo |
| Data Nascimento | Data | ✅ type="date" nativo |
| CEP | CEP | ❌ SEM máscara |

### SETTINGS (SettingsModule.tsx)
| Campo | Tipo | Status |
|---|---|---|
| Telefone | Telefone BR | ✅ `formatPhoneInput()` |
| CEP | CEP | ✅ `formatCEPInput()` |
| CPF (Empresa) | CPF | ✅ `formatCPFInput()` |
| CNPJ (Empresa) | CNPJ | ✅ `formatCNPJInput()` |

### FISCAL (EmitirNotaDialog.tsx)
| Campo | Tipo | Status |
|---|---|---|
| CPF/CNPJ Tomador | CPF/CNPJ | ✅ `maskCpfCnpj()` |
| Telefone Tomador | Telefone BR | ✅ `maskPhone()` |
| CEP NFe | CEP | ✅ `maskCep()` |
| Valores (Serviço/Deduções) | Dinheiro | ❌ SEM máscara |

### CRM (CRMModule.tsx)
| Campo | Tipo | Status | Linha |
|---|---|---|---|
| Telefone Lead | Telefone BR | ✅ `applyPhoneMask()` | — |
| WhatsApp Lead | Telefone BR | ✅ `applyPhoneMask()` | — |
| Valor Deal | Dinheiro | ❌ SEM máscara — placeholder "0,00" | 386 |
| **CPF/CNPJ Contato** ⭐ NOVO | CPF/CNPJ (segue toggle PF/PJ) | ❌ SEM máscara — só valida no submit | 283 |
| **Inscrição Estadual** ⭐ NOVO | IE (varia por UF) | ❌ SEM máscara — manter texto livre OK | 287 |
| **Nome Fantasia** ⭐ NOVO | Texto | ✅ N/A — texto livre, não precisa | 275 |

### FINANCIAL (FinancialModule.tsx)
| Campo | Tipo | Status |
|---|---|---|
| Vencimento/Pagamento | Data | ✅ type="date" nativo |
| Valores (11+ campos) | Dinheiro | ❌ SEM máscara |
| Percentual Juros | Percentual | ❌ SEM máscara |

### AGENDA (AgendaModule.tsx)
| Campo | Tipo | Status |
|---|---|---|
| Preço Serviço | Dinheiro | ❌ SEM máscara |
| Preço Agendamento | Dinheiro | ❌ SEM máscara |

### OMNICHANNEL (ConversasModule.tsx)
| Campo | Tipo | Status |
|---|---|---|
| Telefone Novo Contato | Telefone BR | ❌ SEM máscara - placeholder "(11) 99999-9999" |

---

## Oportunidades Imediatas

### CRÍTICAS (Alto Impacto)

1. **ClientForm - CPF/CNPJ/Telefone/CEP**
   - 4 campos de máxima visibilidade
   - Solução: Aplicar `maskCpfCnpj()`, `maskPhone()`, `maskCep()`
   - Prioridade: MÁXIMA

2. **FinancialModule - Valores (11+ campos)**
   - Entrada numérica sem separador de milhar
   - Solução: Criar `maskMoney()` centralmente
   - Prioridade: ALTA

3. **CRMModule - Valor Deal**
   - Inconsistência: placeholder "0,00" mas sem máscara
   - Solução: Usar nova `maskMoney()`
   - Prioridade: ALTA

### SECUNDÁRIAS

- AgendaModule - 2 campos de preço
- Inscrição Estadual - validação por estado
- Percentual - 3 campos
- Omnichannel - telefone novo contato

---

## Recomendações

### 1. Consolidar em `lib/utils/masks.ts`

```typescript
// Nova função centralizada para dinheiro
export function maskMoney(value: string): string {
  const num = parseInt(value.replace(/\D/g, '') || '0', 10);
  const formatted = (num / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return formatted;
}

export function unmaskMoney(value: string): number {
  return parseFloat(value.replace(/[^\d,]/g, '').replace(',', '.'));
}
```

### 2. Priorização de Aplicação

**Fase 1 (Imediata):**
- [ ] ClientForm: CPF/CNPJ, Telefone, CEP
- [ ] Validar uso correto em EmitirNotaDialog
- [ ] Consolidar referências (fiscal-masks vs validators)

**Fase 2 (Semana 1):**
- [ ] Criar `maskMoney()` em utils
- [ ] Aplicar em Financial (valores)
- [ ] Aplicar em CRMModule (valor deal)
- [ ] Aplicar em AgendaModule (preços)

**Fase 3 (Opcional):**
- [ ] IE por estado
- [ ] Placa de veículo
- [ ] Percentual formatado

### 3. Padrão de Uso

```tsx
import { maskCpfCnpj, maskPhone, maskCep } from '@/lib/utils/fiscal-masks';

<TextField
  value={cpf}
  onChange={(e) => setCpf(maskCpfCnpj(e.target.value))}
/>

// No payload para API: unmask antes de enviar
const payload = { cpf: unmaskDigits(cpf) };
```

### 4. Riscos

- Duplicação em `fiscal-masks.ts` vs `validators.ts`
  - Solução: Usar `validators.ts` como principal (inclui validação)
- ClientForm não usa máscaras apesar de ter o suporte
  - Solução: Patch imediato
- Tipo="number" em Financial não formata visualmente
  - Solução: Trocar para `<input type="text" />` com `maskMoney()`

---

## Referência Rápida

### Imports Recomendados
```typescript
import { maskCpfCnpj, maskPhone, maskCep } from '@/lib/utils/fiscal-masks';
import { formatCPFInput, formatPhoneInput, formatCEPInput } from '@/lib/utils/validators';
import { formatCurrency, formatCPFCNPJ } from '@/lib/utils/format';
```

### Campos Já Usando Máscaras ✅
- SettingsModule: CPF, CNPJ, Telefone, CEP
- EmitirNotaDialog: CPF/CNPJ, Telefone, CEP (fiscal)
- CRMModule: Telefone, WhatsApp

### Campos Que Precisam de Máscaras ❌
- ClientForm: CPF/CNPJ, Telefone, WhatsApp, CEP (4 campos)
- CRMModule ContactFormDialog: CPF/CNPJ dinâmico (1 campo novo)
- CRMModule DealFormDialog: Valor deal (1 campo)
- FinancialModule: formAmount + Saldo Inicial (2 prioritários)
- AgendaModule: Preço Serviço + Preço Agendamento (2 campos)
- ConversasModule: Telefone novo contato (1 campo)

**Total prioritário: 11 campos**

