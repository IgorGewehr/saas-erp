/**
 * Seed catalog — popula categorias, produtos c/ modificadores e pedidos de teste.
 *
 * Uso:  node --env-file=.env scripts/seed-catalog.mjs [businessId]
 *       (se omitido, usa qCKJKfeUredrz6VVOXbDxk7YgwY2_biz)
 *
 * É idempotente: usa IDs determinísticos (cat_pizzas, prod_pizza_familia…),
 * então re-executar sobrescreve sem duplicar.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BUSINESS_ID = process.argv[2] || 'qCKJKfeUredrz6VVOXbDxk7YgwY2_biz';

// ─── Firebase Admin init ──────────────────────────────────────────────────
if (!getApps().length) {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!sa) {
    console.error('[seed] FIREBASE_SERVICE_ACCOUNT não encontrado no .env');
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(sa)) });
}
const db = getFirestore();
const now = new Date().toISOString();

// ─── Helper: short deterministic id inside a group ─────────────────────────
function oid(prefix) { return prefix.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 24); }

// ─── Categorias ───────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'cat_pizzas',         name: 'Pizzas',           color: '#ef4444', description: 'Massa artesanal, molho de tomate fresco e mussarela de búfala',  sortOrder: 0 },
  { id: 'cat_hamburgueres',   name: 'Hambúrgueres',     color: '#f59e0b', description: 'Carne 180g artesanal, pão brioche selado',                      sortOrder: 1 },
  { id: 'cat_acompanhamentos',name: 'Acompanhamentos',  color: '#84cc16', description: 'Para dividir ou acompanhar',                                    sortOrder: 2 },
  { id: 'cat_sobremesas',     name: 'Sobremesas',       color: '#ec4899', description: 'Finalize seu pedido com uma delícia',                          sortOrder: 3 },
  { id: 'cat_bebidas',        name: 'Bebidas',          color: '#0ea5e9', description: 'Sucos naturais, refrigerantes e cervejas geladas',              sortOrder: 4 },
];

// ─── Modifier templates ─────────────────────────────────────────────────────
const PIZZA_TAMANHO = {
  id: 'grp_pizza_tamanho', name: 'Tamanho', required: true, minSelections: 1, maxSelections: 1,
  selectionType: 'single', priceStrategy: 'sum', sortOrder: 0,
  options: [
    { id: 'opt_pizza_p',   name: 'Pequena (4 fatias)',  additionalPrice: 0,  available: true, sortOrder: 0 },
    { id: 'opt_pizza_m',   name: 'Média (6 fatias)',    additionalPrice: 12, available: true, sortOrder: 1, isDefault: true },
    { id: 'opt_pizza_g',   name: 'Grande (8 fatias)',   additionalPrice: 24, available: true, sortOrder: 2 },
    { id: 'opt_pizza_gg',  name: 'Família (12 fatias)', additionalPrice: 42, available: true, sortOrder: 3 },
  ],
};
const PIZZA_SABORES = {
  id: 'grp_pizza_sabores', name: 'Sabores', required: true, minSelections: 1, maxSelections: 3,
  selectionType: 'multiple', priceStrategy: 'max', sortOrder: 1,
  description: 'Escolha até 3 sabores — paga o mais caro',
  options: [
    { id: 'sabor_margherita',   name: 'Margherita',            additionalPrice: 0,  available: true, sortOrder: 0, description: 'Molho, mussarela, tomate, manjericão' },
    { id: 'sabor_calabresa',    name: 'Calabresa',             additionalPrice: 0,  available: true, sortOrder: 1, description: 'Mussarela, calabresa, cebola' },
    { id: 'sabor_portuguesa',   name: 'Portuguesa',            additionalPrice: 5,  available: true, sortOrder: 2, description: 'Presunto, ovo, cebola, azeitona, mussarela' },
    { id: 'sabor_frango',       name: 'Frango c/ Catupiry',    additionalPrice: 8,  available: true, sortOrder: 3, description: 'Frango desfiado e catupiry original' },
    { id: 'sabor_4queijos',     name: 'Quatro Queijos',        additionalPrice: 10, available: true, sortOrder: 4, description: 'Mussarela, provolone, parmesão, gorgonzola' },
    { id: 'sabor_pepperoni',    name: 'Pepperoni',             additionalPrice: 12, available: true, sortOrder: 5, description: 'Pepperoni americano fatiado na hora' },
    { id: 'sabor_vegetariana',  name: 'Vegetariana',           additionalPrice: 3,  available: true, sortOrder: 6, description: 'Brócolis, palmito, milho, tomate seco' },
    { id: 'sabor_choc',         name: 'Chocolate c/ Morango',  additionalPrice: 5,  available: true, sortOrder: 7, description: 'Chocolate ao leite e morangos frescos' },
  ],
};
const PIZZA_BORDA = {
  id: 'grp_pizza_borda', name: 'Borda', required: false, minSelections: 0, maxSelections: 1,
  selectionType: 'single', priceStrategy: 'sum', sortOrder: 2,
  options: [
    { id: 'borda_sem',     name: 'Sem borda',  additionalPrice: 0,  available: true, sortOrder: 0, isDefault: true },
    { id: 'borda_cheddar', name: 'Cheddar',    additionalPrice: 8,  available: true, sortOrder: 1 },
    { id: 'borda_catupiry',name: 'Catupiry',   additionalPrice: 8,  available: true, sortOrder: 2 },
    { id: 'borda_choc',    name: 'Chocolate',  additionalPrice: 10, available: true, sortOrder: 3 },
  ],
};

const BURGER_PONTO = {
  id: 'grp_burger_ponto', name: 'Ponto da carne', required: true, minSelections: 1, maxSelections: 1,
  selectionType: 'single', priceStrategy: 'sum', sortOrder: 0,
  options: [
    { id: 'ponto_mal',    name: 'Mal passado', additionalPrice: 0, available: true, sortOrder: 0 },
    { id: 'ponto_ponto',  name: 'Ao ponto',    additionalPrice: 0, available: true, sortOrder: 1, isDefault: true },
    { id: 'ponto_bem',    name: 'Bem passado', additionalPrice: 0, available: true, sortOrder: 2 },
  ],
};
const BURGER_ADICIONAIS = {
  id: 'grp_burger_adicionais', name: 'Adicionais', required: false, minSelections: 0, maxSelections: 8,
  selectionType: 'quantity', priceStrategy: 'sum', sortOrder: 1,
  description: 'Turbine seu burger — adicione quantos quiser',
  options: [
    { id: 'add_bacon',   name: 'Bacon crocante',        additionalPrice: 5,   available: true, sortOrder: 0, maxQuantity: 3 },
    { id: 'add_cheddar', name: 'Queijo cheddar extra',  additionalPrice: 3.5, available: true, sortOrder: 1, maxQuantity: 4 },
    { id: 'add_ovo',     name: 'Ovo',                   additionalPrice: 2.5, available: true, sortOrder: 2, maxQuantity: 2 },
    { id: 'add_cebola',  name: 'Cebola caramelizada',   additionalPrice: 3,   available: true, sortOrder: 3, maxQuantity: 2 },
    { id: 'add_picles',  name: 'Picles',                additionalPrice: 1.5, available: true, sortOrder: 4, maxQuantity: 2 },
  ],
};
const BURGER_SEM = {
  id: 'grp_burger_sem', name: 'Remover ingredientes', required: false, minSelections: 0, maxSelections: 5,
  selectionType: 'multiple', priceStrategy: 'sum', sortOrder: 2,
  options: [
    { id: 'rem_cebola',   name: 'Sem cebola',   additionalPrice: 0, available: true, sortOrder: 0 },
    { id: 'rem_tomate',   name: 'Sem tomate',   additionalPrice: 0, available: true, sortOrder: 1 },
    { id: 'rem_picles',   name: 'Sem picles',   additionalPrice: 0, available: true, sortOrder: 2 },
    { id: 'rem_alface',   name: 'Sem alface',   additionalPrice: 0, available: true, sortOrder: 3 },
    { id: 'rem_maionese', name: 'Sem maionese', additionalPrice: 0, available: true, sortOrder: 4 },
  ],
};
const BURGER_MOLHOS = {
  id: 'grp_burger_molhos', name: 'Molhos', required: false, minSelections: 0, maxSelections: 3,
  selectionType: 'multiple', priceStrategy: 'sum', sortOrder: 3,
  options: [
    { id: 'molho_casa',     name: 'Maionese da casa', additionalPrice: 0, available: true, sortOrder: 0, isDefault: true },
    { id: 'molho_bbq',      name: 'BBQ',              additionalPrice: 2, available: true, sortOrder: 1 },
    { id: 'molho_mostarda', name: 'Mostarda & Mel',   additionalPrice: 2, available: true, sortOrder: 2 },
    { id: 'molho_cheddar',  name: 'Cheddar cremoso',  additionalPrice: 3, available: true, sortOrder: 3 },
    { id: 'molho_picante',  name: 'Picante',          additionalPrice: 2, available: true, sortOrder: 4 },
  ],
};

const SOBREMESA_COBERTURA = {
  id: 'grp_sobremesa_cobertura', name: 'Cobertura', required: false, minSelections: 0, maxSelections: 1,
  selectionType: 'single', priceStrategy: 'sum', sortOrder: 0,
  options: [
    { id: 'cob_sem',      name: 'Sem cobertura',       additionalPrice: 0, available: true, sortOrder: 0, isDefault: true },
    { id: 'cob_chantilly',name: 'Chantilly',           additionalPrice: 4, available: true, sortOrder: 1 },
    { id: 'cob_ganache',  name: 'Ganache de chocolate',additionalPrice: 6, available: true, sortOrder: 2 },
    { id: 'cob_morango',  name: 'Calda de morango',    additionalPrice: 5, available: true, sortOrder: 3 },
  ],
};

const FRITAS_TAMANHO = {
  id: 'grp_fritas_tamanho', name: 'Tamanho', required: true, minSelections: 1, maxSelections: 1,
  selectionType: 'single', priceStrategy: 'sum', sortOrder: 0,
  options: [
    { id: 'fritas_p', name: 'Pequena (150g)', additionalPrice: 0,  available: true, sortOrder: 0, isDefault: true },
    { id: 'fritas_m', name: 'Média (250g)',   additionalPrice: 6,  available: true, sortOrder: 1 },
    { id: 'fritas_g', name: 'Grande (400g)',  additionalPrice: 12, available: true, sortOrder: 2 },
  ],
};
const FRITAS_COBERTURA = {
  id: 'grp_fritas_cobertura', name: 'Coberturas (extra)', required: false, minSelections: 0, maxSelections: 3,
  selectionType: 'multiple', priceStrategy: 'sum', sortOrder: 1,
  options: [
    { id: 'fcob_cheddar',  name: 'Cheddar derretido',  additionalPrice: 5, available: true, sortOrder: 0 },
    { id: 'fcob_bacon',    name: 'Bacon em cubos',     additionalPrice: 6, available: true, sortOrder: 1 },
    { id: 'fcob_parmesao', name: 'Parmesão ralado',    additionalPrice: 3, available: true, sortOrder: 2 },
    { id: 'fcob_cebola',   name: 'Cebola crocante',    additionalPrice: 4, available: true, sortOrder: 3 },
  ],
};

// ─── Produtos ─────────────────────────────────────────────────────────────
const PRODUCTS = [
  // ─ Pizzas ─
  {
    id: 'prod_pizza_montar', name: 'Pizza — Monte a sua',
    menuCategoryId: 'cat_pizzas',
    salePrice: 35,
    description: 'Monte sua pizza escolhendo tamanho, até 3 sabores e borda recheada',
    menuDescription: 'Tamanho, sabores, borda — você personaliza',
    imageUrl: 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=600&q=80',
    currentStock: 999, minStock: 0, category: 'Produto', unit: 'UN', costPrice: 15,
    isActive: true, isDeliverable: true, hasModifiers: true,
    preparationTime: 30,
    modifierGroups: [PIZZA_TAMANHO, PIZZA_SABORES, PIZZA_BORDA],
  },
  {
    id: 'prod_pizza_doce', name: 'Pizza Doce Especial',
    menuCategoryId: 'cat_pizzas',
    salePrice: 42,
    description: 'Pizza doce com chocolate belga ao leite, morangos frescos e leite condensado',
    menuDescription: 'Chocolate belga, morango e leite condensado',
    imageUrl: 'https://images.unsplash.com/photo-1590947132387-155cc02f3212?w=600&q=80',
    currentStock: 999, minStock: 0, category: 'Produto', unit: 'UN', costPrice: 18,
    isActive: true, isDeliverable: true, preparationTime: 25,
    dietary: ['vegetarian'],
  },

  // ─ Hambúrgueres ─
  {
    id: 'prod_burger_classic', name: 'Classic Burger',
    menuCategoryId: 'cat_hamburgueres',
    salePrice: 32,
    description: 'Carne 180g, queijo cheddar, alface, tomate, cebola e molho da casa no pão brioche',
    menuDescription: '180g, cheddar, salada e molho da casa',
    imageUrl: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&q=80',
    currentStock: 50, minStock: 10, category: 'Produto', unit: 'UN', costPrice: 12,
    isActive: true, isDeliverable: true, hasModifiers: true,
    preparationTime: 15,
    modifierGroups: [BURGER_PONTO, BURGER_ADICIONAIS, BURGER_MOLHOS, BURGER_SEM],
  },
  {
    id: 'prod_burger_duplo', name: 'Double Trouble',
    menuCategoryId: 'cat_hamburgueres',
    salePrice: 44,
    description: 'Dois burgers 180g, bacon, cheddar duplo, cebola caramelizada, pão brioche',
    menuDescription: '2x 180g, bacon, cheddar duplo e cebola caramelizada',
    imageUrl: 'https://images.unsplash.com/photo-1572802419224-296b0aeee0d9?w=600&q=80',
    currentStock: 30, minStock: 5, category: 'Produto', unit: 'UN', costPrice: 18,
    isActive: true, isDeliverable: true, hasModifiers: true,
    preparationTime: 18,
    modifierGroups: [BURGER_PONTO, BURGER_ADICIONAIS, BURGER_MOLHOS, BURGER_SEM],
  },
  {
    id: 'prod_burger_veggie', name: 'Veggie Power',
    menuCategoryId: 'cat_hamburgueres',
    salePrice: 34,
    description: 'Burger 100% vegetal de grão-de-bico e quinoa, queijo vegetal, alface, tomate e molho tahine',
    menuDescription: 'Burger vegetal artesanal com molho tahine',
    imageUrl: 'https://images.unsplash.com/photo-1525059696034-4967a729002e?w=600&q=80',
    currentStock: 25, minStock: 5, category: 'Produto', unit: 'UN', costPrice: 14,
    isActive: true, isDeliverable: true, dietary: ['vegan', 'vegetarian'],
    preparationTime: 15,
    hasModifiers: true,
    modifierGroups: [BURGER_MOLHOS, BURGER_SEM],
  },

  // ─ Acompanhamentos ─
  {
    id: 'prod_batata_frita', name: 'Batata Frita Artesanal',
    menuCategoryId: 'cat_acompanhamentos',
    salePrice: 18,
    description: 'Batatas rústicas crocantes por fora e macias por dentro. Escolha o tamanho e coberturas',
    menuDescription: 'Rústica artesanal — escolha tamanho e coberturas',
    imageUrl: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&q=80',
    currentStock: 80, minStock: 10, category: 'Produto', unit: 'UN', costPrice: 4,
    isActive: true, isDeliverable: true, hasModifiers: true,
    preparationTime: 10,
    modifierGroups: [FRITAS_TAMANHO, FRITAS_COBERTURA],
  },
  {
    id: 'prod_onion_rings', name: 'Onion Rings',
    menuCategoryId: 'cat_acompanhamentos',
    salePrice: 22,
    description: 'Anéis de cebola empanados crocantes com molho barbecue da casa',
    menuDescription: '10 unidades com molho barbecue',
    imageUrl: 'https://images.unsplash.com/photo-1639024471283-03518883512d?w=600&q=80',
    currentStock: 40, minStock: 5, category: 'Produto', unit: 'UN', costPrice: 6,
    isActive: true, isDeliverable: true, dietary: ['vegetarian'], preparationTime: 8,
  },
  {
    id: 'prod_chicken_nuggets', name: 'Chicken Nuggets',
    menuCategoryId: 'cat_acompanhamentos',
    salePrice: 24,
    description: '10 nuggets de frango empanados com molho honey mustard',
    menuDescription: '10 unidades com molho honey mustard',
    imageUrl: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=600&q=80',
    currentStock: 60, minStock: 10, category: 'Produto', unit: 'UN', costPrice: 8,
    isActive: true, isDeliverable: true, dietary: ['kids'], preparationTime: 10,
  },

  // ─ Sobremesas ─
  {
    id: 'prod_brownie', name: 'Brownie com Sorvete',
    menuCategoryId: 'cat_sobremesas',
    salePrice: 24,
    description: 'Brownie quente de chocolate belga com sorvete de creme e calda',
    menuDescription: 'Brownie quente com sorvete de creme',
    imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&q=80',
    currentStock: 30, minStock: 5, category: 'Produto', unit: 'UN', costPrice: 9,
    isActive: true, isDeliverable: true, dietary: ['vegetarian'], preparationTime: 5,
    hasModifiers: true,
    modifierGroups: [SOBREMESA_COBERTURA],
  },
  {
    id: 'prod_pudim', name: 'Pudim da Vovó',
    menuCategoryId: 'cat_sobremesas',
    salePrice: 15,
    description: 'Pudim de leite condensado tradicional com calda de caramelo',
    menuDescription: 'Receita da família, leite condensado',
    imageUrl: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=600&q=80',
    currentStock: 20, minStock: 3, category: 'Produto', unit: 'UN', costPrice: 4,
    isActive: true, isDeliverable: true, dietary: ['vegetarian'], preparationTime: 2,
  },
  {
    id: 'prod_petit_gateau', name: 'Petit Gâteau',
    menuCategoryId: 'cat_sobremesas',
    salePrice: 28,
    description: 'Bolinho quente com recheio cremoso de chocolate e sorvete de baunilha',
    menuDescription: 'Bolinho quente recheado + sorvete de baunilha',
    imageUrl: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=600&q=80',
    currentStock: 15, minStock: 3, category: 'Produto', unit: 'UN', costPrice: 10,
    isActive: true, isDeliverable: true, dietary: ['vegetarian'], preparationTime: 8,
  },

  // ─ Bebidas ─
  {
    id: 'prod_coca_350', name: 'Coca-Cola Lata 350ml',
    menuCategoryId: 'cat_bebidas',
    salePrice: 7,
    description: 'Coca-Cola tradicional gelada 350ml',
    imageUrl: 'https://images.unsplash.com/photo-1629203851122-3726ecdf080e?w=600&q=80',
    currentStock: 200, minStock: 20, category: 'Produto', unit: 'UN', costPrice: 3,
    isActive: true, isDeliverable: true, preparationTime: 1,
  },
  {
    id: 'prod_coca_zero', name: 'Coca-Cola Zero 350ml',
    menuCategoryId: 'cat_bebidas',
    salePrice: 7,
    description: 'Coca-Cola Zero açúcar gelada 350ml',
    imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&q=80',
    currentStock: 150, minStock: 20, category: 'Produto', unit: 'UN', costPrice: 3,
    isActive: true, isDeliverable: true, preparationTime: 1,
  },
  {
    id: 'prod_guarana', name: 'Guaraná Antarctica 2L',
    menuCategoryId: 'cat_bebidas',
    salePrice: 14,
    description: 'Guaraná Antarctica garrafa 2 litros — ideal para compartilhar',
    imageUrl: 'https://images.unsplash.com/photo-1625740822022-16cf08e1cb4b?w=600&q=80',
    currentStock: 80, minStock: 10, category: 'Produto', unit: 'UN', costPrice: 6,
    isActive: true, isDeliverable: true, preparationTime: 1,
  },
  {
    id: 'prod_suco_laranja', name: 'Suco de Laranja Natural',
    menuCategoryId: 'cat_bebidas',
    salePrice: 12,
    description: 'Laranja espremida na hora, 400ml, sem açúcar',
    menuDescription: 'Espremido na hora, sem açúcar',
    imageUrl: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600&q=80',
    currentStock: 40, minStock: 5, category: 'Produto', unit: 'UN', costPrice: 4,
    isActive: true, isDeliverable: true, dietary: ['vegan', 'glutenfree'], preparationTime: 3,
  },
  {
    id: 'prod_agua_500', name: 'Água Mineral sem Gás 500ml',
    menuCategoryId: 'cat_bebidas',
    salePrice: 5,
    description: 'Água mineral 500ml',
    imageUrl: 'https://images.unsplash.com/photo-1548839140-29a749e7b8ef?w=600&q=80',
    currentStock: 300, minStock: 30, category: 'Produto', unit: 'UN', costPrice: 1.5,
    isActive: true, isDeliverable: true, preparationTime: 1,
  },
  {
    id: 'prod_cerveja_long', name: 'Cerveja Heineken Long Neck',
    menuCategoryId: 'cat_bebidas',
    salePrice: 12,
    description: 'Heineken garrafa 330ml gelada',
    imageUrl: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?w=600&q=80',
    currentStock: 100, minStock: 20, category: 'Produto', unit: 'UN', costPrice: 5,
    isActive: true, isDeliverable: true, dietary: ['alcool'], preparationTime: 1,
  },
];

// ─── Pedidos de teste ─────────────────────────────────────────────────────
const ORDERS = [
  {
    number: 1001, status: 'recebido', channel: 'site',
    clientName: 'Maria Silva', clientPhone: '47991234567',
    items: [
      {
        productId: 'prod_burger_classic', productName: 'Classic Burger',
        quantity: 2, unitPrice: 42.50, basePrice: 32, total: 85.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_burger_classic').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_burger_ponto', groupName: 'Ponto da carne', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'ponto_ponto', optionName: 'Ao ponto', additionalPrice: 0, quantity: 1 }] },
          { groupId: 'grp_burger_adicionais', groupName: 'Adicionais', priceStrategy: 'sum',
            selectedOptions: [
              { optionId: 'add_bacon', optionName: 'Bacon crocante', additionalPrice: 5, quantity: 1 },
              { optionId: 'add_cheddar', optionName: 'Queijo cheddar extra', additionalPrice: 3.5, quantity: 1 },
            ] },
        ],
      },
      {
        productId: 'prod_coca_350', productName: 'Coca-Cola Lata 350ml',
        quantity: 2, unitPrice: 7, basePrice: 7, total: 14.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_coca_350').imageUrl,
      },
    ],
    subtotal: 99.00, deliveryFee: 8, total: 107.00,
    deliveryType: 'entrega', paymentMethod: 'pix', paymentStatus: 'pago',
    deliveryAddress: { logradouro: 'Rua das Flores', numero: '123', bairro: 'Centro', municipio: 'Brusque', uf: 'SC', cep: '88350000' },
    customerNotes: 'Por favor caprichar no molho',
  },
  {
    number: 1002, status: 'preparando', channel: 'whatsapp',
    clientName: 'João Pereira', clientPhone: '47998765432',
    items: [
      {
        productId: 'prod_pizza_montar', productName: 'Pizza — Monte a sua',
        quantity: 1, unitPrice: 83, basePrice: 35, total: 83.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_pizza_montar').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_pizza_tamanho', groupName: 'Tamanho', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'opt_pizza_g', optionName: 'Grande (8 fatias)', additionalPrice: 24, quantity: 1 }] },
          { groupId: 'grp_pizza_sabores', groupName: 'Sabores', priceStrategy: 'max',
            selectedOptions: [
              { optionId: 'sabor_calabresa', optionName: 'Calabresa', additionalPrice: 0, quantity: 1 },
              { optionId: 'sabor_4queijos', optionName: 'Quatro Queijos', additionalPrice: 10, quantity: 1 },
            ] },
          { groupId: 'grp_pizza_borda', groupName: 'Borda', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'borda_catupiry', optionName: 'Catupiry', additionalPrice: 8, quantity: 1 }] },
        ],
      },
      {
        productId: 'prod_guarana', productName: 'Guaraná Antarctica 2L',
        quantity: 1, unitPrice: 14, basePrice: 14, total: 14.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_guarana').imageUrl,
      },
    ],
    subtotal: 97.00, deliveryFee: 0, total: 97.00,
    deliveryType: 'retirada', paymentMethod: 'cartao_credito', paymentStatus: 'pendente',
    customerNotes: 'Pizza meio a meio',
  },
  {
    number: 1003, status: 'pronto', channel: 'site',
    clientName: 'Ana Costa', clientPhone: '47999887766',
    items: [
      {
        productId: 'prod_burger_veggie', productName: 'Veggie Power',
        quantity: 1, unitPrice: 36, basePrice: 34, total: 36.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_burger_veggie').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_burger_molhos', groupName: 'Molhos', priceStrategy: 'sum',
            selectedOptions: [
              { optionId: 'molho_bbq', optionName: 'BBQ', additionalPrice: 2, quantity: 1 },
            ] },
          { groupId: 'grp_burger_sem', groupName: 'Remover ingredientes', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'rem_cebola', optionName: 'Sem cebola', additionalPrice: 0, quantity: 1 }] },
        ],
      },
      {
        productId: 'prod_batata_frita', productName: 'Batata Frita Artesanal',
        quantity: 1, unitPrice: 29, basePrice: 18, total: 29.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_batata_frita').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_fritas_tamanho', groupName: 'Tamanho', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'fritas_m', optionName: 'Média (250g)', additionalPrice: 6, quantity: 1 }] },
          { groupId: 'grp_fritas_cobertura', groupName: 'Coberturas (extra)', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'fcob_cheddar', optionName: 'Cheddar derretido', additionalPrice: 5, quantity: 1 }] },
        ],
      },
      {
        productId: 'prod_suco_laranja', productName: 'Suco de Laranja Natural',
        quantity: 1, unitPrice: 12, basePrice: 12, total: 12.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_suco_laranja').imageUrl,
      },
    ],
    subtotal: 77.00, deliveryFee: 8, total: 85.00,
    deliveryType: 'entrega', paymentMethod: 'pix', paymentStatus: 'pago',
    deliveryAddress: { logradouro: 'Av. Brasil', numero: '450', complemento: 'Ap 302', bairro: 'Jardim Europa', municipio: 'Brusque', uf: 'SC', cep: '88355100' },
  },
  {
    number: 1004, status: 'entregue', channel: 'site',
    clientName: 'Pedro Mendes', clientPhone: '47988776655',
    items: [
      {
        productId: 'prod_brownie', productName: 'Brownie com Sorvete',
        quantity: 2, unitPrice: 28, basePrice: 24, total: 56.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_brownie').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_sobremesa_cobertura', groupName: 'Cobertura', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'cob_ganache', optionName: 'Ganache de chocolate', additionalPrice: 6, quantity: 1 }] },
        ],
      },
      {
        productId: 'prod_pudim', productName: 'Pudim da Vovó',
        quantity: 1, unitPrice: 15, basePrice: 15, total: 15.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_pudim').imageUrl,
      },
    ],
    subtotal: 71.00, deliveryFee: 8, total: 79.00,
    deliveryType: 'entrega', paymentMethod: 'dinheiro', paymentStatus: 'pago',
    changeFor: 100,
    deliveryAddress: { logradouro: 'Rua XV de Novembro', numero: '999', bairro: 'Centro', municipio: 'Brusque', uf: 'SC', cep: '88350100' },
    deliveredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  },
  {
    number: 1005, status: 'saiu_entrega', channel: 'whatsapp',
    clientName: 'Carla Mendes', clientPhone: '47991122334',
    items: [
      {
        productId: 'prod_pizza_montar', productName: 'Pizza — Monte a sua',
        quantity: 1, unitPrice: 59, basePrice: 35, total: 59.00,
        imageUrl: PRODUCTS.find(p => p.id === 'prod_pizza_montar').imageUrl,
        selectedModifiers: [
          { groupId: 'grp_pizza_tamanho', groupName: 'Tamanho', priceStrategy: 'sum',
            selectedOptions: [{ optionId: 'opt_pizza_m', optionName: 'Média (6 fatias)', additionalPrice: 12, quantity: 1 }] },
          { groupId: 'grp_pizza_sabores', groupName: 'Sabores', priceStrategy: 'max',
            selectedOptions: [
              { optionId: 'sabor_portuguesa', optionName: 'Portuguesa', additionalPrice: 5, quantity: 1 },
              { optionId: 'sabor_frango', optionName: 'Frango c/ Catupiry', additionalPrice: 8, quantity: 1 },
              { optionId: 'sabor_pepperoni', optionName: 'Pepperoni', additionalPrice: 12, quantity: 1 },
            ] },
        ],
      },
    ],
    subtotal: 59.00, deliveryFee: 8, total: 67.00,
    deliveryType: 'entrega', paymentMethod: 'cartao_debito', paymentStatus: 'pago',
    deliveryAddress: { logradouro: 'Rua São João', numero: '77', bairro: 'Santa Rita', municipio: 'Brusque', uf: 'SC', cep: '88352000' },
  },
];

// ─── Clients (derivados dos pedidos) ─────────────────────────────────────
const CLIENTS = [
  { id: 'client_maria_silva',  name: 'Maria Silva',  phone: '47991234567', email: 'maria.silva@example.com' },
  { id: 'client_joao_pereira', name: 'João Pereira', phone: '47998765432', email: 'joao.pereira@example.com' },
  { id: 'client_ana_costa',    name: 'Ana Costa',    phone: '47999887766', email: 'ana.costa@example.com' },
  { id: 'client_pedro_mendes', name: 'Pedro Mendes', phone: '47988776655', email: 'pedro.mendes@example.com' },
  { id: 'client_carla_mendes', name: 'Carla Mendes', phone: '47991122334', email: 'carla.mendes@example.com' },
];

// ─── Seed execution ──────────────────────────────────────────────────────
async function run() {
  console.log(`[seed] Business: ${BUSINESS_ID}`);
  const batch = db.batch();
  let ops = 0;

  // Categories
  for (const cat of CATEGORIES) {
    batch.set(db.collection('menuCategories').doc(cat.id), {
      ...cat, businessId: BUSINESS_ID, isActive: true, createdAt: now, updatedAt: now,
    });
    ops++;
  }
  console.log(`[seed] ${CATEGORIES.length} categorias`);

  // Products
  for (const p of PRODUCTS) {
    batch.set(db.collection('products').doc(p.id), {
      ...p, businessId: BUSINESS_ID, createdAt: now, updatedAt: now,
    });
    ops++;
  }
  console.log(`[seed] ${PRODUCTS.length} produtos`);

  // Clients
  for (const c of CLIENTS) {
    batch.set(db.collection('clients').doc(c.id), {
      ...c, businessId: BUSINESS_ID, tipo: 'pf', source: 'outro', status: 'ativo',
      score: 50, isActive: true, visitCount: 1, lastVisit: now, totalSpent: 0,
      createdAt: now, updatedAt: now,
    });
    ops++;
  }
  console.log(`[seed] ${CLIENTS.length} clientes`);

  await batch.commit();
  console.log(`[seed] Batch 1 commit: ${ops} docs`);

  // Orders — separate batch (with createdAt staggered to look recent)
  const batch2 = db.batch();
  ops = 0;
  const clientByPhone = new Map(CLIENTS.map(c => [c.phone, c.id]));
  ORDERS.forEach((order, idx) => {
    const orderId = `order_${order.number}`;
    const createdAt = new Date(Date.now() - (ORDERS.length - idx) * 20 * 60 * 1000).toISOString();
    batch2.set(db.collection('deliveryOrders').doc(orderId), {
      ...order,
      businessId: BUSINESS_ID,
      clientId: clientByPhone.get(order.clientPhone),
      createdAt,
      updatedAt: createdAt,
    });
    ops++;
  });
  await batch2.commit();
  console.log(`[seed] ${ORDERS.length} pedidos`);

  // Update business with lastOrderNumber counter
  await db.collection('businesses').doc(BUSINESS_ID).set({
    lastOrderNumber: 1005,
    updatedAt: now,
  }, { merge: true });
  console.log(`[seed] Counter de pedidos: 1005`);

  console.log(`\n[seed] ✅ OK — cardápio populado em businessId=${BUSINESS_ID}`);
  console.log(`[seed] Acesse: /p/<seu-slug> para ver o cardápio público`);
  console.log(`[seed] Estoque: ${PRODUCTS.length} produtos com ${PRODUCTS.filter(p => p.hasModifiers).length} com modificadores`);
}

run().catch(err => {
  console.error('[seed] Erro:', err);
  process.exit(1);
});
