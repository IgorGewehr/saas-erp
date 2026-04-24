/**
 * Thin wrapper around OpenAI's text-embedding API.
 *
 * Default model: text-embedding-3-small (1536 dims, $0.02/1M tokens, very fast).
 * Upgrade to text-embedding-3-large (3072 dims) for higher recall at 4× cost
 * by setting OPENAI_EMBED_MODEL.
 *
 * Returns Float32 arrays (canonical vector representation for cosine similarity).
 */

const OPENAI_API_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

export interface EmbedOptions {
  model?: string;
  /** Strip newlines — the API is ~10% faster on single-line inputs. */
  normalize?: boolean;
}

export async function embedText(
  text: string,
  opts: EmbedOptions = {},
): Promise<Float32Array> {
  const [vec] = await embedBatch([text], opts);
  return vec;
}

export async function embedBatch(
  texts: string[],
  opts: EmbedOptions = {},
): Promise<Float32Array[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');
  if (texts.length === 0) return [];

  const model = opts.model || DEFAULT_MODEL;
  const inputs = texts.map((t) => (opts.normalize === false ? t : t.replace(/\s+/g, ' ').trim())).filter((t) => t.length > 0);
  if (inputs.length === 0) return [];

  const resp = await fetch(`${OPENAI_API_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: inputs }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI embeddings ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { data: Array<{ embedding: number[]; index: number }> };
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => new Float32Array(d.embedding));
}

/** Cosine similarity between two equal-length vectors. Returns -1..1. */
export function cosineSim(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Serialize a vector to array-of-numbers for Firestore storage. */
export function vectorToArray(v: Float32Array): number[] {
  return Array.from(v);
}

export function arrayToVector(a: number[]): Float32Array {
  return new Float32Array(a);
}
