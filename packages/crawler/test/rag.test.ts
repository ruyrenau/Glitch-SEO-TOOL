import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, chunkBlocks, markJsOnly } from '../src/rag';

const page = (body: string) => `<html><head><title>Precios</title></head><body><nav><a href="/">Inicio</a></nav><main>${body}</main><footer>© 2026</footer></body></html>`;

describe('htmlToMarkdown', () => {
  it('converts the main content to clean Markdown (no menu or footer)', () => {
    const r = htmlToMarkdown(page(`<h1>Planes</h1><p>Elige el plan <strong>ideal</strong>. Ver <a href="/faq">preguntas</a>.</p>
      <ul><li>Uno</li><li>Dos<ul><li>Dos A</li></ul></li></ul>
      <table><tr><th>Plan</th><th>Precio</th></tr><tr><td>Básico</td><td>$199</td></tr></table>
      <img src="a.png"><img src="b.png" alt="Gráfica"><script>var x=1</script>`), 'https://x.example.com/precios');
    expect(r.title).toBe('Precios');
    expect(r.markdown).toContain('# Planes');
    expect(r.markdown).toContain('Elige el plan **ideal**. Ver [preguntas](https://x.example.com/faq).');
    expect(r.markdown).toContain('- Uno\n- Dos\n  - Dos A');
    expect(r.markdown).toContain('| Plan | Precio |\n| --- | --- |\n| Básico | $199 |');
    expect(r.markdown).not.toContain('Inicio');
    expect(r.markdown).not.toContain('2026');
    expect(r.markdown).not.toContain('var x');
    expect(r.imagesWithoutAlt).toBe(1);
  });
});

describe('chunkBlocks', () => {
  it('starts chunks at headings and keeps the heading path', () => {
    const r = htmlToMarkdown(page(`<h1>Guía</h1><p>${'Intro larga. '.repeat(40)}</p><h2>Precios</h2><p>${'Detalle de precios. '.repeat(30)}</p><h2>Soporte</h2><p>Escríbenos.</p>`), 'https://x.example.com/');
    const ch = chunkBlocks(r.blocks, 256);
    expect(ch[0].headings).toEqual(['Guía']);
    expect(ch.find(c => c.md.startsWith('## Precios'))?.headings).toEqual(['Guía', 'Precios']);
    expect(ch.at(-1)!.flags).toContain('tiny');
  });

  it('flags a table cut in half and a paragraph that is too long', () => {
    const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>Producto ${i}</td><td>$${100 + i}</td></tr>`).join('');
    const r = htmlToMarkdown(page(`<h2>Tabla</h2><table><tr><th>Producto</th><th>Precio</th></tr>${rows}</table><h2>Texto</h2><p>${'Una frase bastante larga para llenar el fragmento. '.repeat(60)}</p>`), 'https://x.example.com/');
    const ch = chunkBlocks(r.blocks, 256);
    expect(ch.filter(c => c.flags.includes('split-table')).length).toBeGreaterThanOrEqual(2);
    expect(ch.some(c => c.flags.includes('split-paragraph'))).toBe(true);
    expect(ch.every(c => c.tokens <= 300)).toBe(true);
  });

  it('marks content that only exists after JavaScript, and key data in it', () => {
    const raw = htmlToMarkdown(page('<h1>Producto</h1><p>Silla ergonómica.</p><div id="app"></div>'), 'https://x.example.com/');
    const rendered = htmlToMarkdown(page('<h1>Producto</h1><p>Silla ergonómica.</p><div id="app"><p>Precio: $2,499 MXN con envío gratis.</p></div>'), 'https://x.example.com/');
    expect(markJsOnly(rendered.blocks, raw.blocks)).toBe(1);
    const ch = chunkBlocks(rendered.blocks, 512);
    expect(ch[0].flags).toEqual(expect.arrayContaining(['js-only', 'key-data-js']));
  });
});
