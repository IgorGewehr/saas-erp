import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import PwaRegister from '@/app/components/providers/PwaRegister';
import {
  getCanInstall,
  isStandaloneDisplay,
  promptInstall,
  resetInstallPromptForTests,
  startInstallPromptCapture,
  subscribeInstallPrompt,
} from '@/lib/pwa/installPrompt';

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('convite de instalação (beforeinstallprompt)', () => {
  beforeEach(() => resetInstallPromptForTests());

  it('antes do evento não dá pra instalar', () => {
    startInstallPromptCapture();
    expect(getCanInstall()).toBe(false);
  });

  it('captura o evento, segura o mini-banner do navegador e avisa quem assina', () => {
    startInstallPromptCapture();
    const listener = vi.fn();
    subscribeInstallPrompt(listener);

    const event = installEvent();
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getCanInstall()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('o evento chega ANTES de alguém abrir a Vitrine e continua disponível depois', () => {
    startInstallPromptCapture();
    window.dispatchEvent(installEvent());
    // (a tela só assina depois)
    expect(getCanInstall()).toBe(true);
  });

  it('instalar: dispara o prompt nativo, devolve a escolha e consome o evento (só vale uma vez)', async () => {
    startInstallPromptCapture();
    const event = installEvent('accepted');
    window.dispatchEvent(event);

    expect(await promptInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(getCanInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
  });

  it('recusar também consome o convite', async () => {
    startInstallPromptCapture();
    window.dispatchEvent(installEvent('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
    expect(getCanInstall()).toBe(false);
  });

  it('sem evento (iPad/Safari): instalar devolve "unavailable" sem quebrar', async () => {
    startInstallPromptCapture();
    expect(await promptInstall()).toBe('unavailable');
  });

  it('depois de instalado (appinstalled) o botão some', () => {
    startInstallPromptCapture();
    window.dispatchEvent(installEvent());
    expect(getCanInstall()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));
    expect(getCanInstall()).toBe(false);
  });

  it('capturar duas vezes não duplica os ouvintes', () => {
    startInstallPromptCapture();
    startInstallPromptCapture();
    const listener = vi.fn();
    subscribeInstallPrompt(listener);
    window.dispatchEvent(installEvent());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cancelar a assinatura para de avisar', () => {
    startInstallPromptCapture();
    const listener = vi.fn();
    const unsubscribe = subscribeInstallPrompt(listener);
    unsubscribe();
    window.dispatchEvent(installEvent());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('isStandaloneDisplay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('display-mode standalone (Android/desktop)', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('standalone') }));
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('navigator.standalone (iOS)', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('navigator', { standalone: true });
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('no navegador comum não é standalone', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    vi.stubGlobal('navigator', {});
    expect(isStandaloneDisplay()).toBe(false);
  });
});

describe('PwaRegister — registro do service worker', () => {
  const register = vi.fn(async () => ({}));

  beforeEach(() => {
    resetInstallPromptForTests();
    register.mockClear();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  function mount() {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(<PwaRegister />));
    return () => act(() => root.unmount());
  }

  it('em produção registra /sw.js na raiz, sem usar o cache HTTP pra checar atualização', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const unmount = mount();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    unmount();
  });

  it('fora de produção NÃO registra (o service worker atrapalharia o hot reload)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const unmount = mount();
    expect(register).not.toHaveBeenCalled();
    unmount();
  });

  it('navegador sem service worker (ou http sem TLS): não quebra', () => {
    vi.stubEnv('NODE_ENV', 'production');
    Reflect.deleteProperty(navigator, 'serviceWorker');
    expect(() => mount()()).not.toThrow();
  });

  it('registro recusado não derruba o app', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    register.mockRejectedValueOnce(new DOMException('SecurityError'));
    const unmount = mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    unmount();
  });

  it('também começa a capturar o convite de instalação', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const unmount = mount();
    window.dispatchEvent(installEvent());
    expect(getCanInstall()).toBe(true);
    unmount();
  });
});
