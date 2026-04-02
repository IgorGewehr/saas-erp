import { adminDb } from '@/lib/config/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Atomically get and increment the next invoice number for NFe or NFCe.
 * Uses Firestore transaction to prevent race conditions.
 */
export async function getNextInvoiceNumber(
  businessId: string,
  type: 'nfe' | 'nfce'
): Promise<{ number: number; series: string }> {
  const configField = type === 'nfe' ? 'fiscal.nfeConfig' : 'fiscal.nfceConfig';
  const numberField = `${configField}.nextNumber`;
  const seriesField = `${configField}.series`;

  return adminDb.runTransaction(async (transaction) => {
    const docRef = adminDb.collection('businesses').doc(businessId);
    const doc = await transaction.get(docRef);

    if (!doc.exists) throw new Error('Business not found');

    const data = doc.data();
    const config = type === 'nfe' ? data?.fiscal?.nfeConfig : data?.fiscal?.nfceConfig;

    const currentNumber = config?.nextNumber || 1;
    const series = config?.series || '1';

    // Increment atomically
    transaction.update(docRef, { [numberField]: currentNumber + 1 });

    return { number: currentNumber, series };
  });
}

/**
 * Maps TaxRegime to CRT (Código de Regime Tributário) for SEFAZ
 */
export function getCRT(taxRegime?: string): '1' | '2' | '3' {
  switch (taxRegime) {
    case 'simples_nacional': return '1';
    case 'simples_nacional_excesso': return '2';
    case 'lucro_presumido':
    case 'lucro_real':
      return '3';
    default: return '1'; // default Simples Nacional
  }
}

/**
 * Maps payment method string to SEFAZ code
 */
export function getPaymentCode(method: string): string {
  const map: Record<string, string> = {
    'dinheiro': '01', 'cash': '01',
    'cheque': '02',
    'credito': '03', 'credit_card': '03', 'credit': '03',
    'debito': '04', 'debit_card': '04', 'debit': '04',
    'credito_loja': '05',
    'vale_alimentacao': '10',
    'vale_refeicao': '11',
    'vale_presente': '12',
    'vale_combustivel': '13',
    'boleto': '15',
    'deposito': '16',
    'pix': '17',
    'transferencia': '18',
    'fidelidade': '19',
    'sem_pagamento': '90',
    'outros': '99', 'other': '99',
  };
  return map[method.toLowerCase()] || '99';
}

/**
 * Get ICMS defaults based on CRT
 */
export function getICMSDefaults(crt: '1' | '2' | '3') {
  if (crt === '3') {
    // Regime Normal: CST + alíquota
    return { cst: '00', aliquota: 18, origem: 0 };
  }
  // Simples Nacional: CSOSN
  return { csosn: '400', origem: 0 };
}

/**
 * Get PIS/COFINS defaults based on CRT and tax regime
 */
export function getPISCOFINSDefaults(crt: '1' | '2' | '3', taxRegime?: string) {
  if (crt === '3') {
    if (taxRegime === 'lucro_real') {
      // Não-cumulativo
      return { pisCST: '01', pisAliquota: 1.65, cofinsCST: '01', cofinsAliquota: 7.6 };
    }
    // Cumulativo (Lucro Presumido)
    return { pisCST: '01', pisAliquota: 0.65, cofinsCST: '01', cofinsAliquota: 3.0 };
  }
  // Simples Nacional: isento
  return { pisCST: '07', pisAliquota: 0, cofinsCST: '07', cofinsAliquota: 0 };
}
