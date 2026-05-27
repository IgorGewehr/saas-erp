/**
 * lib/fiscal/nfse-coverage.ts
 *
 * Tabela de cobertura municipal NFS-e: pra cada município (código IBGE 7
 * dígitos), retorna o provider usado pelo sefaz-api e o status de
 * confiabilidade. Usado pra alertar o operador antes de emitir em cidade
 * sem suporte testado.
 *
 * Sincronizar manualmente com `sefaz-api/src/lib/nfse/provider-config.ts`
 * sempre que adicionar/remover município lá.
 *
 * Status:
 *   - supported     verde — provider implementado e funcional em produção
 *   - experimental  amarelo — provider implementado mas pouco testado
 *                   ou com particularidades não cobertas
 *   - unsupported   vermelho — sem provider dedicado; fallback Padrão
 *                   Nacional ADN, que pode falhar se prefeitura ainda
 *                   não migrou ou exige campos custom
 */

export type CoverageStatus = 'supported' | 'experimental' | 'unsupported';
export type CoverageProvider = 'saopaulo' | 'betha' | 'betha-legacy' | 'nacional' | 'none';

export interface NFSeCoverage {
  codigoIBGE: string;
  cidade: string;
  uf: string;
  status: CoverageStatus;
  provider: CoverageProvider;
  notes?: string;
}

/**
 * Mapeamento explícito. Cidades não listadas caem no default `unsupported`
 * com fallback Padrão Nacional ADN (que pode funcionar ou não dependendo
 * da prefeitura ter migrado pro padrão da Receita Federal).
 */
const COVERAGE_TABLE: Record<string, Omit<NFSeCoverage, 'codigoIBGE'>> = {
  // ── São Paulo (Nota Fiscal Paulistana, sistema próprio) ───────────────
  '3550308': {
    cidade: 'São Paulo',
    uf: 'SP',
    status: 'supported',
    provider: 'saopaulo',
    notes: 'Provider dedicado Paulistana com SOAP 1.1, mTLS, mapeamento LC 116 → código municipal.',
  },

  // ── Santa Catarina (Betha Cloud DPS) ──────────────────────────────────
  '4216402': { cidade: 'São José', uf: 'SC', status: 'supported', provider: 'betha' },
  '4205407': { cidade: 'Florianópolis', uf: 'SC', status: 'supported', provider: 'betha' },
  '4209102': { cidade: 'Joinville', uf: 'SC', status: 'supported', provider: 'betha' },
  '4204608': { cidade: 'Criciúma', uf: 'SC', status: 'supported', provider: 'betha' },
  '4202404': { cidade: 'Blumenau', uf: 'SC', status: 'supported', provider: 'betha' },
  '4204202': { cidade: 'Chapecó', uf: 'SC', status: 'supported', provider: 'betha' },
  '4208203': { cidade: 'Itajaí', uf: 'SC', status: 'supported', provider: 'betha' },
  '4211900': { cidade: 'Palhoça', uf: 'SC', status: 'supported', provider: 'betha' },
  '4202008': { cidade: 'Balneário Camboriú', uf: 'SC', status: 'supported', provider: 'betha' },
  '4208906': { cidade: 'Jaraguá do Sul', uf: 'SC', status: 'supported', provider: 'betha' },
  '4205902': { cidade: 'Gaspar', uf: 'SC', status: 'supported', provider: 'betha' },
  '4201406': { cidade: 'Araranguá', uf: 'SC', status: 'supported', provider: 'betha' },
  '4202305': { cidade: 'Biguaçu', uf: 'SC', status: 'supported', provider: 'betha' },
  '4202909': { cidade: 'Brusque', uf: 'SC', status: 'supported', provider: 'betha' },
  '4203006': { cidade: 'Caçador', uf: 'SC', status: 'supported', provider: 'betha' },
  '4204301': { cidade: 'Concórdia', uf: 'SC', status: 'supported', provider: 'betha' },
  '4207502': { cidade: 'Indaial', uf: 'SC', status: 'supported', provider: 'betha' },
  '4209300': { cidade: 'Lages', uf: 'SC', status: 'supported', provider: 'betha' },
  '4212502': { cidade: 'Penha', uf: 'SC', status: 'supported', provider: 'betha' },
  '4216907': { cidade: 'Timbó', uf: 'SC', status: 'supported', provider: 'betha' },
  '4217002': { cidade: 'Videira', uf: 'SC', status: 'supported', provider: 'betha' },
  '4217703': { cidade: 'Xanxerê', uf: 'SC', status: 'supported', provider: 'betha' },
  '4207601': { cidade: 'Ipira', uf: 'SC', status: 'supported', provider: 'betha' },

  // ── Rio Grande do Sul (Betha Cloud DPS) ───────────────────────────────
  '4304606': { cidade: 'Canoas', uf: 'RS', status: 'supported', provider: 'betha' },
  '4307005': { cidade: 'Erechim', uf: 'RS', status: 'supported', provider: 'betha' },
};

/**
 * Cidades grandes conhecidas com sistema próprio (não migraram pro Padrão
 * Nacional ADN) — emissão via fallback ADN provavelmente vai falhar. Mostra
 * vermelho com aviso explícito.
 */
const KNOWN_BROKEN_FALLBACK: Record<string, Omit<NFSeCoverage, 'codigoIBGE'>> = {
  '3304557': {
    cidade: 'Rio de Janeiro',
    uf: 'RJ',
    status: 'unsupported',
    provider: 'none',
    notes: 'Rio usa "Nota Carioca" (sistema próprio com procuração eletrônica). Provider municipal ainda não implementado.',
  },
  '3106200': {
    cidade: 'Belo Horizonte',
    uf: 'MG',
    status: 'unsupported',
    provider: 'none',
    notes: 'BH usa "BHISS Web Service" com CNAE obrigatório. Provider municipal ainda não implementado.',
  },
  '4314902': {
    cidade: 'Porto Alegre',
    uf: 'RS',
    status: 'unsupported',
    provider: 'none',
    notes: 'POA usa motor Coplan. Provider municipal ainda não implementado.',
  },
  '4106902': {
    cidade: 'Curitiba',
    uf: 'PR',
    status: 'unsupported',
    provider: 'none',
    notes: 'Curitiba usa motor ISSNet. Provider municipal ainda não implementado.',
  },
  '5300108': {
    cidade: 'Brasília',
    uf: 'DF',
    status: 'experimental',
    provider: 'nacional',
    notes: 'DF está migrando pro Padrão Nacional ADN (cronograma 2024-2026). Pode funcionar ou não dependendo da inscrição.',
  },
  '2927408': {
    cidade: 'Salvador',
    uf: 'BA',
    status: 'unsupported',
    provider: 'none',
    notes: 'Salvador usa sistema MGAR com particularidades. Provider municipal ainda não implementado.',
  },
};

/**
 * Resolve cobertura pra um código IBGE. Retorna `unsupported` quando não há
 * provider dedicado (fallback Padrão Nacional, que pode ou não funcionar).
 */
export function getNFSeCoverage(codigoIBGE: string | null | undefined): NFSeCoverage {
  const codigo = String(codigoIBGE || '').replace(/\D/g, '').slice(0, 7);
  if (!codigo) {
    return {
      codigoIBGE: '',
      cidade: '—',
      uf: '—',
      status: 'unsupported',
      provider: 'none',
      notes: 'Código IBGE do município não configurado em Configurações → Empresa.',
    };
  }
  const entry = COVERAGE_TABLE[codigo] || KNOWN_BROKEN_FALLBACK[codigo];
  if (entry) {
    return { codigoIBGE: codigo, ...entry };
  }
  return {
    codigoIBGE: codigo,
    cidade: '—',
    uf: '—',
    status: 'unsupported',
    provider: 'none',
    notes: 'Município sem provider dedicado. A emissão tentará Padrão Nacional ADN como fallback — pode falhar se a prefeitura ainda não migrou pro padrão da Receita Federal.',
  };
}

/**
 * Lista todos os municípios com provider dedicado (tested-prod ou
 * experimental). Para a página de admin de cobertura.
 */
export function listSupportedNFSeMunicipios(): NFSeCoverage[] {
  const all: NFSeCoverage[] = [];
  for (const [codigoIBGE, entry] of Object.entries(COVERAGE_TABLE)) {
    all.push({ codigoIBGE, ...entry });
  }
  return all.sort((a, b) => {
    if (a.uf !== b.uf) return a.uf.localeCompare(b.uf);
    return a.cidade.localeCompare(b.cidade);
  });
}
