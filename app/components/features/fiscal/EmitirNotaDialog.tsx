'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Divider,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Autocomplete,
} from '@mui/material';
import {
  X,
  Plus,
  Trash2,
  FileCheck2,
  Receipt,
  FileText,
  Search,
  Calculator,
} from 'lucide-react';
import { toast } from 'react-toastify';
import type { FiscalDocType, PaymentMethod } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/utils/format';

// ==============================================
// TYPES
// ==============================================

interface EmitirNotaDialogProps {
  open: boolean;
  onClose: () => void;
  type: FiscalDocType;
}

interface ItemForm {
  id: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  icmsCst: string;
  icmsCsosn: string;
  icmsAliquota: number;
  icmsValor: number;
  pisCst: string;
  pisAliquota: number;
  pisValor: number;
  cofinsCst: string;
  cofinsAliquota: number;
  cofinsValor: number;
  ipiAliquota: number;
  ipiValor: number;
}

interface PaymentForm {
  id: string;
  method: PaymentMethod;
  amount: number;
  installments: number;
}

// ==============================================
// MOCK CLIENT DATA
// ==============================================

const mockClients = [
  { id: '1', nome: 'Maria Silva', cpfCnpj: '12345678901', tipo: 'pf' as const },
  { id: '2', nome: 'Joao Santos', cpfCnpj: '98765432109', tipo: 'pf' as const },
  { id: '3', nome: 'Tech Solutions LTDA', cpfCnpj: '12345678000190', tipo: 'pj' as const },
  { id: '4', nome: 'Comercio ABC EIRELI', cpfCnpj: '98765432000110', tipo: 'pj' as const },
  { id: '5', nome: 'Ana Oliveira', cpfCnpj: '11122233344', tipo: 'pf' as const },
];

const mockProducts = [
  { id: '1', name: 'Shampoo Profissional 500ml', ncm: '33051000', cfop: '5102', price: 45.9 },
  { id: '2', name: 'Condicionador Hidratante 500ml', ncm: '33051000', cfop: '5102', price: 42.5 },
  { id: '3', name: 'Tintura Capilar 60g', ncm: '33059090', cfop: '5102', price: 28.0 },
  { id: '4', name: 'Creme de Tratamento 300g', ncm: '33059090', cfop: '5102', price: 55.0 },
  { id: '5', name: 'Oleo Capilar 100ml', ncm: '33059010', cfop: '5102', price: 38.9 },
];

// ==============================================
// CONSTANTS
// ==============================================

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  credito: 'Cartao de Credito',
  debito: 'Cartao de Debito',
  boleto: 'Boleto',
  outros: 'Outros',
};

const NATUREZA_OPERACAO_OPTIONS = [
  'Venda de mercadoria',
  'Prestacao de servico',
  'Devolucao de mercadoria',
  'Transferencia',
  'Remessa para conserto',
  'Bonificacao',
];

const FINALIDADE_OPTIONS = [
  { value: '1', label: 'Normal' },
  { value: '2', label: 'Complementar' },
  { value: '3', label: 'Ajuste' },
  { value: '4', label: 'Devolucao' },
];

// ==============================================
// HELPERS
// ==============================================

function createEmptyItem(): ItemForm {
  return {
    id: Math.random().toString(36).substring(2),
    description: '',
    ncm: '',
    cfop: '',
    unit: 'UN',
    quantity: 1,
    unitPrice: 0,
    icmsCst: '',
    icmsCsosn: '',
    icmsAliquota: 0,
    icmsValor: 0,
    pisCst: '',
    pisAliquota: 0,
    pisValor: 0,
    cofinsCst: '',
    cofinsAliquota: 0,
    cofinsValor: 0,
    ipiAliquota: 0,
    ipiValor: 0,
  };
}

function createEmptyPayment(): PaymentForm {
  return {
    id: Math.random().toString(36).substring(2),
    method: 'dinheiro',
    amount: 0,
    installments: 1,
  };
}

function getTypeConfig(type: FiscalDocType) {
  const configs = {
    nfse: {
      title: 'Emitir NFSe',
      subtitle: 'Nota Fiscal de Servico Eletronica',
      icon: <FileCheck2 className="w-5 h-5" />,
    },
    nfce: {
      title: 'Emitir NFCe',
      subtitle: 'Nota Fiscal de Consumidor Eletronica',
      icon: <Receipt className="w-5 h-5" />,
    },
    nfe: {
      title: 'Emitir NFe',
      subtitle: 'Nota Fiscal Eletronica',
      icon: <FileText className="w-5 h-5" />,
    },
  };
  return configs[type];
}

// ==============================================
// ITEM ROW COMPONENT
// ==============================================

interface ItemRowProps {
  item: ItemForm;
  index: number;
  showTaxes: boolean;
  onUpdate: (id: string, field: keyof ItemForm, value: string | number) => void;
  onRemove: (id: string) => void;
  onProductSelect: (id: string, product: (typeof mockProducts)[number]) => void;
}

function ItemRow({ item, index, showTaxes, onUpdate, onRemove, onProductSelect }: ItemRowProps) {
  const totalItem = item.quantity * item.unitPrice;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3 p-4 rounded-lg border border-border/60 bg-muted/20"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Item {index + 1}
        </span>
        <IconButton onClick={() => onRemove(item.id)} size="small">
          <Trash2 size={16} className="text-red-500" />
        </IconButton>
      </div>

      {/* Product search + basic fields */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-5">
          <Autocomplete
            options={mockProducts}
            getOptionLabel={(opt) => opt.name}
            onChange={(_, val) => {
              if (val) onProductSelect(item.id, val);
            }}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Produto/Servico"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <Search size={14} className="text-muted-foreground mr-1" />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
        </div>
        <div className="md:col-span-2">
          <TextField
            label="NCM"
            value={item.ncm}
            onChange={(e) => onUpdate(item.id, 'ncm', e.target.value)}
            fullWidth
            size="small"
          />
        </div>
        <div className="md:col-span-2">
          <TextField
            label="CFOP"
            value={item.cfop}
            onChange={(e) => onUpdate(item.id, 'cfop', e.target.value)}
            fullWidth
            size="small"
          />
        </div>
        <div className="md:col-span-1">
          <TextField
            label="Qtd"
            type="number"
            value={item.quantity}
            onChange={(e) => onUpdate(item.id, 'quantity', Number(e.target.value))}
            fullWidth
            size="small"
            inputProps={{ min: 0, step: 1 }}
          />
        </div>
        <div className="md:col-span-2">
          <TextField
            label="Valor Unit."
            type="number"
            value={item.unitPrice}
            onChange={(e) => onUpdate(item.id, 'unitPrice', Number(e.target.value))}
            fullWidth
            size="small"
            inputProps={{ min: 0, step: 0.01 }}
          />
        </div>
      </div>

      {/* Item total */}
      <div className="flex justify-end">
        <span className="text-sm font-medium text-foreground">
          Total: {formatCurrency(totalItem)}
        </span>
      </div>

      {/* Tax fields (NFe only) */}
      {showTaxes && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.2 }}
          className="space-y-3 pt-3 border-t border-border/40"
        >
          {/* ICMS */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">ICMS</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <TextField
                label="CST"
                value={item.icmsCst}
                onChange={(e) => onUpdate(item.id, 'icmsCst', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="CSOSN"
                value={item.icmsCsosn}
                onChange={(e) => onUpdate(item.id, 'icmsCsosn', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Aliquota %"
                type="number"
                value={item.icmsAliquota}
                onChange={(e) => onUpdate(item.id, 'icmsAliquota', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Valor"
                type="number"
                value={item.icmsValor}
                onChange={(e) => onUpdate(item.id, 'icmsValor', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
            </div>
          </div>

          {/* PIS */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">PIS</p>
            <div className="grid grid-cols-3 gap-3">
              <TextField
                label="CST"
                value={item.pisCst}
                onChange={(e) => onUpdate(item.id, 'pisCst', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Aliquota %"
                type="number"
                value={item.pisAliquota}
                onChange={(e) => onUpdate(item.id, 'pisAliquota', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Valor"
                type="number"
                value={item.pisValor}
                onChange={(e) => onUpdate(item.id, 'pisValor', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
            </div>
          </div>

          {/* COFINS */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">COFINS</p>
            <div className="grid grid-cols-3 gap-3">
              <TextField
                label="CST"
                value={item.cofinsCst}
                onChange={(e) => onUpdate(item.id, 'cofinsCst', e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Aliquota %"
                type="number"
                value={item.cofinsAliquota}
                onChange={(e) => onUpdate(item.id, 'cofinsAliquota', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Valor"
                type="number"
                value={item.cofinsValor}
                onChange={(e) => onUpdate(item.id, 'cofinsValor', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
            </div>
          </div>

          {/* IPI */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">IPI (opcional)</p>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Aliquota %"
                type="number"
                value={item.ipiAliquota}
                onChange={(e) => onUpdate(item.id, 'ipiAliquota', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Valor"
                type="number"
                value={item.ipiValor}
                onChange={(e) => onUpdate(item.id, 'ipiValor', Number(e.target.value))}
                fullWidth
                size="small"
                inputProps={{ min: 0, step: 0.01 }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ==============================================
// PAYMENT ROW COMPONENT
// ==============================================

interface PaymentRowProps {
  payment: PaymentForm;
  index: number;
  onUpdate: (id: string, field: keyof PaymentForm, value: string | number) => void;
  onRemove: (id: string) => void;
}

function PaymentRow({ payment, index, onUpdate, onRemove }: PaymentRowProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-end gap-3"
    >
      <FormControl size="small" sx={{ minWidth: 160 }}>
        <InputLabel>Forma {index + 1}</InputLabel>
        <Select
          value={payment.method}
          onChange={(e) => onUpdate(payment.id, 'method', e.target.value)}
          label={`Forma ${index + 1}`}
        >
          {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((method) => (
            <MenuItem key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label="Valor"
        type="number"
        value={payment.amount}
        onChange={(e) => onUpdate(payment.id, 'amount', Number(e.target.value))}
        size="small"
        inputProps={{ min: 0, step: 0.01 }}
        sx={{ flex: 1 }}
      />

      {payment.method === 'credito' && (
        <TextField
          label="Parcelas"
          type="number"
          value={payment.installments}
          onChange={(e) => onUpdate(payment.id, 'installments', Number(e.target.value))}
          size="small"
          inputProps={{ min: 1, max: 12 }}
          sx={{ width: 100 }}
        />
      )}

      <IconButton onClick={() => onRemove(payment.id)} size="small">
        <Trash2 size={16} className="text-red-500" />
      </IconButton>
    </motion.div>
  );
}

// ==============================================
// NFSE FORM
// ==============================================

interface NFSeFormData {
  clientId: string;
  clientCpfCnpj: string;
  clientNome: string;
  descricaoServico: string;
  codigoServicoMunicipal: string;
  valorServico: number;
  aliquotaIss: number;
  valorIss: number;
  valorTotal: number;
  naturezaOperacao: string;
  observacoes: string;
}

function NFSeForm({
  data,
  onChange,
}: {
  data: NFSeFormData;
  onChange: (d: NFSeFormData) => void;
}) {
  function handleChange(field: keyof NFSeFormData, value: string | number) {
    const updated = { ...data, [field]: value };

    // Auto-calculate ISS
    if (field === 'valorServico' || field === 'aliquotaIss') {
      const valorServico = field === 'valorServico' ? (value as number) : data.valorServico;
      const aliquotaIss = field === 'aliquotaIss' ? (value as number) : data.aliquotaIss;
      updated.valorIss = Number(((valorServico * aliquotaIss) / 100).toFixed(2));
      updated.valorTotal = valorServico;
    }

    onChange(updated);
  }

  return (
    <div className="space-y-5">
      {/* Tomador (Client) */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Tomador do Servico</p>
        <div className="space-y-3">
          <Autocomplete
            options={mockClients}
            getOptionLabel={(opt) => `${opt.nome} - ${opt.cpfCnpj}`}
            onChange={(_, val) => {
              if (val) {
                handleChange('clientId', val.id);
                handleChange('clientNome', val.nome);
                handleChange('clientCpfCnpj', val.cpfCnpj);
              }
            }}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Buscar cliente"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <Search size={14} className="text-muted-foreground mr-1" />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextField
              label="CPF/CNPJ"
              value={data.clientCpfCnpj}
              onChange={(e) => handleChange('clientCpfCnpj', e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Nome/Razao Social"
              value={data.clientNome}
              onChange={(e) => handleChange('clientNome', e.target.value)}
              fullWidth
              size="small"
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* Servico */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Servico</p>
        <div className="space-y-3">
          <TextField
            label="Descricao do Servico"
            value={data.descricaoServico}
            onChange={(e) => handleChange('descricaoServico', e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={3}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextField
              label="Codigo do Servico Municipal"
              value={data.codigoServicoMunicipal}
              onChange={(e) => handleChange('codigoServicoMunicipal', e.target.value)}
              fullWidth
              size="small"
              placeholder="Ex: 1.01"
            />
            <FormControl fullWidth size="small">
              <InputLabel>Natureza da Operacao</InputLabel>
              <Select
                value={data.naturezaOperacao}
                onChange={(e) => handleChange('naturezaOperacao', e.target.value)}
                label="Natureza da Operacao"
              >
                {NATUREZA_OPERACAO_OPTIONS.map((opt) => (
                  <MenuItem key={opt} value={opt}>
                    {opt}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        </div>
      </div>

      <Divider />

      {/* Valores */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Valores</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TextField
            label="Valor do Servico"
            type="number"
            value={data.valorServico}
            onChange={(e) => handleChange('valorServico', Number(e.target.value))}
            fullWidth
            size="small"
            inputProps={{ min: 0, step: 0.01 }}
          />
          <TextField
            label="Aliquota ISS (%)"
            type="number"
            value={data.aliquotaIss}
            onChange={(e) => handleChange('aliquotaIss', Number(e.target.value))}
            fullWidth
            size="small"
            inputProps={{ min: 0, max: 100, step: 0.01 }}
          />
          <TextField
            label="Valor ISS"
            type="number"
            value={data.valorIss}
            fullWidth
            size="small"
            disabled
            InputProps={{
              startAdornment: <Calculator size={14} className="text-muted-foreground mr-1" />,
            }}
          />
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-primary-50 border border-primary-100">
        <span className="text-sm font-semibold text-primary-700">Valor Total</span>
        <span className="text-lg font-bold text-primary-700">
          {formatCurrency(data.valorTotal)}
        </span>
      </div>

      {/* Observacoes */}
      <TextField
        label="Observacoes"
        value={data.observacoes}
        onChange={(e) => handleChange('observacoes', e.target.value)}
        fullWidth
        size="small"
        multiline
        rows={2}
      />
    </div>
  );
}

// ==============================================
// NFCE FORM
// ==============================================

interface NFCeFormData {
  consumidorCpf: string;
  consumidorNome: string;
  items: ItemForm[];
  payments: PaymentForm[];
}

function NFCeForm({
  data,
  onChange,
}: {
  data: NFCeFormData;
  onChange: (d: NFCeFormData) => void;
}) {
  const totalItems = useMemo(
    () => data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [data.items],
  );

  const totalPayments = useMemo(
    () => data.payments.reduce((sum, p) => sum + p.amount, 0),
    [data.payments],
  );

  function handleItemUpdate(id: string, field: keyof ItemForm, value: string | number) {
    onChange({
      ...data,
      items: data.items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    });
  }

  function handleItemRemove(id: string) {
    if (data.items.length <= 1) {
      toast.warning('A nota deve conter pelo menos um item.');
      return;
    }
    onChange({ ...data, items: data.items.filter((item) => item.id !== id) });
  }

  function handleProductSelect(itemId: string, product: (typeof mockProducts)[number]) {
    onChange({
      ...data,
      items: data.items.map((item) =>
        item.id === itemId
          ? { ...item, description: product.name, ncm: product.ncm, cfop: product.cfop, unitPrice: product.price }
          : item,
      ),
    });
  }

  function handlePaymentUpdate(id: string, field: keyof PaymentForm, value: string | number) {
    onChange({
      ...data,
      payments: data.payments.map((p) =>
        p.id === id ? { ...p, [field]: value } : p,
      ),
    });
  }

  function handlePaymentRemove(id: string) {
    if (data.payments.length <= 1) {
      toast.warning('A nota deve conter pelo menos uma forma de pagamento.');
      return;
    }
    onChange({ ...data, payments: data.payments.filter((p) => p.id !== id) });
  }

  return (
    <div className="space-y-5">
      {/* Consumidor (Optional) */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">
          Consumidor{' '}
          <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="CPF"
            value={data.consumidorCpf}
            onChange={(e) => onChange({ ...data, consumidorCpf: e.target.value })}
            fullWidth
            size="small"
            placeholder="Nao identificado"
          />
          <TextField
            label="Nome"
            value={data.consumidorNome}
            onChange={(e) => onChange({ ...data, consumidorNome: e.target.value })}
            fullWidth
            size="small"
          />
        </div>
      </div>

      <Divider />

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-700">Itens</p>
          <Button
            onClick={() => onChange({ ...data, items: [...data.items, createEmptyItem()] })}
            startIcon={<Plus size={16} />}
            size="small"
            sx={{ color: '#DC2626' }}
          >
            Adicionar Item
          </Button>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {data.items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                index={idx}
                showTaxes={false}
                onUpdate={handleItemUpdate}
                onRemove={handleItemRemove}
                onProductSelect={handleProductSelect}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Divider />

      {/* Pagamento */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-700">Pagamento</p>
          <Button
            onClick={() =>
              onChange({ ...data, payments: [...data.payments, createEmptyPayment()] })
            }
            startIcon={<Plus size={16} />}
            size="small"
            sx={{ color: '#DC2626' }}
          >
            Adicionar Pagamento
          </Button>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {data.payments.map((payment, idx) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                index={idx}
                onUpdate={handlePaymentUpdate}
                onRemove={handlePaymentRemove}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Totals */}
      <div className="space-y-2 p-4 rounded-xl bg-muted/30 border border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total dos Itens</span>
          <span className="text-sm font-medium">{formatCurrency(totalItems)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total dos Pagamentos</span>
          <span
            className={cn(
              'text-sm font-medium',
              Math.abs(totalPayments - totalItems) > 0.01 && totalPayments > 0
                ? 'text-red-600'
                : 'text-foreground',
            )}
          >
            {formatCurrency(totalPayments)}
          </span>
        </div>
        <Divider />
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-primary-700">Valor Total</span>
          <span className="text-lg font-bold text-primary-700">
            {formatCurrency(totalItems)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// NFE FORM
// ==============================================

interface NFeFormData {
  destinatarioCpfCnpj: string;
  destinatarioNome: string;
  destinatarioIe: string;
  destinatarioLogradouro: string;
  destinatarioNumero: string;
  destinatarioBairro: string;
  destinatarioMunicipio: string;
  destinatarioUf: string;
  destinatarioCep: string;
  naturezaOperacao: string;
  tipoOperacao: '0' | '1'; // 0=Entrada, 1=Saida
  finalidade: string;
  items: ItemForm[];
  payments: PaymentForm[];
  transporteModalidade: string;
  informacoesAdicionais: string;
}

function NFeForm({
  data,
  onChange,
}: {
  data: NFeFormData;
  onChange: (d: NFeFormData) => void;
}) {
  const totalItems = useMemo(
    () => data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [data.items],
  );

  const totalPayments = useMemo(
    () => data.payments.reduce((sum, p) => sum + p.amount, 0),
    [data.payments],
  );

  function handleChange(field: keyof NFeFormData, value: string | number) {
    onChange({ ...data, [field]: value });
  }

  function handleItemUpdate(id: string, field: keyof ItemForm, value: string | number) {
    onChange({
      ...data,
      items: data.items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    });
  }

  function handleItemRemove(id: string) {
    if (data.items.length <= 1) {
      toast.warning('A nota deve conter pelo menos um item.');
      return;
    }
    onChange({ ...data, items: data.items.filter((item) => item.id !== id) });
  }

  function handleProductSelect(itemId: string, product: (typeof mockProducts)[number]) {
    onChange({
      ...data,
      items: data.items.map((item) =>
        item.id === itemId
          ? { ...item, description: product.name, ncm: product.ncm, cfop: product.cfop, unitPrice: product.price }
          : item,
      ),
    });
  }

  function handlePaymentUpdate(id: string, field: keyof PaymentForm, value: string | number) {
    onChange({
      ...data,
      payments: data.payments.map((p) =>
        p.id === id ? { ...p, [field]: value } : p,
      ),
    });
  }

  function handlePaymentRemove(id: string) {
    if (data.payments.length <= 1) {
      toast.warning('A nota deve conter pelo menos uma forma de pagamento.');
      return;
    }
    onChange({ ...data, payments: data.payments.filter((p) => p.id !== id) });
  }

  function handleClientSelect(client: (typeof mockClients)[number]) {
    handleChange('destinatarioCpfCnpj', client.cpfCnpj);
    handleChange('destinatarioNome', client.nome);
  }

  return (
    <div className="space-y-5">
      {/* Destinatario */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Destinatario</p>
        <div className="space-y-3">
          <Autocomplete
            options={mockClients}
            getOptionLabel={(opt) => `${opt.nome} - ${opt.cpfCnpj}`}
            onChange={(_, val) => val && handleClientSelect(val)}
            size="small"
            renderInput={(params) => (
              <TextField
                {...params}
                label="Buscar destinatario"
                size="small"
                InputProps={{
                  ...params.InputProps,
                  startAdornment: (
                    <>
                      <Search size={14} className="text-muted-foreground mr-1" />
                      {params.InputProps.startAdornment}
                    </>
                  ),
                }}
              />
            )}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TextField
              label="CNPJ/CPF"
              value={data.destinatarioCpfCnpj}
              onChange={(e) => handleChange('destinatarioCpfCnpj', e.target.value)}
              fullWidth
              size="small"
              required
            />
            <TextField
              label="Razao Social/Nome"
              value={data.destinatarioNome}
              onChange={(e) => handleChange('destinatarioNome', e.target.value)}
              fullWidth
              size="small"
              required
              className="md:col-span-2"
            />
          </div>
          <TextField
            label="Inscricao Estadual"
            value={data.destinatarioIe}
            onChange={(e) => handleChange('destinatarioIe', e.target.value)}
            fullWidth
            size="small"
          />

          {/* Endereco */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <TextField
              label="Logradouro"
              value={data.destinatarioLogradouro}
              onChange={(e) => handleChange('destinatarioLogradouro', e.target.value)}
              size="small"
              className="md:col-span-2"
            />
            <TextField
              label="Numero"
              value={data.destinatarioNumero}
              onChange={(e) => handleChange('destinatarioNumero', e.target.value)}
              size="small"
            />
            <TextField
              label="Bairro"
              value={data.destinatarioBairro}
              onChange={(e) => handleChange('destinatarioBairro', e.target.value)}
              size="small"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <TextField
              label="Municipio"
              value={data.destinatarioMunicipio}
              onChange={(e) => handleChange('destinatarioMunicipio', e.target.value)}
              size="small"
            />
            <TextField
              label="UF"
              value={data.destinatarioUf}
              onChange={(e) => handleChange('destinatarioUf', e.target.value)}
              size="small"
              inputProps={{ maxLength: 2 }}
            />
            <TextField
              label="CEP"
              value={data.destinatarioCep}
              onChange={(e) => handleChange('destinatarioCep', e.target.value)}
              size="small"
            />
          </div>
        </div>
      </div>

      <Divider />

      {/* Operacao */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Dados da Operacao</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormControl fullWidth size="small">
            <InputLabel>Natureza da Operacao</InputLabel>
            <Select
              value={data.naturezaOperacao}
              onChange={(e) => handleChange('naturezaOperacao', e.target.value)}
              label="Natureza da Operacao"
            >
              {NATUREZA_OPERACAO_OPTIONS.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Tipo de Operacao</InputLabel>
            <Select
              value={data.tipoOperacao}
              onChange={(e) => handleChange('tipoOperacao', e.target.value)}
              label="Tipo de Operacao"
            >
              <MenuItem value="0">Entrada</MenuItem>
              <MenuItem value="1">Saida</MenuItem>
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel>Finalidade</InputLabel>
            <Select
              value={data.finalidade}
              onChange={(e) => handleChange('finalidade', e.target.value)}
              label="Finalidade"
            >
              {FINALIDADE_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
      </div>

      <Divider />

      {/* Items com taxas */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-700">Itens</p>
          <Button
            onClick={() => onChange({ ...data, items: [...data.items, createEmptyItem()] })}
            startIcon={<Plus size={16} />}
            size="small"
            sx={{ color: '#DC2626' }}
          >
            Adicionar Item
          </Button>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {data.items.map((item, idx) => (
              <ItemRow
                key={item.id}
                item={item}
                index={idx}
                showTaxes={true}
                onUpdate={handleItemUpdate}
                onRemove={handleItemRemove}
                onProductSelect={handleProductSelect}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      <Divider />

      {/* Transporte */}
      <div>
        <p className="text-sm font-semibold text-slate-700 mb-3">Transporte</p>
        <FormControl fullWidth size="small">
          <InputLabel>Modalidade do Frete</InputLabel>
          <Select
            value={data.transporteModalidade}
            onChange={(e) => handleChange('transporteModalidade', e.target.value)}
            label="Modalidade do Frete"
          >
            <MenuItem value="0">Por conta do emitente</MenuItem>
            <MenuItem value="1">Por conta do destinatario</MenuItem>
            <MenuItem value="2">Por conta de terceiros</MenuItem>
            <MenuItem value="9">Sem frete</MenuItem>
          </Select>
        </FormControl>
      </div>

      <Divider />

      {/* Pagamento */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-slate-700">Pagamento</p>
          <Button
            onClick={() =>
              onChange({ ...data, payments: [...data.payments, createEmptyPayment()] })
            }
            startIcon={<Plus size={16} />}
            size="small"
            sx={{ color: '#DC2626' }}
          >
            Adicionar Pagamento
          </Button>
        </div>

        <div className="space-y-3">
          <AnimatePresence>
            {data.payments.map((payment, idx) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                index={idx}
                onUpdate={handlePaymentUpdate}
                onRemove={handlePaymentRemove}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Informacoes Adicionais */}
      <TextField
        label="Informacoes Adicionais"
        value={data.informacoesAdicionais}
        onChange={(e) => handleChange('informacoesAdicionais', e.target.value)}
        fullWidth
        size="small"
        multiline
        rows={3}
      />

      {/* Totals */}
      <div className="space-y-2 p-4 rounded-xl bg-muted/30 border border-border/60">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total dos Itens</span>
          <span className="text-sm font-medium">{formatCurrency(totalItems)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total dos Pagamentos</span>
          <span
            className={cn(
              'text-sm font-medium',
              Math.abs(totalPayments - totalItems) > 0.01 && totalPayments > 0
                ? 'text-red-600'
                : 'text-foreground',
            )}
          >
            {formatCurrency(totalPayments)}
          </span>
        </div>
        <Divider />
        <div className="flex items-center justify-between pt-1">
          <span className="text-sm font-semibold text-primary-700">Valor Total</span>
          <span className="text-lg font-bold text-primary-700">
            {formatCurrency(totalItems)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ==============================================
// MAIN COMPONENT
// ==============================================

export default function EmitirNotaDialog({ open, onClose, type }: EmitirNotaDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // NFSe form state
  const [nfseData, setNfseData] = useState<NFSeFormData>({
    clientId: '',
    clientCpfCnpj: '',
    clientNome: '',
    descricaoServico: '',
    codigoServicoMunicipal: '',
    valorServico: 0,
    aliquotaIss: 5,
    valorIss: 0,
    valorTotal: 0,
    naturezaOperacao: '',
    observacoes: '',
  });

  // NFCe form state
  const [nfceData, setNfceData] = useState<NFCeFormData>({
    consumidorCpf: '',
    consumidorNome: '',
    items: [createEmptyItem()],
    payments: [createEmptyPayment()],
  });

  // NFe form state
  const [nfeData, setNfeData] = useState<NFeFormData>({
    destinatarioCpfCnpj: '',
    destinatarioNome: '',
    destinatarioIe: '',
    destinatarioLogradouro: '',
    destinatarioNumero: '',
    destinatarioBairro: '',
    destinatarioMunicipio: '',
    destinatarioUf: '',
    destinatarioCep: '',
    naturezaOperacao: '',
    tipoOperacao: '1',
    finalidade: '1',
    items: [createEmptyItem()],
    payments: [createEmptyPayment()],
    transporteModalidade: '9',
    informacoesAdicionais: '',
  });

  const typeConfig = getTypeConfig(type);

  async function handleSubmit() {
    setIsSubmitting(true);

    try {
      let payload: Record<string, unknown> = {};

      if (type === 'nfse') {
        if (!nfseData.clientCpfCnpj || !nfseData.descricaoServico || !nfseData.valorServico) {
          toast.error('Preencha todos os campos obrigatorios.');
          setIsSubmitting(false);
          return;
        }
        payload = { ...nfseData };
      } else if (type === 'nfce') {
        if (nfceData.items.some((i) => !i.description || i.unitPrice <= 0)) {
          toast.error('Todos os itens devem ter descricao e valor.');
          setIsSubmitting(false);
          return;
        }
        payload = { ...nfceData };
      } else {
        if (!nfeData.destinatarioCpfCnpj || !nfeData.destinatarioNome) {
          toast.error('Informe os dados do destinatario.');
          setIsSubmitting(false);
          return;
        }
        if (nfeData.items.some((i) => !i.description || i.unitPrice <= 0)) {
          toast.error('Todos os itens devem ter descricao e valor.');
          setIsSubmitting(false);
          return;
        }
        payload = { ...nfeData };
      }

      const response = await fetch('/api/fiscal/emit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, data: payload }),
      });

      const result = await response.json();

      if (!response.ok) {
        toast.error(result.error || 'Erro ao emitir nota fiscal.');
        return;
      }

      toast.success('Nota fiscal emitida com sucesso! Processando autorizacao...');
      onClose();
    } catch {
      toast.error('Erro de conexao. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={isSubmitting ? undefined : onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: '16px',
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontWeight: 700,
        }}
      >
        <div className="flex items-center gap-2">
          <div className="text-primary-600">{typeConfig.icon}</div>
          <div>
            <span className="block">{typeConfig.title}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {typeConfig.subtitle}
            </span>
          </div>
        </div>
        <IconButton onClick={onClose} disabled={isSubmitting} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={type}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {type === 'nfse' && <NFSeForm data={nfseData} onChange={setNfseData} />}
            {type === 'nfce' && <NFCeForm data={nfceData} onChange={setNfceData} />}
            {type === 'nfe' && <NFeForm data={nfeData} onChange={setNfeData} />}
          </motion.div>
        </AnimatePresence>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={isSubmitting} sx={{ color: '#64748B' }}>
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isSubmitting}
          sx={{
            backgroundColor: '#DC2626',
            '&:hover': { backgroundColor: '#B91C1C' },
            minWidth: 160,
          }}
        >
          {isSubmitting ? (
            <CircularProgress size={20} sx={{ color: 'white' }} />
          ) : (
            'Emitir Nota Fiscal'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
