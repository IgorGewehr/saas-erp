import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildProposalDocument, type ProposalDocumentInput } from '@/lib/pdf/proposalDocument';
import { renderProposalPdf } from '@/lib/pdf/renderProposalPdf';
import { loadLogoDataUrl } from '@/lib/pdf/loadLogo';
import { computeProposalTotals, type ProposalLine } from '@/lib/utils/vitrineProposal';

const ISSUED = new Date(2026, 8, 21, 14, 30);

function makeInput(lines: ProposalLine[], overrides: Partial<ProposalDocumentInput> = {}, installments = 1): ProposalDocumentInput {
  const totals = computeProposalTotals({ lines, promotion: null, negotiatedTotalCents: null, installments, now: ISSUED });
  return {
    kind: 'proposal',
    business: { name: 'Rádio Nova FM', document: 'CNPJ 12.345.678/0001-90', phone: '(11) 3333-4444', email: 'comercial@nova.fm', address: 'Rua das Ondas, 100 - Centro - São Paulo/SP' },
    client: { name: 'Padaria do Zé', company: 'Zé Alimentos', phone: '(11) 98765-4321' },
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    discountReason: totals.discountReason,
    totalCents: totals.totalCents,
    installments,
    schedule: totals.schedule,
    issuedAt: ISSUED,
    validityDays: 7,
    ...overrides,
  };
}

async function pdfText(blob: Blob): Promise<string> {
  return new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
}

const pageCount = (raw: string) => (raw.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

const oneLine: ProposalLine[] = [{ productId: 'p1', name: 'Pacote Spot 30s', unitPriceCents: 150_000, quantity: 2 }];

describe('renderProposalPdf', () => {
  it('gera um PDF válido com timbre, cliente, item, total e pagamento', async () => {
    const blob = await renderProposalPdf(buildProposalDocument(makeInput(oneLine)));
    const raw = await pdfText(blob);

    expect(blob.type).toBe('application/pdf');
    expect(raw.startsWith('%PDF-')).toBe(true);
    for (const expected of ['Rádio Nova FM', 'Proposta comercial', 'Padaria do Z', 'Pacote Spot 30s', 'R$ 3.000,00', 'Condi', 'CLIENTE']) {
      expect(raw).toContain(expected);
    }
    expect(pageCount(raw)).toBe(1);
  });

  it('parcelado: imprime cada parcela', async () => {
    const raw = await pdfText(await renderProposalPdf(buildProposalDocument(makeInput(oneLine, {}, 3))));
    expect(raw).toContain('1/3');
    expect(raw).toContain('3/3');
    expect(raw).toContain('3x a cada 30 dias');
  });

  it('observações entram no documento', async () => {
    const raw = await pdfText(await renderProposalPdf(buildProposalDocument(makeInput(oneLine, { notes: 'Inclui gravacao do spot em estudio.' }))));
    expect(raw).toContain('Inclui gravacao do spot em estudio.');
  });

  it('proposta longa quebra em várias páginas e numera o rodapé', async () => {
    const many: ProposalLine[] = Array.from({ length: 70 }, (_, index) => ({
      productId: `p${index}`, name: `Item de catálogo número ${index + 1}`, unitPriceCents: 10_000 + index, quantity: 1,
    }));
    const raw = await pdfText(await renderProposalPdf(buildProposalDocument(makeInput(many))));

    const pages = pageCount(raw);
    expect(pages).toBeGreaterThan(1);
    expect(raw).toContain(`Página 1 de ${pages}`);
    expect(raw).toContain(`Página ${pages} de ${pages}`);
  });

  it('emoji e aspas tipográficas no nome não quebram a geração', async () => {
    const lines: ProposalLine[] = [{ productId: 'p1', name: '🎙️ Spot “premium” — 30s', unitPriceCents: 100_000, quantity: 1 }];
    const raw = await pdfText(await renderProposalPdf(buildProposalDocument(makeInput(lines))));
    expect(raw).toContain('premium');
    expect(raw.startsWith('%PDF-')).toBe(true);
  });

  it('logo inválido é ignorado (PDF sai sem ele)', async () => {
    const blob = await renderProposalPdf(buildProposalDocument(makeInput(oneLine)), { logoDataUrl: 'data:image/png;base64,naoeumapng' });
    expect((await pdfText(blob)).startsWith('%PDF-')).toBe(true);
  });

  it('negócio fechado usa o título e o número do pedido', async () => {
    const totals = computeProposalTotals({ lines: oneLine, promotion: null, negotiatedTotalCents: null, installments: 2, now: ISSUED });
    const raw = await pdfText(await renderProposalPdf(buildProposalDocument(makeInput(oneLine, {
      kind: 'deal', orderNumber: 'ABC123', schedule: totals.schedule, validityDays: undefined,
    }, 2))));
    expect(raw).toContain('Confirma');
    expect(raw).toContain('#ABC123');
    expect(raw).toContain('21/10/2026');
  });
});

describe('loadLogoDataUrl — falhas devolvem null (o PDF sai sem logo)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sem URL', async () => {
    expect(await loadLogoDataUrl(undefined)).toBeNull();
    expect(await loadLogoDataUrl('')).toBeNull();
  });

  it('rede/CORS falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await loadLogoDataUrl('https://storage.exemplo.com/logo.png')).toBeNull();
  });

  it('resposta não-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob() })));
    expect(await loadLogoDataUrl('https://storage.exemplo.com/logo.png')).toBeNull();
  });

  it('conteúdo que não é imagem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['<html>'], { type: 'text/html' }) })));
    expect(await loadLogoDataUrl('https://storage.exemplo.com/logo.png')).toBeNull();
  });

  it('imagem que o ambiente não decodifica (jsdom): null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob([new Uint8Array(10)], { type: 'image/png' }) })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }));
    expect(await loadLogoDataUrl('https://storage.exemplo.com/logo.png')).toBeNull();
  });

  it('respeita o tempo limite', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    expect(await loadLogoDataUrl('https://storage.exemplo.com/logo.png', { timeoutMs: 20 })).toBeNull();
  });
});
