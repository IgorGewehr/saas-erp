'use client';

/**
 * lib/services/printing/webusbPrinter.ts
 *
 * Transporte WebUSB para impressão térmica DIRETA (silenciosa) — Chrome/Edge.
 * Detecta a impressora na porta USB (`requestDevice`), persiste a escolha como
 * PADRÃO da ESTAÇÃO (localStorage por businessId — a concessão WebUSB é por
 * navegador/máquina, então o padrão é inerentemente local, não do Firestore) e
 * envia bytes ESC/POS via `transferOut`.
 *
 * Sem SDK. Os tipos do WebUSB não estão no lib.dom padrão — declaramos o
 * subconjunto que usamos (sem `any`) e acessamos `navigator.usb` por cast.
 *
 * Nota Windows: se a impressora estiver instalada com driver do fabricante, o SO
 * pode "reivindicar" o dispositivo e o open()/claimInterface() falha — nesse caso
 * usa-se WinUSB (Zadig) OU cai-se no fallback de diálogo do navegador. Erros são
 * lançados com mensagem clara para o orquestrador decidir o fallback.
 */

import type { PaperWidth } from './comandaEscpos';

// ── Tipos mínimos do WebUSB (subconjunto usado) ───────────────────────────────
interface UsbEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: string }
interface UsbAlternate { endpoints: UsbEndpoint[]; interfaceClass: number }
interface UsbInterface { interfaceNumber: number; alternate: UsbAlternate; claimed: boolean }
interface UsbConfiguration { configurationValue: number; interfaces: UsbInterface[] }
interface UsbOutResult { status: string; bytesWritten: number }
interface WebUsbDevice {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(endpoint: number, data: Uint8Array): Promise<UsbOutResult>;
}
interface WebUsb {
  requestDevice(opts: { filters: Array<Record<string, number>> }): Promise<WebUsbDevice>;
  getDevices(): Promise<WebUsbDevice[]>;
}

function getUsb(): WebUsb | null {
  if (typeof navigator === 'undefined') return null;
  const usb = (navigator as unknown as { usb?: WebUsb }).usb;
  return usb ?? null;
}

export function isWebUsbSupported(): boolean {
  return getUsb() !== null;
}

// ── Config persistida (por estação) ───────────────────────────────────────────
export interface PrinterConfig {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  label: string;
  paperWidth: PaperWidth;
}

function storageKey(businessId: string): string {
  return `sp:printer:${businessId}`;
}

export function getPrinterConfig(businessId: string): PrinterConfig | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(businessId));
    if (!raw) return null;
    const c = JSON.parse(raw) as PrinterConfig;
    if (typeof c.vendorId !== 'number' || typeof c.productId !== 'number') return null;
    if (c.paperWidth !== 58 && c.paperWidth !== 80) c.paperWidth = 80;
    return c;
  } catch {
    return null;
  }
}

export function savePrinterConfig(businessId: string, cfg: PrinterConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(storageKey(businessId), JSON.stringify(cfg));
}

export function clearPrinterConfig(businessId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(storageKey(businessId));
}

export function setPaperWidth(businessId: string, paperWidth: PaperWidth): void {
  const cfg = getPrinterConfig(businessId);
  if (cfg) savePrinterConfig(businessId, { ...cfg, paperWidth });
}

// ── Detecção / seleção ────────────────────────────────────────────────────────
/**
 * Abre o seletor USB do navegador (gesto do usuário obrigatório), persiste o
 * dispositivo escolhido como padrão da estação e devolve a config. `filters: [{}]`
 * lista todos os dispositivos — impressoras compostas (bDeviceClass 0) não seriam
 * mostradas por um filtro classCode=7, então preferimos amplo + escolha manual.
 */
export async function requestPrinter(
  businessId: string,
  paperWidth: PaperWidth,
): Promise<PrinterConfig> {
  const usb = getUsb();
  if (!usb) throw new Error('WebUSB não suportado neste navegador.');
  const device = await usb.requestDevice({ filters: [{}] });
  const label = device.productName
    || `USB ${device.vendorId.toString(16).padStart(4, '0')}:${device.productId.toString(16).padStart(4, '0')}`;
  const cfg: PrinterConfig = {
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber,
    label,
    paperWidth,
  };
  savePrinterConfig(businessId, cfg);
  return cfg;
}

/**
 * Reencontra o dispositivo já autorizado (getDevices — não pede permissão de
 * novo) que casa com a config. Null se a concessão foi revogada / dispositivo
 * ausente. Casa por vendor+product (+ serial quando houver, pra desempatar
 * duas impressoras idênticas).
 */
async function findGrantedDevice(cfg: PrinterConfig): Promise<WebUsbDevice | null> {
  const usb = getUsb();
  if (!usb) return null;
  const devices = await usb.getDevices();
  const matches = devices.filter((d) => d.vendorId === cfg.vendorId && d.productId === cfg.productId);
  if (cfg.serialNumber) {
    return matches.find((d) => d.serialNumber === cfg.serialNumber) ?? matches[0] ?? null;
  }
  // Sem serial e ≥2 impressoras idênticas: não há como desambiguar — usa a 1ª e
  // avisa (o operador pode estar imprimindo na impressora errada).
  if (matches.length > 1) {
    console.warn('[print] múltiplas impressoras idênticas sem número de série — usando a primeira; pode não desambiguar.');
  }
  return matches[0] ?? null;
}

/**
 * Escolhe o endpoint de saída, PRIORIZANDO a interface de impressora (classe USB
 * 7) e endpoint BULK — impressoras compostas (leitor integrado, CDC/vendor com
 * interrupt-out) têm mais de um OUT e pegar o primeiro qualquer imprimiria na
 * interface errada. Ordem: printer+bulk > bulk > printer > qualquer OUT.
 */
function findOutEndpoint(device: WebUsbDevice): { interfaceNumber: number; endpoint: number } | null {
  const config = device.configuration ?? device.configurations[0];
  if (!config) return null;
  const candidates: Array<{ interfaceNumber: number; endpoint: number; isPrinter: boolean; isBulk: boolean }> = [];
  for (const intf of config.interfaces) {
    const isPrinter = intf.alternate.interfaceClass === 7;
    for (const ep of intf.alternate.endpoints) {
      if (ep.direction === 'out') {
        candidates.push({
          interfaceNumber: intf.interfaceNumber,
          endpoint: ep.endpointNumber,
          isPrinter,
          isBulk: ep.type === 'bulk',
        });
      }
    }
  }
  if (!candidates.length) return null;
  const pick =
    candidates.find((c) => c.isPrinter && c.isBulk) ??
    candidates.find((c) => c.isBulk) ??
    candidates.find((c) => c.isPrinter) ??
    candidates[0];
  return { interfaceNumber: pick.interfaceNumber, endpoint: pick.endpoint };
}

/** Serializa envios USB — evita que auto-print + botão manual colidam no claim
 *  do MESMO dispositivo (a 2ª claimInterface lançaria). Prints são raros; uma
 *  fila global simples basta. */
let sendQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendQueue.then(fn, fn);
  sendQueue = run.then(() => undefined, () => undefined);
  return run;
}

/** Tamanho do bloco do bulk OUT — impressoras clone têm buffer pequeno; enviar
 *  a comanda inteira num burst pode transbordar e DESCARTAR bytes (comanda
 *  truncada na cozinha). Fatiamos e aguardamos cada bloco. */
const CHUNK_SIZE = 4096;

/**
 * Envia bytes ao dispositivo já autorizado. Abre, seleciona config, reivindica a
 * interface, `transferOut`, libera e fecha. Lança com mensagem clara em qualquer
 * falha (dispositivo reivindicado pelo SO, sem endpoint OUT, etc.) para o
 * orquestrador cair no fallback.
 */
async function sendToDevice(device: WebUsbDevice, data: Uint8Array): Promise<void> {
  // Só fecha o que ESTA chamada abriu — não derruba um handle que outra
  // impressão (ou o próprio SO) mantinha aberto.
  const openedByUs = !device.opened;
  if (openedByUs) await device.open();
  let claimed: number | null = null;
  try {
    if (!device.configuration) await device.selectConfiguration(1);
    const target = findOutEndpoint(device);
    if (!target) throw new Error('Impressora sem endpoint de saída (OUT) reconhecível.');
    await device.claimInterface(target.interfaceNumber);
    claimed = target.interfaceNumber;
    // Envia em blocos, aguardando cada um (flow-control p/ buffers pequenos).
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
      const res = await device.transferOut(target.endpoint, chunk);
      if (res.status !== 'ok') throw new Error(`Falha na transferência USB (status: ${res.status}).`);
    }
  } finally {
    if (claimed !== null) await device.releaseInterface(claimed).catch(() => {});
    if (openedByUs) await device.close().catch(() => {});
  }
}

/**
 * Imprime bytes na impressora PADRÃO da estação (config persistida). Retorna
 * `true` se enviou; lança se a config existe mas o envio falhou; retorna `false`
 * se NÃO há dispositivo autorizado disponível (caller deve cair no fallback).
 */
export async function printBytesToDefault(businessId: string, data: Uint8Array): Promise<boolean> {
  const cfg = getPrinterConfig(businessId);
  if (!cfg) return false;
  const device = await findGrantedDevice(cfg);
  if (!device) return false; // concessão perdida → fallback
  await serialize(() => sendToDevice(device, data));
  return true;
}

/** Envia bytes a um dispositivo recém-selecionado (teste de impressão). */
export async function printBytesToDevice(cfg: PrinterConfig, data: Uint8Array): Promise<boolean> {
  const device = await findGrantedDevice(cfg);
  if (!device) return false;
  await serialize(() => sendToDevice(device, data));
  return true;
}
