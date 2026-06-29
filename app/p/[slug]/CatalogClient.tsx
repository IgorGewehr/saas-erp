'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import {
  ShoppingCart, Plus, Minus, X, ChevronRight, MapPin, Phone,
  CreditCard, Wallet, Banknote, QrCode, Truck, Store,
  CheckCircle2, Clock, Star, Search, ArrowLeft, AlertCircle,
  ChevronDown, Loader2, Package, Sparkles,
} from 'lucide-react';
import type {
  Business, Product, DeliveryOrderPaymentMethod, DeliveryType,
  MenuCategory, SelectedModifier,
} from '@/lib/types';
import ProductDetailSheet from './ProductDetailSheet';
import PixPaymentPanel, { type PixCharge } from './PixPaymentPanel';
import CardPaymentBrick from './CardPaymentBrick';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;                          // unique per configuration (product + modifiers hash)
  product: Product;
  quantity: number;
  notes: string;
  selectedModifiers?: SelectedModifier[];
  unitPrice: number;                   // base + calculated modifier price
  basePrice: number;                   // product.salePrice (reference)
}

type CheckoutStep = 'cart' | 'delivery' | 'contact' | 'pix' | 'card' | 'success';

/** Pagamento online (Mercado Pago) escolhido no checkout, ou null = offline. */
type OnlineMethod = 'pix' | 'card' | null;

interface CreatedOrder {
  orderId: string;
  orderNumber: number;
  trackingToken: string;
  /** Total AUTORITATIVO recomputado server-side (subtotal + fee). Garante que o
   *  valor exibido/cobrado == o persistido. Fallback pro cartTotal se ausente. */
  total?: number;
}

/** Projeção PÚBLICA do business entregue ao cardápio anônimo. A page.tsx monta
 *  SÓ estes campos (allowlist) — NUNCA o doc completo, que contém segredos
 *  (channels.*.accessToken, fiscal/certificado). Inclui as flags MP públicas. */
type BizSettings = NonNullable<Business['settings']>;
export interface PublicBusiness {
  id: string;
  slug?: string;
  logo?: string;
  nomeFantasia: string;
  razaoSocial: string;
  mpConnected?: boolean;
  mpPublicKey?: string;
  mpLiveMode?: boolean;
  settings?: {
    openingHours?: BizSettings['openingHours'];
    aiAgent?: {
      acceptedPaymentMethods?: NonNullable<BizSettings['aiAgent']>['acceptedPaymentMethods'];
      businessDescription?: string;
      pedidos?: { acceptOrdersOffHours?: boolean; deliveryFee?: number };
    };
  };
}

interface CheckoutForm {
  deliveryType: DeliveryType;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  name: string;
  phone: string;
  paymentMethod: DeliveryOrderPaymentMethod;
  changeFor: string;
  notes: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function isBusinessOpen(hours: NonNullable<Business['settings']>['openingHours']): boolean {
  if (!hours || hours.length < 7) return true;
  const now = new Date();
  const dow = now.getDay();
  const day = hours[dow];
  if (!day?.isOpen) return false;
  const [oh, om] = (day.openTime || '00:00').split(':').map(Number);
  const [ch, cm] = (day.closeTime || '23:59').split(':').map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= oh * 60 + om && nowMin <= ch * 60 + cm;
}

/** Minimum starting price for a product (used for products with modifiers) */
function startingPrice(product: Product): number {
  const base = product.salePrice || 0;
  if (!product.hasModifiers || !product.modifierGroups?.length) return base;
  // Sum of cheapest required option from each required group
  let minExtra = 0;
  for (const group of product.modifierGroups) {
    if (!group.required || group.minSelections < 1 || group.options.length === 0) continue;
    const cheapest = Math.min(...group.options.filter(o => o.available).map(o => o.additionalPrice));
    if (!isNaN(cheapest) && cheapest > 0) minExtra += cheapest * group.minSelections;
  }
  return base + minExtra;
}

const PAYMENT_OPTIONS: { value: DeliveryOrderPaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'pix', label: 'PIX', icon: QrCode },
  { value: 'cartao_credito', label: 'Crédito', icon: CreditCard },
  { value: 'cartao_debito', label: 'Débito', icon: CreditCard },
  { value: 'dinheiro', label: 'Dinheiro', icon: Banknote },
  { value: 'voucher', label: 'Vale', icon: Wallet },
];

const DIETARY_LABELS: Record<string, string> = {
  vegan: '🌿 Vegano', vegetarian: '🥗 Veg.', glutenfree: '🌾 S/ Glúten',
  lactosefree: '🥛 S/ Lactose', picante: '🌶️ Picante', alcool: '🍺 Álcool', kids: '👶 Kids',
};

const UNCATEGORIZED_ID = '__uncategorized__';

// 27 unidades federativas — fallback editável quando o ViaCEP não resolve o CEP
// (a API de pedidos exige `uf`; sem isso o pedido de entrega é rejeitado).
const UF_LIST = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37,
  38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66,
  67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92,
  93, 94, 95, 96, 97, 98, 99,
]);

function formatPhoneBR(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Celular BR válido: DDD existente + 9 dígitos iniciando em 9. */
function isValidPhoneBR(value: string): boolean {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (!VALID_DDDS.has(Number(d.slice(0, 2)))) return false;
  return d[2] === '9';
}

// Mapa código (settings.aiAgent.acceptedPaymentMethods) → botão de checkout.
// O backend só conhece DeliveryOrderPaymentMethod; códigos sem equivalente
// direto (boleto/pontos/gift_card/outros) caem em 'outro'.
const PAYMENT_BY_CODE: Record<string, { value: DeliveryOrderPaymentMethod; label: string; icon: typeof Banknote }> = {
  pix:       { value: 'pix',            label: 'PIX',       icon: QrCode },
  credito:   { value: 'cartao_credito', label: 'Crédito',   icon: CreditCard },
  debito:    { value: 'cartao_debito',  label: 'Débito',    icon: CreditCard },
  dinheiro:  { value: 'dinheiro',       label: 'Dinheiro',  icon: Banknote },
  voucher:   { value: 'voucher',        label: 'Vale',      icon: Wallet },
  pontos:    { value: 'outro',          label: 'Pontos',    icon: Star },
  boleto:    { value: 'outro',          label: 'Boleto',    icon: Banknote },
  gift_card: { value: 'outro',          label: 'Gift Card', icon: Wallet },
  outros:    { value: 'outro',          label: 'Outro',     icon: Wallet },
};

function checkoutStorageKey(businessId: string) {
  return `sp:checkout:${businessId}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProductImage({ src, name }: { src?: string; name: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700">
        <Package className="w-7 h-7 text-gray-300 dark:text-gray-600" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  business: PublicBusiness;
  products: Product[];
  categories: MenuCategory[];
}

export default function CatalogClient({ business, products, categories }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [step, setStep] = useState<CheckoutStep>('cart');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderNumber, setOrderNumber] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [editingCartItem, setEditingCartItem] = useState<CartItem | null>(null);

  // ── Pagamento online (opcional) ─────────────────────────────────────────────
  const [onlineMethod, setOnlineMethod] = useState<OnlineMethod>(null);
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [pixData, setPixData] = useState<PixCharge | null>(null);

  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 120], [1, 0]);
  const headerScale = useTransform(scrollY, [0, 120], [1, 0.95]);

  const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
  const pillsContainerRef = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [form, setForm] = useState<CheckoutForm>({
    deliveryType: 'entrega',
    cep: '', logradouro: '', numero: '', complemento: '', bairro: '', municipio: '', uf: '',
    name: '', phone: '',
    paymentMethod: 'pix',
    changeFor: '',
    notes: '',
  });

  // MP espelhado no doc do business (projeção pública). Pagamento online só é
  // ofertado quando a loja tem conta conectada + public key + ambiente de PRODUÇÃO.
  // MP-01: NÃO ofertamos checkout sandbox (mpLiveMode!==true) ao público anônimo —
  // chave TEST-* aceitaria cartões de teste e geraria fulfillment de pedido não
  // pago de verdade. O dono valida em sandbox via smoke test, não no cardápio real.
  const onlinePaymentEnabled =
    Boolean(business.mpConnected) && Boolean(business.mpPublicKey) && business.mpLiveMode === true;
  const mpPublicKey = business.mpPublicKey ?? '';
  // onlinePaymentEnabled já exige produção, então não há mais modo-teste exposto.
  const mpTestMode = false;

  const deliveryFee = business.settings?.aiAgent?.pedidos?.deliveryFee ?? 0;
  const isOpen = isBusinessOpen(business.settings?.openingHours);
  const acceptOffHours = business.settings?.aiAgent?.pedidos?.acceptOrdersOffHours === true;
  const ordersBlocked = !isOpen && !acceptOffHours;
  const businessName = business.nomeFantasia || business.razaoSocial;

  // Estável entre retries do MESMO carrinho; renovado quando o carrinho muda
  // (efeito abaixo) ou após sucesso. Fecha pedido duplicado por double-tap/rede.
  const idempotencyKey = useRef<string | null>(null);
  // Estável: evita recriar a função a cada render (recriá-la reinicia o loop de
  // polling do PixPaymentPanel, que a tem nas deps do effect).
  const clearIdempotencyKey = useCallback(() => { idempotencyKey.current = null; }, []);
  useEffect(() => {
    idempotencyKey.current = null;
    // Carrinho mudou ⇒ o pedido criado não vale mais; recomeça do zero.
    setCreatedOrder(null);
    setPixData(null);
  }, [cart]);

  // Métodos de pagamento dirigidos pela whitelist do negócio; fallback aos
  // padrões quando ausente/vazia. Dedup por value (vários códigos → 'outro').
  const paymentOptions = useMemo(() => {
    const accepted = business.settings?.aiAgent?.acceptedPaymentMethods;
    if (!accepted?.length) return PAYMENT_OPTIONS;
    const seen = new Set<DeliveryOrderPaymentMethod>();
    const list: typeof PAYMENT_OPTIONS = [];
    for (const code of accepted) {
      const opt = PAYMENT_BY_CODE[code];
      if (!opt || seen.has(opt.value)) continue;
      seen.add(opt.value);
      list.push(opt);
    }
    return list.length ? list : PAYMENT_OPTIONS;
  }, [business.settings?.aiAgent?.acceptedPaymentMethods]);

  // ── Build category → products map ──────────────────────────────────────────
  const categoryList = useMemo(() => {
    // Start with formal categories
    const known = new Map<string, { id: string; name: string; color?: string; description?: string }>();
    categories.forEach(c => {
      if (c.isActive) known.set(c.id, { id: c.id, name: c.name, color: c.color, description: c.description });
    });
    // Also include string-based menuCategory for legacy products (fallback)
    const seen = new Set(known.values());
    const stringCats = new Set<string>();
    products.forEach(p => {
      if (p.menuCategoryId && known.has(p.menuCategoryId)) return;
      const cat = p.menuCategory || p.category;
      if (cat && !known.has(cat) && !stringCats.has(cat)) {
        stringCats.add(cat);
        known.set(cat, { id: cat, name: cat });
      }
    });
    return Array.from(known.values());
  }, [categories, products]);

  const productsByCategory = useMemo(() => {
    const map = new Map<string, Product[]>();
    const term = search.trim().toLowerCase();

    for (const p of products) {
      // Apply search filter
      if (term) {
        const hay = `${p.name} ${p.menuDescription || ''} ${p.description || ''}`.toLowerCase();
        if (!hay.includes(term)) continue;
      }
      const key = p.menuCategoryId
        || categoryList.find(c => c.name === (p.menuCategory || p.category))?.id
        || UNCATEGORIZED_ID;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }

    // Sort each category's products by name
    map.forEach(list => list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    return map;
  }, [products, categoryList, search]);

  const visibleCategories = useMemo(() => {
    const list = categoryList.filter(c => (productsByCategory.get(c.id)?.length ?? 0) > 0);
    if ((productsByCategory.get(UNCATEGORIZED_ID)?.length ?? 0) > 0) {
      list.push({ id: UNCATEGORIZED_ID, name: 'Outros' });
    }
    return list;
  }, [categoryList, productsByCategory]);

  // ── Cart helpers ─────────────────────────────────────────────────────────────
  const cartCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart]);
  const cartSubtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart]);
  const cartTotal = useMemo(() => cartSubtotal + (form.deliveryType === 'entrega' ? deliveryFee : 0), [cartSubtotal, deliveryFee, form.deliveryType]);

  const addSimpleToCart = useCallback((product: Product) => {
    setCart(prev => {
      // Match existing entry (no modifiers → same product id)
      const key = product.id + ':plain';
      const idx = prev.findIndex(i => i.id === key);
      if (idx >= 0) {
        return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        id: key,
        product,
        quantity: 1,
        notes: '',
        unitPrice: product.salePrice,
        basePrice: product.salePrice,
      }];
    });
  }, []);

  const addCustomToCart = useCallback((cartItem: CartItem) => {
    setCart(prev => {
      // Check if same config exists (by signature)
      const idx = prev.findIndex(i => i.id === cartItem.id);
      if (idx >= 0) {
        return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity + cartItem.quantity } : i);
      }
      return [...prev, cartItem];
    });
  }, []);

  const decreaseQty = useCallback((itemId: string) => {
    setCart(prev => {
      const idx = prev.findIndex(i => i.id === itemId);
      if (idx < 0) return prev;
      if (prev[idx].quantity === 1) return prev.filter((_, n) => n !== idx);
      return prev.map((i, n) => n === idx ? { ...i, quantity: i.quantity - 1 } : i);
    });
  }, []);

  const increaseQty = useCallback((itemId: string) => {
    setCart(prev => prev.map(i => i.id === itemId ? { ...i, quantity: i.quantity + 1 } : i));
  }, []);

  const handleProductClick = useCallback((product: Product) => {
    if (product.hasModifiers && product.modifierGroups?.length) {
      setDetailProduct(product);
      setEditingCartItem(null);
    } else {
      addSimpleToCart(product);
    }
  }, [addSimpleToCart]);

  const getQtyForProduct = useCallback((productId: string) => {
    return cart.filter(i => i.product.id === productId).reduce((s, i) => s + i.quantity, 0);
  }, [cart]);

  // ── Scroll spy for category pills ──────────────────────────────────────────
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.getAttribute('data-cat-id');
          if (id) setActiveCategory(id);
        }
      },
      { rootMargin: '-140px 0px -60% 0px', threshold: 0 },
    );
    Object.values(categoryRefs.current).forEach(ref => ref && observer.observe(ref));
    return () => observer.disconnect();
  }, [visibleCategories]);

  // Auto-scroll active pill into view
  useEffect(() => {
    const pill = pillRefs.current[activeCategory];
    if (pill && pillsContainerRef.current) {
      pill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeCategory]);

  function handleCategoryClick(catId: string) {
    setActiveCategory(catId);
    const el = categoryRefs.current[catId];
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 120;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  // ── CEP auto-fill ─────────────────────────────────────────────────────────
  const [cepLoading, setCepLoading] = useState(false);
  useEffect(() => {
    const cep = form.cep.replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoading(true);
    fetch(`https://viacep.com.br/ws/${cep}/json/`)
      .then(r => r.json())
      .then(d => {
        if (!d.erro) {
          setForm(f => ({ ...f, logradouro: d.logradouro || '', bairro: d.bairro || '', municipio: d.localidade || '', uf: d.uf || '' }));
        }
      })
      .catch(() => {})
      .finally(() => setCepLoading(false));
  }, [form.cep]);

  // ── Auto-preenche dados do cliente de visitas anteriores (client-only) ──────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(checkoutStorageKey(business.id));
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<CheckoutForm>;
      setForm(f => ({
        ...f,
        name: saved.name || f.name,
        phone: saved.phone || f.phone,
        cep: saved.cep || f.cep,
        logradouro: saved.logradouro || f.logradouro,
        numero: saved.numero || f.numero,
        complemento: saved.complemento || f.complemento,
        bairro: saved.bairro || f.bairro,
        municipio: saved.municipio || f.municipio,
        uf: saved.uf || f.uf,
      }));
    } catch {
      // localStorage indisponível (modo privado/SSR) — segue sem auto-preencher
    }
  }, [business.id]);

  // Corrige o método selecionado se cair fora da whitelist (ex.: pix default,
  // mas a loja não aceita pix).
  useEffect(() => {
    setForm(f => paymentOptions.some(o => o.value === f.paymentMethod)
      ? f
      : { ...f, paymentMethod: paymentOptions[0].value });
  }, [paymentOptions]);

  // Itens citados pelo backend na mensagem de erro (ex.: "Sem estoque para: X").
  const errorItemIds = useMemo(() => {
    const ids = new Set<string>();
    if (!submitError) return ids;
    for (const i of cart) {
      if (i.product.name && submitError.includes(i.product.name)) ids.add(i.id);
    }
    return ids;
  }, [submitError, cart]);

  // ── Cria o pedido (idempotente) ou reusa o já criado nesta sessão ───────────
  // Retorna sempre o CreatedOrder; lança em falha. Reaproveitar o mesmo pedido
  // permite retry do pagamento online sem duplicar o pedido.
  async function ensureOrder(): Promise<CreatedOrder> {
    if (createdOrder) return createdOrder;

    const items = cart.map(i => ({
      productId: i.product.id,
      productName: i.product.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      basePrice: i.basePrice,
      total: i.unitPrice * i.quantity,
      notes: i.notes || undefined,
      imageUrl: i.product.imageUrl || undefined,
      selectedModifiers: i.selectedModifiers,
    }));

    if (!idempotencyKey.current) {
      // crypto.randomUUID só existe em secure context (HTTPS/localhost);
      // fallback evita quebrar o checkout se servido por HTTP simples.
      idempotencyKey.current = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    // Método registrado no pedido: online PIX→'pix', online cartão→'cartao_credito'.
    const recordedMethod: DeliveryOrderPaymentMethod =
      onlineMethod === 'pix' ? 'pix' : onlineMethod === 'card' ? 'cartao_credito' : form.paymentMethod;

    const res = await fetch('/api/orders/public', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': idempotencyKey.current,
      },
      body: JSON.stringify({
        businessId: business.id,
        clientName: form.name.trim(),
        clientPhone: form.phone.replace(/\D/g, ''),
        items,
        deliveryType: form.deliveryType,
        deliveryAddress: form.deliveryType === 'entrega' ? {
          cep: form.cep, logradouro: form.logradouro, numero: form.numero,
          complemento: form.complemento || undefined, bairro: form.bairro,
          municipio: form.municipio, uf: form.uf,
        } : undefined,
        deliveryFee: form.deliveryType === 'entrega' ? deliveryFee : 0,
        paymentMethod: recordedMethod,
        changeFor: !onlineMethod && form.paymentMethod === 'dinheiro' && form.changeFor ? parseFloat(form.changeFor) : undefined,
        customerNotes: form.notes || undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao realizar pedido');

    try {
      localStorage.setItem(checkoutStorageKey(business.id), JSON.stringify({
        name: form.name.trim(), phone: form.phone,
        cep: form.cep, logradouro: form.logradouro, numero: form.numero,
        complemento: form.complemento, bairro: form.bairro,
        municipio: form.municipio, uf: form.uf,
      }));
    } catch { /* persistência best-effort */ }

    const created: CreatedOrder = {
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      trackingToken: data.trackingToken,
      total: typeof data.total === 'number' ? data.total : undefined,
    };
    setCreatedOrder(created);
    setOrderId(created.orderId);
    setOrderNumber(created.orderNumber);
    return created;
  }

  // Gera (ou reusa) a cobrança PIX do pedido. trackingToken autoriza o cliente
  // anônimo a cobrar o PRÓPRIO pedido.
  async function createPixCharge(order: CreatedOrder): Promise<PixCharge> {
    // SEM X-Idempotency-Key: a dedup é responsabilidade da rota (mint-lock +
    // reuso transacional de PIX ainda válido). Uma chave fixa `pix-${orderId}`
    // faria o withIdempotency replicar a 1ª resposta por 24h — após a expiração
    // o re-mint seria curto-circuitado e o cliente ficaria com um QR morto.
    const res = await fetch(`/api/orders/${order.orderId}/pay-pix`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingToken: order.trackingToken }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error?.message || 'Não foi possível gerar o PIX. Tente novamente.');
    }
    return data.data as PixCharge;
  }

  // ── Submit order ──────────────────────────────────────────────────────────
  async function handleSubmit() {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const order = await ensureOrder();

      if (onlineMethod === 'pix') {
        const pix = await createPixCharge(order);
        setPixData(pix);
        setStep('pix');
      } else if (onlineMethod === 'card') {
        setStep('card');
      } else {
        // Offline: pagamento na entrega/retirada — mantém o fluxo de sucesso.
        idempotencyKey.current = null; // próximo pedido recebe nova chave
        setStep('success');
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Encerra o checkout, limpa carrinho e zera o estado de pedido/pagamento.
  function finishAndReset() {
    setCheckoutOpen(false);
    setCart([]);
    setStep('cart');
    setOnlineMethod(null);
    setCreatedOrder(null);
    setPixData(null);
    setOrderId(null);
    setOrderNumber(null);
    idempotencyKey.current = null;
  }

  function openCheckout() {
    setStep('cart');
    setCheckoutOpen(true);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  const addressValid = form.deliveryType === 'retirada' || (
    form.logradouro.trim().length > 2 && form.numero.trim().length > 0
    && form.bairro.trim().length > 0
    && form.municipio.trim().length > 0 && form.uf.trim().length === 2
  );
  const contactValid = form.name.trim().length >= 2 && isValidPhoneBR(form.phone);

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-950">

      {/* ── Hero Header ────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-24 -left-20 w-80 h-80 bg-red-500/20 rounded-full blur-3xl" />
          <div className="absolute top-0 right-0 w-56 h-56 bg-red-600/10 rounded-full blur-3xl" />
        </div>

        <motion.div
          style={{ opacity: headerOpacity, scale: headerScale }}
          className="relative z-10 max-w-2xl mx-auto px-5 pt-7 pb-5 safe-top"
        >
          {/* Top row: status pill */}
          <div className="flex items-center justify-end mb-3">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
              isOpen
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                : 'bg-red-500/20 text-red-300 border border-red-400/30'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              {isOpen ? 'Aberto agora' : 'Fechado'}
            </div>
          </div>

          {/* Main row: logo + name */}
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden border border-white/10 shadow-xl bg-white flex-shrink-0">
              {business.logo ? (
                <img src={business.logo} alt={businessName} referrerPolicy="no-referrer" className="w-full h-full object-contain p-1" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-red-500 to-red-700">
                  <span className="text-xl sm:text-2xl font-black text-white">
                    {businessName.charAt(0)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-black text-white tracking-tight leading-tight line-clamp-2 break-words">
                {businessName}
              </h1>
              {business.settings?.aiAgent?.businessDescription && (
                <p className="text-[11px] sm:text-xs text-gray-400 mt-1 line-clamp-1">
                  {business.settings.aiAgent.businessDescription}
                </p>
              )}
            </div>
          </div>

          {/* Info chips row */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {deliveryFee > 0 ? (
              <span className="flex items-center gap-1.5 text-[11px] text-gray-300 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                <Truck className="w-3 h-3" /> Entrega {formatBRL(deliveryFee)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 px-2.5 py-1 rounded-full font-semibold">
                <Truck className="w-3 h-3" /> Frete grátis
              </span>
            )}
            {business.settings?.openingHours && (
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400 bg-white/5 border border-white/10 px-2.5 py-1 rounded-full">
                <Clock className="w-3 h-3" />
                {isOpen ? 'Aceitando pedidos' : 'Fora do horário'}
              </span>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Search + Categories (sticky) ────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              className="w-full pl-9 pr-4 py-3 bg-gray-100 dark:bg-gray-800 rounded-xl text-[16px] leading-tight text-gray-900 dark:text-white placeholder-gray-400 border-none outline-none focus:ring-2 focus:ring-red-400/40 transition-all"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            )}
          </div>
        </div>

        {/* Category pills */}
        {visibleCategories.length > 0 && (
          <div ref={pillsContainerRef} className="flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide max-w-2xl mx-auto">
            {visibleCategories.map(cat => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  ref={(el) => { pillRefs.current[cat.id] = el; }}
                  onClick={() => handleCategoryClick(cat.id)}
                  className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    active
                      ? 'bg-red-500 text-white shadow-sm shadow-red-200 dark:shadow-red-900'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                  }`}
                  style={active && cat.color ? { backgroundColor: cat.color } : undefined}
                >
                  {cat.name}
                  <span className={`ml-1.5 text-[10px] font-bold ${active ? 'opacity-80' : 'opacity-60'}`}>
                    {productsByCategory.get(cat.id)?.length || 0}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Product List by Category ───────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] pt-4">
        {visibleCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
              <Package className="w-7 h-7 text-gray-300" />
            </div>
            <p className="font-semibold text-gray-500 dark:text-gray-400">Nenhum item encontrado</p>
            {search && <p className="text-sm text-gray-400 mt-1">Tente outro termo de busca</p>}
          </div>
        ) : (
          <div className="space-y-6">
            {visibleCategories.map(cat => {
              const list = productsByCategory.get(cat.id) || [];
              if (list.length === 0) return null;
              return (
                <section
                  key={cat.id}
                  ref={(el) => { categoryRefs.current[cat.id] = el; }}
                  data-cat-id={cat.id}
                  className="scroll-mt-32"
                >
                  <div className="flex items-center gap-2 mb-3">
                    {cat.color && (
                      <div className="w-1 h-6 rounded-full" style={{ backgroundColor: cat.color }} />
                    )}
                    <h2 className="text-lg font-black text-gray-900 dark:text-white tracking-tight">
                      {cat.name}
                    </h2>
                    <span className="text-xs text-gray-400 font-medium">· {list.length}</span>
                  </div>
                  {cat.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 -mt-2">{cat.description}</p>
                  )}
                  <div className="space-y-2">
                    {list.map((product, i) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        qty={getQtyForProduct(product.id)}
                        onClick={() => handleProductClick(product)}
                        delay={Math.min(i * 0.03, 0.2)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Floating Cart Bar ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {cartCount > 0 && !checkoutOpen && !detailProduct && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-40 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          >
            <button
              onClick={openCheckout}
              className="max-w-2xl mx-auto flex items-center justify-between w-full bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white px-5 py-4 rounded-2xl shadow-2xl shadow-red-500/30 transition-all"
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
                  <ShoppingCart className="w-4 h-4" />
                </div>
                <span className="font-bold">{cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
              </div>
              <span className="font-bold text-lg">{formatBRL(cartSubtotal)}</span>
              <div className="flex items-center gap-1">
                <span className="font-semibold text-sm">Ver pedido</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Product Detail Sheet ──────────────────────────────────────────── */}
      <AnimatePresence>
        {detailProduct && (
          <ProductDetailSheet
            product={detailProduct}
            initialCartItem={editingCartItem}
            onClose={() => { setDetailProduct(null); setEditingCartItem(null); }}
            onAdd={(cartItem) => {
              addCustomToCart(cartItem);
              setDetailProduct(null);
              setEditingCartItem(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Checkout Sheet ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {checkoutOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              onClick={() => (step === 'cart' || step === 'delivery' || step === 'contact') && setCheckoutOpen(false)}
            />

            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-3xl shadow-2xl max-h-[92dvh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                <div className="w-10 h-1 bg-gray-200 dark:bg-gray-700 rounded-full" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
                <div className="flex items-center gap-3">
                  {(step === 'delivery' || step === 'contact') && (
                    <button onClick={() => { if (step === 'contact') setOnlineMethod(null); setStep(step === 'delivery' ? 'cart' : 'delivery'); }}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <ArrowLeft className="w-4 h-4 text-gray-500" />
                    </button>
                  )}
                  <h2 className="font-bold text-gray-900 dark:text-white">
                    {step === 'cart' ? 'Seu Pedido'
                      : step === 'delivery' ? 'Entrega'
                      : step === 'contact' ? 'Confirmar'
                      : step === 'pix' ? 'Pagamento PIX'
                      : step === 'card' ? 'Pagamento no cartão'
                      : 'Pedido Realizado!'}
                  </h2>
                </div>
                {step !== 'success' && (
                  <button onClick={() => setCheckoutOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                )}
              </div>

              {(step === 'cart' || step === 'delivery' || step === 'contact') && (
                <div className="flex gap-1.5 px-5 py-2 flex-shrink-0">
                  {(['cart', 'delivery', 'contact'] as CheckoutStep[]).map((s, i) => (
                    <div key={s} className={`h-1 flex-1 rounded-full transition-all ${
                      ['cart', 'delivery', 'contact'].indexOf(step) >= i
                        ? 'bg-red-500' : 'bg-gray-100 dark:bg-gray-800'
                    }`} />
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto overscroll-contain">
                <AnimatePresence mode="wait">

                  {/* ── Step: Cart ─────────────────────────────────────────── */}
                  {step === 'cart' && (
                    <motion.div key="cart"
                      initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
                      className="p-5 space-y-3 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">
                      {cart.map(item => (
                        <div key={item.id} className="flex items-start gap-3 pb-3 border-b border-gray-100 dark:border-gray-800 last:border-0">
                          <div className="w-14 h-14 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0">
                            <ProductImage src={item.product.imageUrl} name={item.product.name} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-sm text-gray-900 dark:text-white">{item.product.name}</p>
                              <span className="text-sm font-bold text-gray-900 dark:text-white whitespace-nowrap">
                                {formatBRL(item.unitPrice * item.quantity)}
                              </span>
                            </div>
                            {item.selectedModifiers && item.selectedModifiers.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.selectedModifiers.map(mod => (
                                  <p key={mod.groupId} className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                                    <span className="font-medium">{mod.groupName}:</span>{' '}
                                    {mod.selectedOptions.map(o =>
                                      o.quantity > 1 ? `${o.quantity}× ${o.optionName}` : o.optionName
                                    ).join(', ')}
                                  </p>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-1.5 mt-2">
                              <button onClick={() => decreaseQty(item.id)}
                                className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                <Minus className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
                              </button>
                              <span className="w-5 text-center text-sm font-bold text-gray-900 dark:text-white">{item.quantity}</span>
                              <button onClick={() => increaseQty(item.id)}
                                className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center">
                                <Plus className="w-3.5 h-3.5 text-white" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Notes */}
                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 mt-4">
                          Observações gerais
                        </label>
                        <textarea
                          value={form.notes}
                          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                          rows={2}
                          placeholder="Alguma observação para o pedido?"
                          className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight resize-none outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                        />
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-1.5 mt-2">
                        <div className="flex justify-between text-sm text-gray-500">
                          <span>Subtotal</span>
                          <span>{formatBRL(cartSubtotal)}</span>
                        </div>
                        {deliveryFee > 0 && form.deliveryType === 'entrega' && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Entrega</span>
                            <span>{formatBRL(deliveryFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-bold text-base pt-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                          <span>Total</span>
                          <span className="text-red-600 dark:text-red-400">{formatBRL(cartTotal)}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => setStep('delivery')}
                        className="w-full bg-red-500 hover:bg-red-600 active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 mt-2"
                      >
                        Continuar <ChevronRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: Delivery ─────────────────────────────────────── */}
                  {step === 'delivery' && (
                    <motion.div key="delivery"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Como prefere receber?
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {([
                            { value: 'entrega', label: 'Entrega', sub: deliveryFee > 0 ? formatBRL(deliveryFee) : 'Grátis', icon: Truck },
                            { value: 'retirada', label: 'Retirada', sub: 'No local', icon: Store },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => setForm(f => ({ ...f, deliveryType: opt.value }))}
                              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                                form.deliveryType === opt.value
                                  ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                              }`}
                            >
                              <opt.icon className={`w-5 h-5 ${form.deliveryType === opt.value ? 'text-red-500' : 'text-gray-400'}`} />
                              <div className="text-left">
                                <p className={`font-semibold text-sm ${form.deliveryType === opt.value ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                                  {opt.label}
                                </p>
                                <p className="text-xs text-gray-400">{opt.sub}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <AnimatePresence>
                        {form.deliveryType === 'entrega' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="space-y-3 overflow-hidden"
                          >
                            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">
                              Endereço de entrega
                            </label>
                            <div className="relative">
                              <input
                                value={form.cep}
                                onChange={e => setForm(f => ({ ...f, cep: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                                placeholder="CEP (apenas números)"
                                inputMode="numeric"
                                className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <input
                                value={form.logradouro}
                                onChange={e => setForm(f => ({ ...f, logradouro: e.target.value }))}
                                placeholder="Rua / Av."
                                className="col-span-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              <input
                                value={form.numero}
                                onChange={e => setForm(f => ({ ...f, numero: e.target.value }))}
                                placeholder="Nº"
                                className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                            </div>
                            <input
                              value={form.complemento}
                              onChange={e => setForm(f => ({ ...f, complemento: e.target.value }))}
                              placeholder="Complemento (apto, bloco...)"
                              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                            />
                            <input
                              value={form.bairro}
                              onChange={e => setForm(f => ({ ...f, bairro: e.target.value }))}
                              placeholder="Bairro"
                              className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                            />
                            <div className="grid grid-cols-3 gap-2">
                              <input
                                value={form.municipio}
                                onChange={e => setForm(f => ({ ...f, municipio: e.target.value }))}
                                placeholder="Cidade"
                                className="col-span-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                              />
                              <div className="relative">
                                <select
                                  value={form.uf}
                                  onChange={e => setForm(f => ({ ...f, uf: e.target.value }))}
                                  className={`appearance-none w-full px-3 py-2.5 pr-8 bg-gray-50 dark:bg-gray-800 border rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 ${
                                    form.uf ? 'text-gray-900 dark:text-white border-gray-200 dark:border-gray-700' : 'text-gray-400 border-gray-200 dark:border-gray-700'
                                  }`}
                                >
                                  <option value="" disabled>UF</option>
                                  {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                                </select>
                                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <button
                        onClick={() => setStep('contact')}
                        disabled={!addressValid}
                        className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2"
                      >
                        Continuar <ChevronRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: Contact + Payment ─────────────────────────────── */}
                  {step === 'contact' && (
                    <motion.div key="contact"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                      className="p-5 space-y-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))]">

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Seus dados
                        </label>
                        <div className="space-y-2">
                          <input
                            value={form.name}
                            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Seu nome completo"
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                          <input
                            value={form.phone}
                            onChange={e => setForm(f => ({ ...f, phone: formatPhoneBR(e.target.value) }))}
                            placeholder="WhatsApp (xx) xxxxx-xxxx"
                            type="tel"
                            inputMode="tel"
                            className="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                          {form.phone.replace(/\D/g, '').length > 0 && !isValidPhoneBR(form.phone) && (
                            <p className="text-[11px] text-amber-500 px-1">Informe um celular válido com DDD.</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                          Pagamento
                        </label>

                        {/* Pagar agora (online) — só quando a loja tem MP conectado */}
                        {onlinePaymentEnabled && (
                          <div className="mb-3">
                            <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-1.5">
                              <Sparkles className="w-3 h-3" /> Pagar agora · confirmação na hora
                            </p>
                            {mpTestMode && (
                              <div className="flex items-start gap-2 p-2.5 mb-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                                <AlertCircle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-px" />
                                <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-tight">
                                  <span className="font-bold">Ambiente de testes.</span>{' '}
                                  Os pagamentos online aqui são de sandbox e não cobram de verdade —
                                  prefira pagar na {form.deliveryType === 'entrega' ? 'entrega' : 'retirada'}.
                                </p>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                              {([
                                { value: 'pix' as const, label: 'PIX', icon: QrCode },
                                { value: 'card' as const, label: 'Cartão', icon: CreditCard },
                              ]).map(opt => {
                                const Icon = opt.icon;
                                const active = onlineMethod === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    onClick={() => setOnlineMethod(opt.value)}
                                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${
                                      active
                                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10'
                                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                                    }`}
                                  >
                                    <Icon className={`w-4 h-4 ${active ? 'text-emerald-500' : 'text-gray-400'}`} />
                                    <span className={`text-sm font-semibold ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                      {opt.label}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {onlinePaymentEnabled && (
                          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                            Ou pagar na {form.deliveryType === 'entrega' ? 'entrega' : 'retirada'}
                          </p>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          {paymentOptions.map(opt => {
                            const Icon = opt.icon;
                            const active = onlineMethod === null && form.paymentMethod === opt.value;
                            return (
                              <button
                                key={opt.value}
                                onClick={() => { setOnlineMethod(null); setForm(f => ({ ...f, paymentMethod: opt.value })); }}
                                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all ${
                                  active
                                    ? 'border-red-500 bg-red-50 dark:bg-red-500/10'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                                }`}
                              >
                                <Icon className={`w-4 h-4 ${active ? 'text-red-500' : 'text-gray-400'}`} />
                                <span className={`text-xs font-semibold ${active ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                                  {opt.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {onlineMethod === null && form.paymentMethod === 'dinheiro' && (
                          <input
                            value={form.changeFor}
                            onChange={e => setForm(f => ({ ...f, changeFor: e.target.value }))}
                            placeholder="Troco para quanto? (opcional)"
                            type="number"
                            className="mt-2 w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-[16px] leading-tight outline-none focus:ring-2 focus:ring-red-400/40 text-gray-900 dark:text-white placeholder-gray-400"
                          />
                        )}
                      </div>

                      <div className="bg-gray-50 dark:bg-gray-800/60 rounded-xl p-4 space-y-1">
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Resumo</p>
                        {cart.map(i => {
                          const culprit = errorItemIds.has(i.id);
                          return (
                            <div key={i.id} className={`flex justify-between text-sm rounded-md -mx-1 px-1 ${
                              culprit
                                ? 'text-red-600 dark:text-red-400 font-semibold bg-red-50 dark:bg-red-900/20'
                                : 'text-gray-600 dark:text-gray-400'
                            }`}>
                              <span className="truncate pr-2 flex items-center gap-1">
                                {culprit && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                                {i.quantity}× {i.product.name}
                              </span>
                              <span className="whitespace-nowrap">{formatBRL(i.unitPrice * i.quantity)}</span>
                            </div>
                          );
                        })}
                        {deliveryFee > 0 && form.deliveryType === 'entrega' && (
                          <div className="flex justify-between text-sm text-gray-500 pt-1 border-t border-gray-200 dark:border-gray-700">
                            <span>Entrega</span><span>{formatBRL(deliveryFee)}</span>
                          </div>
                        )}
                        <div className="flex justify-between font-black text-base pt-1.5 border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                          <span>Total</span>
                          <span className="text-red-600 dark:text-red-400">{formatBRL(cartTotal)}</span>
                        </div>
                      </div>

                      {submitError && (
                        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
                            <p className="text-xs text-red-500/80 dark:text-red-400/70 mt-0.5">
                              {errorItemIds.size > 0
                                ? 'Revise os itens destacados acima e tente novamente.'
                                : 'Confira os dados e tente novamente em instantes.'}
                            </p>
                          </div>
                        </div>
                      )}

                      {ordersBlocked && (
                        <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                          <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                          <p className="text-sm text-amber-600 dark:text-amber-400">Loja fechada no momento</p>
                        </div>
                      )}

                      <button
                        onClick={handleSubmit}
                        disabled={!contactValid || isSubmitting || ordersBlocked}
                        className="w-full bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] text-white py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2"
                      >
                        {isSubmitting ? (
                          <><Loader2 className="w-5 h-5 animate-spin" /> {onlineMethod ? 'Processando...' : 'Enviando...'}</>
                        ) : ordersBlocked ? (
                          <>Loja fechada</>
                        ) : onlineMethod === 'pix' ? (
                          <><QrCode className="w-4 h-4" /> Pagar com PIX · {formatBRL(cartTotal)}</>
                        ) : onlineMethod === 'card' ? (
                          <><CreditCard className="w-4 h-4" /> Pagar com cartão · {formatBRL(cartTotal)}</>
                        ) : (
                          <>Confirmar Pedido · {formatBRL(cartTotal)}</>
                        )}
                      </button>
                    </motion.div>
                  )}

                  {/* ── Step: PIX online ────────────────────────────────────── */}
                  {step === 'pix' && createdOrder && pixData && (
                    <motion.div key="pix"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                      <PixPaymentPanel
                        orderId={createdOrder.orderId}
                        trackingToken={createdOrder.trackingToken}
                        orderNumber={createdOrder.orderNumber}
                        amount={createdOrder.total ?? cartTotal}
                        pix={pixData}
                        businessName={businessName}
                        onConfirmed={clearIdempotencyKey}
                        onBackToMenu={finishAndReset}
                      />
                    </motion.div>
                  )}

                  {/* ── Step: Cartão online (Brick MP) ──────────────────────── */}
                  {step === 'card' && createdOrder && (
                    <motion.div key="card"
                      initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                      <CardPaymentBrick
                        orderId={createdOrder.orderId}
                        trackingToken={createdOrder.trackingToken}
                        orderNumber={createdOrder.orderNumber}
                        publicKey={mpPublicKey}
                        amount={createdOrder.total ?? cartTotal}
                        businessName={businessName}
                        onApproved={clearIdempotencyKey}
                        onBackToMenu={finishAndReset}
                      />
                    </motion.div>
                  )}

                  {/* ── Step: Success ───────────────────────────────────────── */}
                  {step === 'success' && (
                    <motion.div key="success"
                      initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center justify-center p-8 text-center py-12 pb-[calc(3rem+env(safe-area-inset-bottom,0px))]">
                      <motion.div
                        initial={{ scale: 0 }} animate={{ scale: 1 }}
                        transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
                        className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center mb-6"
                      >
                        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                      </motion.div>
                      <h3 className="text-2xl font-black text-gray-900 dark:text-white mb-2">
                        Pedido Recebido!
                      </h3>
                      {orderNumber && (
                        <div className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-full mb-3">
                          <span className="text-sm text-gray-500">Pedido</span>
                          <span className="font-black text-gray-900 dark:text-white">#{String(orderNumber).padStart(4, '0')}</span>
                        </div>
                      )}
                      <p className="text-gray-500 dark:text-gray-400 text-sm max-w-xs">
                        {businessName} recebeu seu pedido e logo entrará em contato pelo WhatsApp.
                      </p>
                      <div className="mt-6 space-y-2 w-full max-w-xs">
                        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-left">
                          {form.deliveryType === 'entrega' ? <Truck className="w-4 h-4 text-red-500 flex-shrink-0" /> : <Store className="w-4 h-4 text-red-500 flex-shrink-0" />}
                          <div>
                            <p className="text-xs text-gray-400">Modalidade</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {form.deliveryType === 'entrega' ? 'Entrega' : 'Retirada no local'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-xl text-left">
                          <Wallet className="w-4 h-4 text-red-500 flex-shrink-0" />
                          <div>
                            <p className="text-xs text-gray-400">Pagamento</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                              {paymentOptions.find(p => p.value === form.paymentMethod)?.label} · {formatBRL(cartTotal)}
                            </p>
                          </div>
                        </div>
                      </div>
                      {createdOrder && (
                        <a
                          href={`/p/${business.slug ?? business.id}/pedido/${createdOrder.orderId}?t=${encodeURIComponent(createdOrder.trackingToken)}`}
                          referrerPolicy="no-referrer"
                          className="mt-8 inline-flex items-center justify-center gap-2 px-8 py-3 rounded-2xl font-bold border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white transition-all hover:scale-[1.02]"
                        >
                          Acompanhar pedido
                        </a>
                      )}
                      <button
                        onClick={finishAndReset}
                        className="mt-3 px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-2xl font-bold transition-all hover:scale-[1.02]"
                      >
                        Voltar ao cardápio
                      </button>
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({
  product, qty, onClick, delay,
}: {
  product: Product;
  qty: number;
  onClick: () => void;
  delay: number;
}) {
  const outOfStock = product.currentStock <= 0 && product.currentStock !== undefined && !product.hasModifiers && !product.components?.length;
  const hasModifiers = !!product.hasModifiers && !!product.modifierGroups?.length;
  const price = hasModifiers ? startingPrice(product) : product.salePrice;

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      whileTap={{ scale: outOfStock ? 1 : 0.98 }}
      onClick={outOfStock ? undefined : onClick}
      disabled={outOfStock}
      className={`w-full text-left flex gap-3 bg-white dark:bg-gray-900 rounded-2xl p-3 shadow-sm border border-gray-100 dark:border-gray-800 transition-all ${
        outOfStock ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-200 dark:hover:border-red-900/50 active:bg-gray-50 dark:active:bg-gray-800/50'
      }`}
    >
      {(product.imageUrl) && (
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-800 relative">
          <ProductImage src={product.imageUrl} name={product.name} />
          {qty > 0 && (
            <div className="absolute top-1 right-1 bg-red-500 text-white text-[10px] font-black rounded-full w-5 h-5 flex items-center justify-center shadow-lg">
              {qty}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">{product.name}</h3>
            {product.dietary && product.dietary.length > 0 && (
              <div className="flex gap-1 flex-shrink-0">
                {product.dietary.slice(0, 2).map(d => (
                  <span key={d} className="text-[9px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-md text-gray-500">
                    {DIETARY_LABELS[d]?.split(' ')[0] || d}
                  </span>
                ))}
              </div>
            )}
          </div>
          {(product.menuDescription || product.description) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2">
              {product.menuDescription || product.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2">
          <div className="flex items-baseline gap-1.5">
            {hasModifiers && (
              <span className="text-[10px] text-gray-400 font-medium">A partir de</span>
            )}
            <span className="text-base font-black text-gray-900 dark:text-white">
              {formatBRL(price)}
            </span>
          </div>

          {outOfStock ? (
            <span className="text-xs text-gray-400 font-medium">Esgotado</span>
          ) : hasModifiers ? (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl text-xs font-semibold">
              <Sparkles className="w-3 h-3" />
              Montar
            </div>
          ) : (
            <div className="flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded-xl text-xs font-semibold shadow-sm shadow-red-200 dark:shadow-red-900/40">
              <Plus className="w-3 h-3" />
              Adicionar
            </div>
          )}
        </div>
      </div>
    </motion.button>
  );
}
