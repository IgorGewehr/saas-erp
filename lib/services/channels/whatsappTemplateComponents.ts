/**
 * Builder de `components` pra WhatsApp Cloud API templates.
 *
 * Monta o array que vai em `template.components` no POST /messages,
 * lidando com header de mídia (IMAGE/VIDEO/DOCUMENT) + body com
 * variáveis resolvidas.
 *
 * Usado por:
 *  - app/api/conversations/send/route.ts  (1:1 e agente)
 *  - app/api/broadcasts/send/route.ts     (per-recipient em campanhas)
 *
 * Por que centralizar: as duas rotas precisam emitir EXATAMENTE o mesmo
 * shape pra Meta. Antes desta extração cada uma tinha sua lógica e a de
 * broadcast só sabia montar body, perdendo o header em qualquer template
 * IMAGE/VIDEO/DOCUMENT — o vídeo carregado virava `mediaId` órfão.
 *
 * Refs:
 *  - https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/
 *  - https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages/
 */

export interface HeaderMediaPayload {
  /** mediaId obtido via POST /{phoneNumberId}/media — endpoint
   *  /api/channels/whatsapp-media/upload. */
  mediaId: string;
  /** MIME normalizado (ex: 'video/mp4', 'image/jpeg', 'application/pdf').
   *  Usado pra decidir entre image/video/document na parametrização Meta. */
  mimeType: string;
  /** Nome original — Meta exibe em templates com header DOCUMENT.
   *  Ignorado para IMAGE/VIDEO. */
  fileName?: string;
}

export type MetaTemplateParameter =
  | { type: 'text'; text: string }
  | { type: 'image'; image: { id: string } | { link: string } }
  | { type: 'video'; video: { id: string } | { link: string } }
  | {
      type: 'document';
      document: ({ id: string } | { link: string }) & { filename?: string };
    };

export type MetaTemplateComponent =
  | { type: 'header'; parameters: MetaTemplateParameter[] }
  | { type: 'body'; parameters: MetaTemplateParameter[] };

interface BuildComponentsOpts {
  /** Quando presente E tem mediaId, prepende um componente 'header' com o
   *  parâmetro de mídia. Templates com format TEXT/LOCATION não usam isso —
   *  passar null/undefined nesse caso. */
  headerMedia?: HeaderMediaPayload | null;
  /** Valores já resolvidos para {{1}}, {{2}}, ... — ordem é índice 0-based.
   *  Vazio = template sem variáveis (não emite componente body). */
  bodyParams: string[];
}

/**
 * Monta o `components` array no shape exigido pela Meta Cloud API.
 *
 * Casos cobertos:
 *  - Template sem header e sem variáveis           → []
 *  - Template com só body                           → [{type:'body', parameters:[...]}]
 *  - Template com header de mídia e sem variáveis  → [{type:'header', parameters:[mediaParam]}]
 *  - Template com header de mídia + body            → [header, body]
 *
 * NÃO cobre (futuro):
 *  - Header TEXT com variáveis (raro)
 *  - Buttons dinâmicos (URL/QUICK_REPLY)
 *  - Carousel cards
 */
export function buildTemplateComponents(opts: BuildComponentsOpts): MetaTemplateComponent[] {
  const components: MetaTemplateComponent[] = [];

  if (opts.headerMedia?.mediaId) {
    components.push({
      type: 'header',
      parameters: [headerMediaToParameter(opts.headerMedia)],
    });
  }

  if (opts.bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: opts.bodyParams.map((text) => ({ type: 'text', text })),
    });
  }

  return components;
}

function headerMediaToParameter(media: HeaderMediaPayload): MetaTemplateParameter {
  const mime = media.mimeType.toLowerCase();
  if (mime.startsWith('image/')) {
    return { type: 'image', image: { id: media.mediaId } };
  }
  if (mime.startsWith('video/')) {
    return { type: 'video', video: { id: media.mediaId } };
  }
  // Tudo o que não é image/video é tratado como document (PDF, Office, txt).
  // Meta exibe o nome do arquivo se fornecido — sem isso, mostra "Documento"
  // genérico no card. Incluir filename quando disponível melhora UX.
  return {
    type: 'document',
    document: {
      id: media.mediaId,
      ...(media.fileName ? { filename: media.fileName } : {}),
    },
  };
}
