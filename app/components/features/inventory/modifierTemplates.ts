/**
 * Templates prontos de grupos de modificadores.
 * Cobrem os casos mais comuns de estabelecimentos para acelerar o cadastro inicial.
 * IDs de grupo/opção são gerados em runtime ao aplicar o template.
 */

import type { ProductModifierGroup, ProductModifierOption } from '@/lib/types';

export interface ModifierTemplate {
  id: string;
  category: 'pizzaria' | 'hamburgueria' | 'doces' | 'acai' | 'bebidas' | 'geral';
  label: string;
  emoji: string;
  description: string;
  group: Omit<ProductModifierGroup, 'id' | 'sortOrder' | 'options'> & {
    options: Omit<ProductModifierOption, 'id' | 'sortOrder'>[];
  };
}

export const MODIFIER_TEMPLATES: ModifierTemplate[] = [
  // ─── Pizzaria ─────────────────────────────────────────────────────────────
  {
    id: 'pizza-tamanho',
    category: 'pizzaria',
    label: 'Tamanho da Pizza',
    emoji: '📏',
    description: 'P, M, G, Família — escolha única obrigatória',
    group: {
      name: 'Tamanho',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Pequena (4 fatias)', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Média (6 fatias)', additionalPrice: 10, available: true },
        { name: 'Grande (8 fatias)', additionalPrice: 20, available: true },
        { name: 'Família (12 fatias)', additionalPrice: 35, available: true },
      ],
    },
  },
  {
    id: 'pizza-sabores',
    category: 'pizzaria',
    label: 'Sabores da Pizza',
    emoji: '🍕',
    description: 'Até 3 sabores, paga o mais caro (ideal para pizza)',
    group: {
      name: 'Sabores',
      required: true,
      minSelections: 1,
      maxSelections: 3,
      selectionType: 'multiple',
      priceStrategy: 'max',
      options: [
        { name: 'Mussarela', additionalPrice: 0, available: true },
        { name: 'Calabresa', additionalPrice: 0, available: true },
        { name: 'Portuguesa', additionalPrice: 5, available: true },
        { name: 'Margherita', additionalPrice: 3, available: true },
        { name: 'Frango com Catupiry', additionalPrice: 8, available: true },
        { name: 'Quatro Queijos', additionalPrice: 10, available: true },
      ],
    },
  },
  {
    id: 'pizza-borda',
    category: 'pizzaria',
    label: 'Borda Recheada',
    emoji: '🥟',
    description: 'Opcional — sem borda, cheddar, catupiry…',
    group: {
      name: 'Borda',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Sem borda', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Cheddar', additionalPrice: 8, available: true },
        { name: 'Catupiry', additionalPrice: 8, available: true },
        { name: 'Chocolate', additionalPrice: 10, available: true },
      ],
    },
  },

  // ─── Hamburgueria ─────────────────────────────────────────────────────────
  {
    id: 'burger-ponto',
    category: 'hamburgueria',
    label: 'Ponto da Carne',
    emoji: '🥩',
    description: 'Mal passado, ao ponto, bem passado',
    group: {
      name: 'Ponto da carne',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Mal passado', additionalPrice: 0, available: true },
        { name: 'Ao ponto', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Bem passado', additionalPrice: 0, available: true },
      ],
    },
  },
  {
    id: 'burger-adicionais',
    category: 'hamburgueria',
    label: 'Adicionais (Bacon, Queijo…)',
    emoji: '🧀',
    description: 'Cada ingrediente pode ser adicionado múltiplas vezes',
    group: {
      name: 'Adicionais',
      required: false,
      minSelections: 0,
      maxSelections: 10,
      selectionType: 'quantity',
      priceStrategy: 'sum',
      options: [
        { name: 'Bacon crocante', additionalPrice: 5, available: true, maxQuantity: 3 },
        { name: 'Queijo cheddar extra', additionalPrice: 3, available: true, maxQuantity: 5 },
        { name: 'Ovo', additionalPrice: 2.5, available: true, maxQuantity: 2 },
        { name: 'Cebola caramelizada', additionalPrice: 3, available: true, maxQuantity: 2 },
        { name: 'Picles', additionalPrice: 1.5, available: true, maxQuantity: 2 },
      ],
    },
  },
  {
    id: 'burger-sem',
    category: 'hamburgueria',
    label: 'Remover Ingredientes',
    emoji: '🚫',
    description: 'O cliente pode marcar o que NÃO quer',
    group: {
      name: 'Sem',
      required: false,
      minSelections: 0,
      maxSelections: 10,
      selectionType: 'multiple',
      priceStrategy: 'sum',
      options: [
        { name: 'Sem cebola', additionalPrice: 0, available: true },
        { name: 'Sem tomate', additionalPrice: 0, available: true },
        { name: 'Sem picles', additionalPrice: 0, available: true },
        { name: 'Sem maionese', additionalPrice: 0, available: true },
        { name: 'Sem alface', additionalPrice: 0, available: true },
      ],
    },
  },
  {
    id: 'burger-molhos',
    category: 'hamburgueria',
    label: 'Molhos',
    emoji: '🥫',
    description: 'Até 3 molhos diferentes',
    group: {
      name: 'Molhos',
      required: false,
      minSelections: 0,
      maxSelections: 3,
      selectionType: 'multiple',
      priceStrategy: 'sum',
      options: [
        { name: 'Maionese da casa', additionalPrice: 0, available: true, isDefault: true },
        { name: 'BBQ', additionalPrice: 2, available: true },
        { name: 'Mostarda & Mel', additionalPrice: 2, available: true },
        { name: 'Cheddar cremoso', additionalPrice: 3, available: true },
        { name: 'Picante', additionalPrice: 2, available: true },
      ],
    },
  },

  // ─── Doces / Confeitaria ──────────────────────────────────────────────────
  {
    id: 'doces-recheio',
    category: 'doces',
    label: 'Recheio',
    emoji: '🍰',
    description: 'Escolha 1 a 2 recheios',
    group: {
      name: 'Recheio',
      required: true,
      minSelections: 1,
      maxSelections: 2,
      selectionType: 'multiple',
      priceStrategy: 'sum',
      options: [
        { name: 'Brigadeiro', additionalPrice: 0, available: true },
        { name: 'Leite Ninho', additionalPrice: 2, available: true },
        { name: 'Morango', additionalPrice: 3, available: true },
        { name: 'Doce de Leite', additionalPrice: 2, available: true },
        { name: 'Nutella', additionalPrice: 5, available: true },
      ],
    },
  },
  {
    id: 'doces-cobertura',
    category: 'doces',
    label: 'Cobertura',
    emoji: '🍫',
    description: 'Opcional — chantilly, ganache, glacê…',
    group: {
      name: 'Cobertura',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Sem cobertura', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Chantilly', additionalPrice: 4, available: true },
        { name: 'Ganache de chocolate', additionalPrice: 6, available: true },
        { name: 'Glacê colorido', additionalPrice: 5, available: true },
      ],
    },
  },

  // ─── Açaí ─────────────────────────────────────────────────────────────────
  {
    id: 'acai-tamanho',
    category: 'acai',
    label: 'Tamanho do Açaí',
    emoji: '🍧',
    description: '300ml, 500ml, 700ml, 1 litro',
    group: {
      name: 'Tamanho',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: '300 ml', additionalPrice: 0, available: true, isDefault: true },
        { name: '500 ml', additionalPrice: 8, available: true },
        { name: '700 ml', additionalPrice: 15, available: true },
        { name: '1 litro', additionalPrice: 22, available: true },
      ],
    },
  },
  {
    id: 'acai-complementos',
    category: 'acai',
    label: 'Complementos do Açaí',
    emoji: '🍓',
    description: 'Frutas, cremes, farinhas, caldas — com quantidade',
    group: {
      name: 'Complementos',
      required: false,
      minSelections: 0,
      maxSelections: 8,
      selectionType: 'quantity',
      priceStrategy: 'sum',
      options: [
        { name: 'Granola', additionalPrice: 3, available: true, maxQuantity: 3 },
        { name: 'Banana', additionalPrice: 2, available: true, maxQuantity: 3 },
        { name: 'Morango', additionalPrice: 4, available: true, maxQuantity: 3 },
        { name: 'Leite condensado', additionalPrice: 3, available: true, maxQuantity: 2 },
        { name: 'Nutella', additionalPrice: 6, available: true, maxQuantity: 2 },
        { name: 'Paçoca', additionalPrice: 3, available: true, maxQuantity: 2 },
      ],
    },
  },

  // ─── Bebidas / Café ──────────────────────────────────────────────────────
  {
    id: 'cafe-tamanho',
    category: 'bebidas',
    label: 'Tamanho do Copo',
    emoji: '☕',
    description: 'Pequeno, médio, grande',
    group: {
      name: 'Tamanho',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: '200 ml', additionalPrice: 0, available: true, isDefault: true },
        { name: '300 ml', additionalPrice: 3, available: true },
        { name: '400 ml', additionalPrice: 5, available: true },
      ],
    },
  },
  {
    id: 'cafe-leite',
    category: 'bebidas',
    label: 'Tipo de Leite',
    emoji: '🥛',
    description: 'Normal, desnatado, zero lactose, vegetal',
    group: {
      name: 'Leite',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Integral', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Desnatado', additionalPrice: 0, available: true },
        { name: 'Zero lactose', additionalPrice: 2, available: true },
        { name: 'Vegetal (aveia/amêndoa)', additionalPrice: 4, available: true },
      ],
    },
  },

  // ─── Geral ────────────────────────────────────────────────────────────────
  {
    id: 'geral-bebida',
    category: 'geral',
    label: 'Bebida (combo)',
    emoji: '🥤',
    description: 'Adicione uma bebida ao combo',
    group: {
      name: 'Bebida',
      required: false,
      minSelections: 0,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'Sem bebida', additionalPrice: 0, available: true, isDefault: true },
        { name: 'Coca-Cola 350 ml', additionalPrice: 6, available: true },
        { name: 'Guaraná 350 ml', additionalPrice: 6, available: true },
        { name: 'Suco natural 300 ml', additionalPrice: 8, available: true },
        { name: 'Água 500 ml', additionalPrice: 4, available: true },
      ],
    },
  },
  {
    id: 'geral-tamanho',
    category: 'geral',
    label: 'Tamanho Genérico (PP-GG)',
    emoji: '📐',
    description: 'Para qualquer produto com variações de tamanho',
    group: {
      name: 'Tamanho',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      selectionType: 'single',
      priceStrategy: 'sum',
      options: [
        { name: 'PP', additionalPrice: 0, available: true },
        { name: 'P', additionalPrice: 0, available: true, isDefault: true },
        { name: 'M', additionalPrice: 5, available: true },
        { name: 'G', additionalPrice: 10, available: true },
        { name: 'GG', additionalPrice: 15, available: true },
      ],
    },
  },
];

export const TEMPLATE_CATEGORIES: { id: ModifierTemplate['category']; label: string; emoji: string }[] = [
  { id: 'pizzaria', label: 'Pizzaria', emoji: '🍕' },
  { id: 'hamburgueria', label: 'Hamburgueria', emoji: '🍔' },
  { id: 'doces', label: 'Doces/Bolos', emoji: '🎂' },
  { id: 'acai', label: 'Açaí', emoji: '🍧' },
  { id: 'bebidas', label: 'Cafés/Bebidas', emoji: '☕' },
  { id: 'geral', label: 'Geral', emoji: '✨' },
];
