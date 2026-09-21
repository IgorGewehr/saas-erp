/**
 * lib/pwa/installPrompt.ts
 *
 * Guarda o evento `beforeinstallprompt` (Chrome/Edge/Android). Ele dispara UMA vez, logo no
 * carregamento da página — bem antes de alguém abrir a Vitrine —, então a captura é global (montada
 * no layout) e a tela só lê o estado. No Safari/iPad o evento não existe: a instalação é manual
 * (Compartilhar → Adicionar à Tela de Início) e `canInstall` fica sempre falso.
 */

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let capturing = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** App já aberto como instalado (Android/desktop: display-mode; iOS: navigator.standalone). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as { standalone?: boolean }).standalone === true;
}

// Funções estáveis: `addEventListener` com a mesma referência é idempotente, e o reset de teste
// consegue removê-las (senão os ouvintes de um teste vazam pro seguinte).
function handleBeforeInstallPrompt(event: Event): void {
  // Sem isso o navegador mostra o mini-banner dele; aqui o botão é da Vitrine.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  emit();
}

function handleAppInstalled(): void {
  installed = true;
  deferred = null;
  emit();
}

export function startInstallPromptCapture(): void {
  if (capturing || typeof window === 'undefined') return;
  capturing = true;
  installed = isStandaloneDisplay();
  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCanInstall(): boolean {
  return deferred !== null && !installed;
}

export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event || installed) return 'unavailable';
  // O evento só pode ser usado uma vez.
  deferred = null;
  emit();
  await event.prompt();
  const choice = await event.userChoice;
  return choice.outcome;
}

/** Só pra teste: volta ao estado inicial. */
export function resetInstallPromptForTests(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.removeEventListener('appinstalled', handleAppInstalled);
  }
  deferred = null;
  installed = false;
  capturing = false;
  listeners.clear();
}
