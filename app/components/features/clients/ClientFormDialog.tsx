'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  ToggleButtonGroup,
  ToggleButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  CircularProgress,
  Divider,
} from '@mui/material';
import { X, User, Building2, Plus, MapPin, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import type { Client, Address } from '@/lib/types';
import { useTheme } from '@/app/components/providers/ThemeProvider';
import { validateCPF, validateCNPJ } from '@/lib/utils/validators';

function applyMask(value: string, mask: string): string {
  const digits = value.replace(/\D/g, '');
  let result = '';
  let digitIdx = 0;
  for (let i = 0; i < mask.length && digitIdx < digits.length; i++) {
    if (mask[i] === '9') {
      result += digits[digitIdx++];
    } else {
      result += mask[i];
    }
  }
  return result;
}

interface MaskedTextFieldProps {
  mask: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  error?: boolean;
  helperText?: string;
  fullWidth?: boolean;
  required?: boolean;
  size?: 'small' | 'medium';
  className?: string;
  InputProps?: any;
}

function MaskedTextField({ mask, value, onChange, label, error, helperText, fullWidth, required, size, className, InputProps }: MaskedTextFieldProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(applyMask(e.target.value, mask));
  };

  return (
    <TextField
      label={label}
      value={applyMask(value, mask)}
      onChange={handleChange}
      error={error}
      helperText={helperText}
      fullWidth={fullWidth}
      required={required}
      size={size}
      className={className}
      InputProps={InputProps}
    />
  );
}

interface ClientFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'totalSpent' | 'visitCount' | 'lastVisit'>) => Promise<void>;
  client?: Client | null;
}

const emptyAddress: Address = {
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  municipio: '',
  codigoMunicipio: '',
  uf: '',
  cep: '',
};

const UF_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

export function ClientFormDialog({ open, onClose, onSave, client }: ClientFormDialogProps) {
  const { isDark } = useTheme();
  const [tipo, setTipo] = useState<'pf' | 'pj'>('pf');
  const [nome, setNome] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | 'O' | ''>('');
  const [endereco, setEndereco] = useState<Address>(emptyAddress);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [indicadorIE, setIndicadorIE] = useState<'1' | '2' | '9'>('9');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [suframa, setSuframa] = useState('');
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingCEP, setIsFetchingCEP] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isEditing = !!client;

  useEffect(() => {
    if (client) {
      setTipo(client.tipo);
      setNome(client.nome);
      setCpfCnpj(client.cpfCnpj);
      setEmail(client.email || '');
      setPhone(client.phone);
      setPhone2(client.phone2 || '');
      setBirthDate(client.birthDate || '');
      setGender((client.gender as 'M' | 'F' | 'O') || '');
      setEndereco(client.endereco || emptyAddress);
      setTags(client.tags || []);
      setNotes(client.notes || '');
      setInscricaoEstadual(client.inscricaoEstadual || '');
      setIndicadorIE((client.indicadorIE as '1' | '2' | '9') || '9');
      setInscricaoMunicipal((client as any).inscricaoMunicipal || '');
      setSuframa((client as any).suframa || '');
      setNomeFantasia((client as any).nomeFantasia || '');
    } else {
      resetForm();
    }
    setErrors({});
  }, [client, open]);

  function resetForm() {
    setTipo('pf');
    setNome('');
    setCpfCnpj('');
    setEmail('');
    setPhone('');
    setPhone2('');
    setBirthDate('');
    setGender('');
    setEndereco(emptyAddress);
    setTags([]);
    setTagInput('');
    setNotes('');
    setInscricaoEstadual('');
    setIndicadorIE('9');
    setInscricaoMunicipal('');
    setSuframa('');
    setNomeFantasia('');
  }

  // ---- ViaCEP Integration ----
  const fetchCEP = useCallback(async (cep: string) => {
    const cleaned = cep.replace(/\D/g, '');
    if (cleaned.length !== 8) return;

    setIsFetchingCEP(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cleaned}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setEndereco((prev) => ({
          ...prev,
          logradouro: data.logradouro || prev.logradouro,
          bairro: data.bairro || prev.bairro,
          municipio: data.localidade || prev.municipio,
          uf: data.uf || prev.uf,
          codigoMunicipio: data.ibge || prev.codigoMunicipio,
        }));
      } else {
        toast.warning('CEP nao encontrado');
      }
    } catch {
      // Silently fail - user can fill manually
    } finally {
      setIsFetchingCEP(false);
    }
  }, []);

  function handleCEPChange(value: string) {
    handleAddressChange('cep', value);
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length === 8) {
      fetchCEP(cleaned);
    }
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!nome.trim()) {
      newErrors.nome = tipo === 'pf' ? 'Nome completo obrigatorio' : 'Razao Social obrigatoria';
    }

    const cleanDoc = cpfCnpj.replace(/\D/g, '');
    if (cleanDoc) {
      if (tipo === 'pf') {
        if (cleanDoc.length !== 11) {
          newErrors.cpfCnpj = 'CPF deve ter 11 digitos';
        } else if (!validateCPF(cleanDoc)) {
          newErrors.cpfCnpj = 'CPF invalido';
        }
      } else if (tipo === 'pj') {
        if (cleanDoc.length !== 14) {
          newErrors.cpfCnpj = 'CNPJ deve ter 14 digitos';
        } else if (!validateCNPJ(cleanDoc)) {
          newErrors.cpfCnpj = 'CNPJ invalido';
        }
      }
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length < 10) {
      newErrors.phone = 'Telefone invalido';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'E-mail invalido';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleAddTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault();
      const newTag = tagInput.trim().toLowerCase();
      if (!tags.includes(newTag)) {
        setTags((prev) => [...prev, newTag]);
      }
      setTagInput('');
    }
  }

  function handleRemoveTag(tagToRemove: string) {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  }

  function handleAddressChange(field: keyof Address, value: string) {
    setEndereco((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const payload: Record<string, any> = {
        businessId: '',
        tipo,
        nome: nome.trim(),
        cpfCnpj: cpfCnpj.replace(/\D/g, '') || '',
        phone: phone.replace(/\D/g, '') || '',
        isActive: client?.isActive ?? true,
      };
      if (email.trim()) payload.email = email.trim();
      if (phone2.replace(/\D/g, '')) payload.phone2 = phone2.replace(/\D/g, '');
      if (birthDate) payload.birthDate = birthDate;
      if (gender) payload.gender = gender;
      if (endereco.cep) payload.endereco = endereco;
      if (tags.length > 0) payload.tags = tags;
      if (notes.trim()) payload.notes = notes.trim();
      if (tipo === 'pj' && inscricaoEstadual.trim()) payload.inscricaoEstadual = inscricaoEstadual.trim();
      if (tipo === 'pj') payload.indicadorIE = indicadorIE;
      if (inscricaoMunicipal) payload.inscricaoMunicipal = inscricaoMunicipal;
      if (suframa) payload.suframa = suframa;
      if (nomeFantasia.trim()) payload.nomeFantasia = nomeFantasia.trim();

      await onSave(payload as any);
      toast.success(isEditing ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!');
      onClose();
    } catch (error) {
      toast.error('Erro ao salvar cliente. Tente novamente.');
      console.error('Error saving client:', error);
    } finally {
      setIsSaving(false);
    }
  }

  const cpfMask = '999.999.999-99';
  const cnpjMask = '99.999.999/9999-99';
  const phoneMask = '(99) 99999-9999';
  const cepMask = '99999-999';

  return (
    <Dialog
      open={open}
      onClose={isSaving ? undefined : onClose}
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
        <span>{isEditing ? 'Editar Cliente' : 'Novo Cliente'}</span>
        <IconButton onClick={onClose} disabled={isSaving} size="small">
          <X size={20} />
        </IconButton>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 3 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="space-y-6">
              {/* Tipo PF/PJ */}
              <div>
                <ToggleButtonGroup
                  value={tipo}
                  exclusive
                  onChange={(_, val) => val && setTipo(val)}
                  size="small"
                  sx={{ mb: 1 }}
                >
                  <ToggleButton
                    value="pf"
                    sx={{
                      px: 3,
                      gap: 1,
                      '&.Mui-selected': {
                        backgroundColor: isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2',
                        color: isDark ? '#F87171' : '#DC2626',
                        borderColor: isDark ? '#EF4444' : '#DC2626',
                        '&:hover': { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : '#FEE2E2' },
                      },
                    }}
                  >
                    <User size={16} />
                    Pessoa Fisica
                  </ToggleButton>
                  <ToggleButton
                    value="pj"
                    sx={{
                      px: 3,
                      gap: 1,
                      '&.Mui-selected': {
                        backgroundColor: isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2',
                        color: isDark ? '#F87171' : '#DC2626',
                        borderColor: isDark ? '#EF4444' : '#DC2626',
                        '&:hover': { backgroundColor: isDark ? 'rgba(220,38,38,0.15)' : '#FEE2E2' },
                      },
                    }}
                  >
                    <Building2 size={16} />
                    Pessoa Juridica
                  </ToggleButton>
                </ToggleButtonGroup>
              </div>

              {/* Nome + CPF/CNPJ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  label={tipo === 'pf' ? 'Nome Completo' : 'Razao Social'}
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  error={!!errors.nome}
                  helperText={errors.nome}
                  fullWidth
                  required
                  size="small"
                />
                <MaskedTextField
                  mask={tipo === 'pf' ? cpfMask : cnpjMask}
                  value={cpfCnpj}
                  onChange={setCpfCnpj}
                  label={tipo === 'pf' ? 'CPF' : 'CNPJ'}
                  error={!!errors.cpfCnpj}
                  helperText={errors.cpfCnpj}
                  fullWidth
                  size="small"
                />
              </div>

              {/* Campos fiscais PJ */}
              {tipo === 'pj' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <TextField
                      label="Inscricao Estadual (IE)"
                      value={inscricaoEstadual}
                      onChange={(e) => setInscricaoEstadual(e.target.value)}
                      placeholder="Ex: 123456789012"
                      fullWidth
                      size="small"
                    />
                    <FormControl fullWidth size="small">
                      <InputLabel>Indicador IE</InputLabel>
                      <Select
                        value={indicadorIE}
                        onChange={(e) => setIndicadorIE(e.target.value as '1' | '2' | '9')}
                        label="Indicador IE"
                      >
                        <MenuItem value="9">9 - Nao Contribuinte</MenuItem>
                        <MenuItem value="1">1 - Contribuinte ICMS</MenuItem>
                        <MenuItem value="2">2 - Contribuinte Isento</MenuItem>
                      </Select>
                    </FormControl>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <TextField
                      label="Inscricao Municipal"
                      value={inscricaoMunicipal}
                      onChange={(e) => setInscricaoMunicipal(e.target.value)}
                      placeholder="Inscricao Municipal"
                      fullWidth
                      size="small"
                    />
                    <TextField
                      label="SUFRAMA"
                      value={suframa}
                      onChange={(e) => setSuframa(e.target.value)}
                      placeholder="Codigo SUFRAMA"
                      fullWidth
                      size="small"
                      slotProps={{ htmlInput: { maxLength: 9 } }}
                    />
                    <TextField
                      label="Nome Fantasia"
                      value={nomeFantasia}
                      onChange={(e) => setNomeFantasia(e.target.value)}
                      placeholder="Nome Fantasia"
                      fullWidth
                      size="small"
                    />
                  </div>
                </>
              )}

              {/* Email + Telefone */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextField
                  label="E-mail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  error={!!errors.email}
                  helperText={errors.email}
                  fullWidth
                  size="small"
                />
                <MaskedTextField
                  mask={phoneMask}
                  value={phone}
                  onChange={setPhone}
                  label="Telefone"
                  error={!!errors.phone}
                  helperText={errors.phone}
                  fullWidth
                  size="small"
                />
              </div>

              {/* Telefone 2 + Data Nascimento + Genero */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MaskedTextField
                  mask={phoneMask}
                  value={phone2}
                  onChange={setPhone2}
                  label="Telefone 2"
                  fullWidth
                  size="small"
                />

                {tipo === 'pf' && (
                  <TextField
                    label="Data de Nascimento"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    fullWidth
                    size="small"
                    InputLabelProps={{ shrink: true }}
                  />
                )}

                {tipo === 'pf' && (
                  <FormControl fullWidth size="small">
                    <InputLabel>Genero</InputLabel>
                    <Select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O' | '')}
                      label="Genero"
                    >
                      <MenuItem value="">
                        <em>Nao informado</em>
                      </MenuItem>
                      <MenuItem value="M">Masculino</MenuItem>
                      <MenuItem value="F">Feminino</MenuItem>
                      <MenuItem value="O">Outro</MenuItem>
                    </Select>
                  </FormControl>
                )}
              </div>

              {/* Endereco */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={15} className="text-slate-500 dark:text-gray-400" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">Endereco</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="relative">
                    <MaskedTextField
                      mask={cepMask}
                      value={endereco.cep}
                      onChange={handleCEPChange}
                      label="CEP"
                      fullWidth
                      size="small"
                      helperText="Preencha para buscar endereco automaticamente"
                      InputProps={{
                        endAdornment: isFetchingCEP ? (
                          <Loader2 size={16} className="animate-spin text-red-500" />
                        ) : null,
                      }}
                    />
                  </div>
                  <TextField
                    label="Logradouro"
                    value={endereco.logradouro}
                    onChange={(e) => handleAddressChange('logradouro', e.target.value)}
                    fullWidth
                    size="small"
                    className="md:col-span-2"
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <TextField
                    label="Numero"
                    value={endereco.numero}
                    onChange={(e) => handleAddressChange('numero', e.target.value)}
                    fullWidth
                    size="small"
                  />
                  <TextField
                    label="Complemento"
                    value={endereco.complemento || ''}
                    onChange={(e) => handleAddressChange('complemento', e.target.value)}
                    fullWidth
                    size="small"
                  />
                  <TextField
                    label="Bairro"
                    value={endereco.bairro}
                    onChange={(e) => handleAddressChange('bairro', e.target.value)}
                    fullWidth
                    size="small"
                  />
                  <TextField
                    label="Cidade"
                    value={endereco.municipio}
                    onChange={(e) => handleAddressChange('municipio', e.target.value)}
                    fullWidth
                    size="small"
                  />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <FormControl fullWidth size="small">
                    <InputLabel>UF</InputLabel>
                    <Select
                      value={endereco.uf}
                      onChange={(e) => handleAddressChange('uf', e.target.value)}
                      label="UF"
                    >
                      <MenuItem value="">
                        <em>-</em>
                      </MenuItem>
                      {UF_OPTIONS.map((uf) => (
                        <MenuItem key={uf} value={uf}>
                          {uf}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="Cod. Municipio (IBGE)"
                    value={endereco.codigoMunicipio}
                    onChange={(e) => handleAddressChange('codigoMunicipio', e.target.value)}
                    fullWidth
                    size="small"
                    helperText="Preenchido automaticamente via CEP"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <p className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-2">Tags</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      onDelete={() => handleRemoveTag(tag)}
                      size="small"
                      sx={{
                        backgroundColor: isDark ? 'rgba(220,38,38,0.1)' : '#FEF2F2',
                        color: isDark ? '#F87171' : '#DC2626',
                        '& .MuiChip-deleteIcon': { color: isDark ? '#F87171' : '#EF4444' },
                      }}
                    />
                  ))}
                </div>
                <TextField
                  label="Adicionar tag (Enter para confirmar)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  fullWidth
                  size="small"
                  InputProps={{
                    startAdornment: <Plus size={16} className="text-slate-400 dark:text-gray-500 mr-2" />,
                  }}
                />
              </div>

              {/* Observacoes */}
              <TextField
                label="Observacoes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                fullWidth
                multiline
                rows={3}
                size="small"
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </DialogContent>

      <Divider />

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={onClose}
          disabled={isSaving}
          sx={{ color: '#64748B' }}
        >
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={isSaving}
          sx={{
            backgroundColor: '#DC2626',
            '&:hover': { backgroundColor: '#B91C1C' },
            minWidth: 120,
          }}
        >
          {isSaving ? (
            <CircularProgress size={20} sx={{ color: 'white' }} />
          ) : isEditing ? (
            'Salvar'
          ) : (
            'Cadastrar'
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
