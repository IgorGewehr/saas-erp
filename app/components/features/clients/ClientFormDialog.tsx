'use client';

import React, { useState, useEffect } from 'react';
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
  Box,
  CircularProgress,
  Divider,
} from '@mui/material';
import { X, User, Building2, Plus } from 'lucide-react';
import InputMask from 'react-input-mask';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import type { Client, Address } from '@/lib/types';

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
  const [isSaving, setIsSaving] = useState(false);
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
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!nome.trim()) {
      newErrors.nome = tipo === 'pf' ? 'Nome completo obrigatorio' : 'Razao Social obrigatoria';
    }

    const cleanDoc = cpfCnpj.replace(/\D/g, '');
    if (!cleanDoc) {
      newErrors.cpfCnpj = tipo === 'pf' ? 'CPF obrigatorio' : 'CNPJ obrigatorio';
    } else if (tipo === 'pf' && cleanDoc.length !== 11) {
      newErrors.cpfCnpj = 'CPF deve ter 11 digitos';
    } else if (tipo === 'pj' && cleanDoc.length !== 14) {
      newErrors.cpfCnpj = 'CNPJ deve ter 14 digitos';
    }

    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone) {
      newErrors.phone = 'Telefone obrigatorio';
    } else if (cleanPhone.length < 10) {
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
      await onSave({
        businessId: client?.businessId || '',
        tipo,
        nome: nome.trim(),
        cpfCnpj: cpfCnpj.replace(/\D/g, ''),
        email: email.trim() || undefined,
        phone: phone.replace(/\D/g, ''),
        phone2: phone2.replace(/\D/g, '') || undefined,
        birthDate: birthDate || undefined,
        gender: (gender as 'M' | 'F' | 'O') || undefined,
        endereco: endereco.cep ? endereco : undefined,
        tags: tags.length > 0 ? tags : undefined,
        notes: notes.trim() || undefined,
        isActive: client?.isActive ?? true,
      });
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
                        backgroundColor: '#FEF2F2',
                        color: '#DC2626',
                        borderColor: '#DC2626',
                        '&:hover': { backgroundColor: '#FEE2E2' },
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
                        backgroundColor: '#FEF2F2',
                        color: '#DC2626',
                        borderColor: '#DC2626',
                        '&:hover': { backgroundColor: '#FEE2E2' },
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
                <InputMask
                  mask={tipo === 'pf' ? cpfMask : cnpjMask}
                  value={cpfCnpj}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCpfCnpj(e.target.value)}
                >
                  {/* @ts-ignore react-input-mask children render prop typing */}
                  {(inputProps: any) => (
                    <TextField
                      {...inputProps}
                      label={tipo === 'pf' ? 'CPF' : 'CNPJ'}
                      error={!!errors.cpfCnpj}
                      helperText={errors.cpfCnpj}
                      fullWidth
                      required
                      size="small"
                    />
                  )}
                </InputMask>
              </div>

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
                <InputMask
                  mask={phoneMask}
                  value={phone}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                >
                  {/* @ts-ignore react-input-mask children render prop typing */}
                  {(inputProps: any) => (
                    <TextField
                      {...inputProps}
                      label="Telefone"
                      error={!!errors.phone}
                      helperText={errors.phone}
                      fullWidth
                      required
                      size="small"
                    />
                  )}
                </InputMask>
              </div>

              {/* Telefone 2 + Data Nascimento + Genero */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <InputMask
                  mask={phoneMask}
                  value={phone2}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone2(e.target.value)}
                >
                  {/* @ts-ignore react-input-mask children render prop typing */}
                  {(inputProps: any) => (
                    <TextField
                      {...inputProps}
                      label="Telefone 2"
                      fullWidth
                      size="small"
                    />
                  )}
                </InputMask>

                <TextField
                  label="Data de Nascimento"
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />

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
              </div>

              {/* Endereco */}
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-3">Endereco</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <InputMask
                    mask={cepMask}
                    value={endereco.cep}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleAddressChange('cep', e.target.value)
                    }
                  >
                    {/* @ts-ignore react-input-mask children render prop typing */}
                    {(inputProps: any) => (
                      <TextField
                        {...inputProps}
                        label="CEP"
                        fullWidth
                        size="small"
                      />
                    )}
                  </InputMask>
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
                </div>
              </div>

              {/* Tags */}
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-2">Tags</p>
                <div className="flex flex-wrap gap-2 mb-2">
                  {tags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      onDelete={() => handleRemoveTag(tag)}
                      size="small"
                      sx={{
                        backgroundColor: '#FEF2F2',
                        color: '#DC2626',
                        '& .MuiChip-deleteIcon': { color: '#EF4444' },
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
                    startAdornment: <Plus size={16} className="text-slate-400 mr-2" />,
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
