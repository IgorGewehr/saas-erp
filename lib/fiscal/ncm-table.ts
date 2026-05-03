// ===========================================================================
// Tabela de NCMs — Referência para produtos industriais, comerciais e serviços
// Nomenclatura Comum do Mercosul (8 dígitos)
// ===========================================================================

export interface NcmEntry {
  code: string;
  description: string;
  category: string;
}

export const NCM_TABLE: NcmEntry[] = [
  // -----------------------------------------------------------------------
  // Cosméticos e Higiene Pessoal (33xx)
  // -----------------------------------------------------------------------
  { code: '3301.29.90', description: 'Outros óleos essenciais', category: 'Cosméticos' },
  { code: '3302.10.90', description: 'Outras misturas de substâncias odoríferas', category: 'Cosméticos' },
  { code: '3303.00.10', description: 'Perfumes (extratos)', category: 'Cosméticos' },
  { code: '3303.00.20', description: 'Águas-de-colônia', category: 'Cosméticos' },
  { code: '3304.10.00', description: 'Produtos de maquilagem para os lábios', category: 'Cosméticos' },
  { code: '3304.20.10', description: 'Sombra, delineador, lápis para sobrancelhas e rímel', category: 'Cosméticos' },
  { code: '3304.20.90', description: 'Outros produtos de maquilagem para os olhos', category: 'Cosméticos' },
  { code: '3304.30.00', description: 'Preparações para manicuros e pedicuros', category: 'Cosméticos' },
  { code: '3304.91.00', description: 'Pós, incluindo compactos (para a pele)', category: 'Cosméticos' },
  { code: '3304.99.10', description: 'Cremes de beleza e cremes nutritivos; loções tônicas', category: 'Cosméticos' },
  { code: '3304.99.90', description: 'Outros produtos de beleza ou maquilagem preparados', category: 'Cosméticos' },
  { code: '3305.10.00', description: 'Xampus para os cabelos', category: 'Cosméticos' },
  { code: '3305.20.00', description: 'Preparações para ondulação/alisamento permanentes', category: 'Cosméticos' },
  { code: '3305.30.00', description: 'Lacas (fixadores) para o cabelo', category: 'Cosméticos' },
  { code: '3305.90.00', description: 'Outras preparações capilares', category: 'Cosméticos' },
  { code: '3306.10.00', description: 'Dentifrícios', category: 'Cosméticos' },
  { code: '3306.90.00', description: 'Outras preparações para higiene bucal ou dentária', category: 'Cosméticos' },
  { code: '3307.10.00', description: 'Preparações para barbear', category: 'Cosméticos' },
  { code: '3307.20.10', description: 'Desodorantes corporais e antiperspirantes', category: 'Cosméticos' },
  { code: '3307.20.90', description: 'Outros desodorantes corporais', category: 'Cosméticos' },
  { code: '3307.30.00', description: 'Sais perfumados e outras preparações para banho', category: 'Cosméticos' },
  { code: '3307.90.00', description: 'Outros produtos de perfumaria ou toucador preparados', category: 'Cosméticos' },
  { code: '3401.11.90', description: 'Outros sabões de toucador', category: 'Cosméticos' },
  { code: '3401.20.10', description: 'Sabões líquidos', category: 'Cosméticos' },

  // -----------------------------------------------------------------------
  // Produtos Alimentícios (04xx, 15xx, 17xx, 19xx, 20xx, 21xx, 22xx)
  // -----------------------------------------------------------------------
  { code: '0401.10.10', description: 'Leite UHT com teor de gordura <= 1%', category: 'Alimentos' },
  { code: '0401.20.10', description: 'Leite UHT com teor de gordura entre 1% e 6%', category: 'Alimentos' },
  { code: '0409.00.00', description: 'Mel natural', category: 'Alimentos' },
  { code: '1515.29.10', description: 'Óleo de milho refinado', category: 'Alimentos' },
  { code: '1517.90.10', description: 'Misturas de gorduras e óleos alimentícios', category: 'Alimentos' },
  { code: '1701.14.00', description: 'Outros açúcares de cana', category: 'Alimentos' },
  { code: '1702.30.00', description: 'Glicose e xarope de glicose', category: 'Alimentos' },
  { code: '1901.10.10', description: 'Leite modificado para alimentação de lactentes', category: 'Alimentos' },
  { code: '1901.90.90', description: 'Outras preparações alimentícias de farinhas', category: 'Alimentos' },
  { code: '2005.99.00', description: 'Outros legumes e hortaliças preparados (não congelados)', category: 'Alimentos' },
  { code: '2008.19.00', description: 'Outras frutas de casca rija preparadas ou conservadas', category: 'Alimentos' },
  { code: '2101.11.10', description: 'Café solúvel', category: 'Alimentos' },
  { code: '2106.90.10', description: 'Preparações alimentícias compostas (suplementos)', category: 'Alimentos' },
  { code: '2106.90.90', description: 'Outras preparações alimentícias n.e.', category: 'Alimentos' },
  { code: '2201.10.00', description: 'Águas minerais e águas gaseificadas', category: 'Alimentos' },
  { code: '2202.10.00', description: 'Águas aromatizadas e outras bebidas não alcoólicas', category: 'Alimentos' },

  // -----------------------------------------------------------------------
  // Farmacêuticos e Suplementos (29xx, 30xx)
  // -----------------------------------------------------------------------
  { code: '2905.44.00', description: 'D-glucitol (sorbitol)', category: 'Farmacêuticos' },
  { code: '2918.14.00', description: 'Ácido cítrico', category: 'Farmacêuticos' },
  { code: '2936.27.10', description: 'Vitamina C (ácido ascórbico)', category: 'Farmacêuticos' },
  { code: '3003.90.99', description: 'Outros medicamentos não dosados', category: 'Farmacêuticos' },
  { code: '3004.90.99', description: 'Outros medicamentos em doses', category: 'Farmacêuticos' },

  // -----------------------------------------------------------------------
  // Matérias-primas químicas (28xx, 29xx, 34xx, 38xx)
  // -----------------------------------------------------------------------
  { code: '2836.20.00', description: 'Carbonato dissódico (barrilha)', category: 'Químicos' },
  { code: '2915.21.00', description: 'Ácido acético', category: 'Químicos' },
  { code: '2917.11.10', description: 'Ácido oxálico', category: 'Químicos' },
  { code: '3402.11.90', description: 'Outros agentes orgânicos de superfície aniônicos', category: 'Químicos' },
  { code: '3402.12.00', description: 'Agentes orgânicos de superfície catiônicos', category: 'Químicos' },
  { code: '3402.13.00', description: 'Agentes orgânicos de superfície não iônicos', category: 'Químicos' },
  { code: '3809.91.90', description: 'Outros agentes de acabamento (indústria têxtil)', category: 'Químicos' },
  { code: '3824.99.89', description: 'Outros produtos químicos e preparações diversas', category: 'Químicos' },

  // -----------------------------------------------------------------------
  // Embalagens - Plástico (39xx)
  // -----------------------------------------------------------------------
  { code: '3923.21.90', description: 'Sacos de polietileno', category: 'Embalagens' },
  { code: '3923.29.10', description: 'Sacos de PVC', category: 'Embalagens' },
  { code: '3923.30.00', description: 'Garrafões, garrafas, frascos e artigos semelhantes de plástico', category: 'Embalagens' },
  { code: '3923.50.00', description: 'Rolhas, tampas e outros dispositivos de plástico para fechar recipientes', category: 'Embalagens' },
  { code: '3923.90.00', description: 'Outros artigos de transporte ou embalagem, de plástico', category: 'Embalagens' },
  { code: '3926.90.90', description: 'Outras obras de plástico', category: 'Embalagens' },

  // -----------------------------------------------------------------------
  // Embalagens - Papel e Cartão (48xx)
  // -----------------------------------------------------------------------
  { code: '4819.10.00', description: 'Caixas de papel ou cartão ondulado', category: 'Embalagens' },
  { code: '4819.20.00', description: 'Caixas e cartonagens dobráveis de papel ou cartão', category: 'Embalagens' },
  { code: '4819.40.00', description: 'Outros sacos, bolsas e cartuchos de papel ou cartão', category: 'Embalagens' },
  { code: '4821.10.00', description: 'Etiquetas impressas de papel ou cartão', category: 'Embalagens' },
  { code: '4823.90.00', description: 'Outros papéis, cartões, pastas e mantas de fibras de celulose', category: 'Embalagens' },

  // -----------------------------------------------------------------------
  // Embalagens - Vidro e Metal (70xx, 73xx, 76xx)
  // -----------------------------------------------------------------------
  { code: '7010.90.21', description: 'Frascos de vidro para cosméticos (capacidade <= 0,15L)', category: 'Embalagens' },
  { code: '7010.90.29', description: 'Outros frascos de vidro', category: 'Embalagens' },
  { code: '7310.21.90', description: 'Outras latas para acondicionar produtos', category: 'Embalagens' },
  { code: '7612.90.90', description: 'Outros recipientes tubulares de alumínio (bisnagas)', category: 'Embalagens' },

  // -----------------------------------------------------------------------
  // Rótulos e Material Gráfico (49xx)
  // -----------------------------------------------------------------------
  { code: '4911.10.90', description: 'Outros impressos publicitários, catálogos comerciais', category: 'Material Gráfico' },

  // -----------------------------------------------------------------------
  // Eletrônicos e Tecnologia (84xx, 85xx)
  // -----------------------------------------------------------------------
  { code: '8471.30.19', description: 'Outros computadores portáteis (notebooks)', category: 'Eletrônicos' },
  { code: '8471.41.10', description: 'Computadores de mesa (desktops)', category: 'Eletrônicos' },
  { code: '8471.60.54', description: 'Teclados para entrada de dados', category: 'Eletrônicos' },
  { code: '8471.60.90', description: 'Outros periféricos de entrada', category: 'Eletrônicos' },
  { code: '8517.12.13', description: 'Aparelhos de telefonia celular', category: 'Eletrônicos' },
  { code: '8519.81.20', description: 'Aparelhos de reprodução de MP3', category: 'Eletrônicos' },
  { code: '8528.72.00', description: 'Monitores para computador', category: 'Eletrônicos' },

  // -----------------------------------------------------------------------
  // Vestuário e Calçados (61xx, 62xx, 64xx)
  // -----------------------------------------------------------------------
  { code: '6101.20.00', description: 'Sobretudos e similares de algodão para homens', category: 'Vestuário' },
  { code: '6109.10.00', description: 'Camisetas de malha de algodão', category: 'Vestuário' },
  { code: '6203.42.00', description: 'Calças de algodão para homens', category: 'Vestuário' },
  { code: '6204.62.00', description: 'Calças de algodão para mulheres', category: 'Vestuário' },
  { code: '6402.99.90', description: 'Outros calçados com sola e parte superior de borracha', category: 'Vestuário' },
  { code: '6403.99.90', description: 'Outros calçados com parte superior de couro natural', category: 'Vestuário' },

  // -----------------------------------------------------------------------
  // Móveis e Utensílios (94xx)
  // -----------------------------------------------------------------------
  { code: '9401.61.00', description: 'Assentos de madeira (cadeiras)', category: 'Móveis' },
  { code: '9401.71.00', description: 'Outros assentos com armação metálica', category: 'Móveis' },
  { code: '9403.30.00', description: 'Móveis de madeira para escritório', category: 'Móveis' },
  { code: '9403.60.00', description: 'Outros móveis de madeira', category: 'Móveis' },
  { code: '9403.70.00', description: 'Móveis de matérias plásticas', category: 'Móveis' },

  // -----------------------------------------------------------------------
  // Eletrodomésticos (84xx, 85xx)
  // -----------------------------------------------------------------------
  { code: '8414.51.91', description: 'Ventiladores domésticos com motor elétrico', category: 'Eletrodomésticos' },
  { code: '8418.10.00', description: 'Combinados refrigerador-congelador', category: 'Eletrodomésticos' },
  { code: '8450.11.00', description: 'Máquinas de lavar roupa com capacidade <= 10kg', category: 'Eletrodomésticos' },
  { code: '8516.60.00', description: 'Fornos de micro-ondas', category: 'Eletrodomésticos' },
  { code: '8516.72.00', description: 'Torradeiras elétricas', category: 'Eletrodomésticos' },

  // -----------------------------------------------------------------------
  // Livros, periódicos e material escolar (49xx, 96xx)
  // -----------------------------------------------------------------------
  { code: '4901.99.00', description: 'Outros livros, brochuras e impressos semelhantes', category: 'Livros e Papelaria' },
  { code: '4902.10.00', description: 'Jornais e publicações periódicas, mesmo ilustrados', category: 'Livros e Papelaria' },
  { code: '4820.10.00', description: 'Cadernos', category: 'Livros e Papelaria' },
  { code: '9608.10.00', description: 'Canetas esferográficas', category: 'Livros e Papelaria' },
];

const NCM_CUSTOM_RE = /^\d{8}$/;

/** Returns true if the code is 8 digits but not in NCM_TABLE. */
export function isCustomNcm(code: string): boolean {
  const digits = code.replace(/\D/g, '');
  return NCM_CUSTOM_RE.test(digits) && !NCM_TABLE.some(e => e.code.replace(/\D/g, '') === digits);
}

/** Normalize a search term for fuzzy matching (case-insensitive, no dots/dashes). */
export function normalizeNcmSearch(s: string): string {
  return s.toLowerCase().replace(/[.\-\s]/g, '');
}

/** Find NCM entry by code (with or without dots). */
export function findNcmByCode(code: string): NcmEntry | undefined {
  const normalized = code.replace(/\D/g, '').trim();
  return NCM_TABLE.find(e => e.code.replace(/\D/g, '') === normalized);
}

/** Strip dots and pad to 8 digits for SEFAZ submission. */
export function formatNcmForSefaz(code: string): string {
  return code.replace(/\D/g, '').substring(0, 8).padEnd(8, '0');
}
