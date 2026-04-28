/**
 * OCR document extraction — STUB (3.7)
 *
 * Ready to implement once Google Cloud Vision API is configured.
 *
 * When active, this route will:
 *  POST /api/financial/ocr
 *  Body: multipart/form-data with { businessId, file (PDF/image) }
 *  Response: { amount, date, description, cnpj, vendor, confidence }
 *
 * Provider integration steps:
 *  1. Create Google Cloud project at console.cloud.google.com
 *  2. Enable "Cloud Vision API"
 *  3. Create Service Account → download JSON key
 *  4. Add GOOGLE_VISION_API_KEY to environment variables
 *  5. Replace stub body with actual Vision API call (annotate image with DOCUMENT_TEXT_DETECTION)
 *  6. Parse response: extract amount (R$ pattern), date, CNPJ (##.###.###/####-##), vendor name
 *
 * Alternative: AWS Textract (better for tables/forms), Azure Document Intelligence (NF-e PDFs)
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // TODO: check GOOGLE_VISION_API_KEY env var
  // TODO: parse multipart form data to get image/PDF file
  // TODO: call Vision API with DOCUMENT_TEXT_DETECTION
  // TODO: extract: amount, date, vendor, CNPJ, description
  // TODO: return structured data for pre-filling transaction form

  return NextResponse.json(
    {
      ok: false,
      error: 'OCR não configurado. Configure a Google Cloud Vision API nas integrações.',
      code: 'OCR_NOT_CONFIGURED',
      setupRequired: true,
      requiredEnvVars: ['GOOGLE_VISION_API_KEY'],
      estimatedCost: 'R$ 0,008 por imagem',
    },
    { status: 501 },
  );
}
