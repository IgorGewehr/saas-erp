/**
 * Testes do parser WhatsApp em lib/utils/whatsapp-format.tsx.
 *
 * Usa renderToStaticMarkup pra inspecionar o HTML gerado sem precisar de
 * DOM real — basta validar estrutura textual.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { formatWhatsAppText } from '@/lib/utils/whatsapp-format';

function render(text: string): string {
  return renderToStaticMarkup(<>{formatWhatsAppText(text)}</>);
}

describe('formatWhatsAppText — autolink', () => {
  it('transforma https URL em <a>', () => {
    const html = render('Veja https://bjjeasy.netlify.app aqui');
    expect(html).toContain('<a');
    expect(html).toContain('href="https://bjjeasy.netlify.app"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('transforma http URL em <a>', () => {
    const html = render('http://example.com');
    expect(html).toContain('href="http://example.com"');
  });

  it('transforma www. em <a> com https://', () => {
    const html = render('www.example.com');
    expect(html).toContain('href="https://www.example.com"');
  });

  it('preserva múltiplas URLs', () => {
    const html = render('https://a.com e https://b.com');
    expect((html.match(/<a /g) || []).length).toBe(2);
  });

  it('não pega pontuação final como parte da URL', () => {
    const html = render('Acesse https://example.com.');
    expect(html).toContain('href="https://example.com"');
    // O ponto fica fora do <a>, no texto após o fechamento.
    expect(html).toMatch(/<\/a>\.$/);
  });
});

describe('formatWhatsAppText — markdown WhatsApp', () => {
  it('negrito com *texto*', () => {
    const html = render('Olá *mundo* aqui');
    expect(html).toContain('<strong');
    expect(html).toContain('>mundo</strong>');
  });

  it('itálico com _texto_', () => {
    const html = render('Isso é _importante_ sim');
    expect(html).toContain('<em>importante</em>');
  });

  it('strike com ~texto~', () => {
    const html = render('era ~caro~ barato');
    expect(html).toContain('<s>caro</s>');
  });

  it('inline code com `texto`', () => {
    const html = render('use `npm install` agora');
    expect(html).toContain('<code');
    expect(html).toContain('>npm install</code>');
  });

  it('code block com triple backtick atravessa linhas', () => {
    const html = render('```\nlinha 1\nlinha 2\n```');
    expect(html).toContain('linha 1');
    expect(html).toContain('linha 2');
    expect(html).toContain('<code');
  });

  it('não formata marker com espaço logo após abertura', () => {
    const html = render('* não é bold *');
    expect(html).not.toContain('<strong');
  });

  it('não formata marker sem fechamento', () => {
    const html = render('*sem fim aqui');
    expect(html).not.toContain('<strong');
  });

  it('não atravessa quebra de linha em marker inline', () => {
    const html = render('*linha1\nlinha2*');
    expect(html).not.toContain('<strong');
  });
});

describe('formatWhatsAppText — segurança', () => {
  it('não interpreta HTML cru (<script>)', () => {
    const html = render('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('não interpreta HTML em conteúdo formatado', () => {
    const html = render('*<img onerror=x>*');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('aspas em URL não viram atributos HTML executáveis', () => {
    const html = render('https://example.com/"onclick=alert(1)');
    // Parser para no " (URL_REGEX exclui aspas); o resto vira texto puro
    // escapado pelo React — "onclick" aparece como texto, NÃO como atributo.
    // Verifica que não há atributo onclick na tag <a>.
    expect(html).not.toMatch(/<a[^>]*onclick/);
    expect(html).toContain('&quot;onclick=alert(1)');
  });
});

describe('formatWhatsAppText — entrada degenerada', () => {
  it('string vazia retorna null', () => {
    const result = formatWhatsAppText('');
    expect(result).toBeNull();
  });

  it('texto puro sem formatação retorna como nodes', () => {
    const html = render('texto comum sem formatação');
    expect(html).toBe('texto comum sem formatação');
  });

  it('só markers sem conteúdo válido renderiza literal', () => {
    const html = render('** _ _ ~ ~');
    expect(html).not.toContain('<strong');
    expect(html).not.toContain('<em');
    expect(html).not.toContain('<s>');
  });
});

describe('formatWhatsAppText — caso real do payload', () => {
  it('renderiza mensagem com lista de links (caso reportado)', () => {
    const msg = `Caso tenha interesse em conferir na sua loja de aplicativos ou na web o nosso aplicativo, vou enviar logo abaixo os links 👇

Web:
https://bjjeasy.netlify.app

Play Store:
https://play.google.com/store/apps/details?id=com.tensorroot.graduabjj

Apple Store:
https://apps.apple.com/br/app/bjjeasy/id6760324964

Ficamos a disposição para responder quaisquer dúvidas. Oss!`;
    const html = render(msg);
    // Três URLs viraram <a>.
    expect((html.match(/<a /g) || []).length).toBe(3);
    expect(html).toContain('bjjeasy.netlify.app');
    expect(html).toContain('play.google.com');
    expect(html).toContain('apps.apple.com');
    // Texto preservado.
    expect(html).toContain('Oss!');
    expect(html).toContain('Web:');
  });
});
