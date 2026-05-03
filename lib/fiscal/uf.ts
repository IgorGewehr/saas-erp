/**
 * Mapping IBGE cUF (2 dígitos) → UF (sigla).
 * Os 2 primeiros dígitos da chave de acesso de NFe/NFCe são o cUF.
 * O sefaz-api espera a sigla (SP/RJ/...) nos endpoints; nunca o cUF numérico.
 */
export const CUF_TO_UF: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP',
  '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB',
  '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES',
  '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS',
  '51': 'MT', '52': 'GO', '53': 'DF',
};

/**
 * Resolve a UF do emitente em ordem de prioridade:
 * 1. UF passada explicitamente no body (string já normalizada)
 * 2. UF do endereço do business (mais confiável)
 * 3. Mapping cUF → UF a partir da chave de acesso
 * 4. Os próprios 2 primeiros dígitos da chave (último recurso, vai falhar
 *    no sefaz-api mas pelo menos a mensagem de erro indica o cUF)
 */
export function resolveUfEmitente(opts: {
  ufFromBody?: string;
  ufFromBusiness?: string;
  chaveAcesso?: string;
}): string {
  if (opts.ufFromBody) return opts.ufFromBody.toUpperCase();
  if (opts.ufFromBusiness) return opts.ufFromBusiness.toUpperCase();
  if (opts.chaveAcesso) {
    const cUF = opts.chaveAcesso.substring(0, 2);
    return CUF_TO_UF[cUF] || cUF;
  }
  return '';
}
