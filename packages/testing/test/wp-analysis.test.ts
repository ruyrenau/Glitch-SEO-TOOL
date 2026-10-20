import path from 'path';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

// The analysis that runs in the WordPress editor (plain JS, shipped in the plugin).
const require = createRequire(import.meta.url);
const A = require(path.resolve(__dirname, '../../../docs/wordpress/gseo-seo/assets/analysis.js'));
type Check = { id: string; rating: string; text: string };
const byId = (checks: Check[]) => Object.fromEntries(checks.map(c => [c.id, c]));

const p = (s: string) => `<p>${s}</p>`;
const good = [
  '<!-- wp:paragraph -->',
  p('Una <strong>auditoría SEO en Puebla</strong> revisa tu sitio de punta a punta. Además, te dice qué arreglar primero para subir en Google.'),
  '<h2>¿Qué incluye una auditoría SEO en Puebla?</h2>',
  p('Revisamos la velocidad, la indexación y el contenido. Por ejemplo, detectamos páginas lentas y enlaces rotos. Sin embargo, no todo es técnico: también vemos tus textos.'),
  `<img src="/a.jpg" alt="Auditoría SEO en Puebla para negocios locales">`,
  '<h2>¿Cuánto tarda?</h2>',
  p('Normalmente entregamos el reporte en una semana. Luego te acompañamos en los cambios. Por eso muchos clientes ven resultados en pocos meses.'),
  p(`Lee también nuestra <a href="/servicios/">página de servicios</a> y la <a href="https://developers.google.com/search">guía de Google</a>. ${'Cada recomendación viene con su prioridad y su impacto estimado en el tráfico. '.repeat(20)}`)
].join('\n');

describe('Análisis del editor (plugin G.SEO – SEO)', () => {
  it('reconoce una página bien optimizada para su keyword', () => {
    const r = A.analyze({ html: good, title: 'Auditoría SEO en Puebla | Glitch Creativo', description: 'Auditoría SEO en Puebla: revisamos velocidad, indexación y contenido, y te damos un plan claro con prioridades para subir en Google.', slug: 'auditoria-seo-puebla', keyphrase: 'auditoría SEO en Puebla', host: 'glitchcreativo.com' });
    const c = byId(r.seo.checks);
    expect(c.kw_title.rating).toBe('good');
    expect(c.kw_desc.rating).toBe('good');
    expect(c.kw_slug.rating).toBe('good'); // "en" is a stop word; accents ignored
    expect(c.kw_intro.rating).toBe('good');
    expect(c.kw_subheads.rating).toBe('good');
    expect(c.kw_alt.rating).toBe('good');
    expect(c.links_in.rating).toBe('good');
    expect(c.links_out.rating).toBe('good');
    expect(c.length.rating).toBe('good');
    expect(r.seo.rating).toBe('good');
    expect(r.stats.words).toBeGreaterThan(300);
  });

  it('explica qué falta en una página sin trabajar', () => {
    const r = A.analyze({ html: p('Hola, somos una agencia.'), title: 'Inicio', description: '', slug: 'inicio', keyphrase: 'diseño de logotipos en Puebla', host: 'glitchcreativo.com' });
    const c = byId(r.seo.checks);
    expect(c.kw_title.rating).toBe('bad');
    expect(c.kw_desc.text).toMatch(/Escribe una meta descripción/);
    expect(c.kw_density.rating).toBe('bad');
    expect(c.length.rating).toBe('bad');
    expect(c.links_in.rating).toBe('bad');
    expect(r.seo.rating).toBe('bad');
    expect(r.readability.checks[0].text).toMatch(/al menos 50 palabras/);
  });

  it('sin keyword pide escribirla y no da verde', () => {
    const r = A.analyze({ html: good, title: 'x', description: 'y', slug: 'z', keyphrase: '', host: 'a.com' });
    expect(r.seo.checks[0].text).toMatch(/Escribe la keyword principal/);
    expect(r.seo.rating).toBe('bad');
  });

  it('acepta plurales y otro orden de las palabras', () => {
    expect(A.match('Las mejores sillas ergonómicas de oficina', 'silla ergonómica')).toBe('words');
    expect(A.match('Silla ergonómica para tu espalda', 'silla ergonomica')).toBe('exact');
    expect(A.match('Mesas de madera', 'silla ergonómica')).toBeNull();
  });

  it('avisa cuando la keyword ya se usó en otra página y cuando se repite de más', () => {
    const stuffed = p(Array.from({ length: 12 }, () => 'Diseño web Puebla.').join(' '));
    const r = A.analyze({ html: stuffed, title: 'Diseño web Puebla', description: 'Diseño web Puebla', slug: 'diseno-web-puebla', keyphrase: 'diseño web Puebla', host: 'a.com', usedElsewhere: [{ id: 3, title: 'Servicios' }] });
    const c = byId(r.seo.checks);
    expect(c.kw_used.text).toMatch(/Ya la usaste en 1 página \(Servicios\)/);
    expect(c.kw_density.text).toMatch(/Demasiadas/);
  });

  it('mide la legibilidad en español: Fernández-Huerta, oraciones largas, transiciones, pasiva y repeticiones', () => {
    const easy = p('Hacemos sitios web. Son rápidos y claros. Además, son fáciles de usar. Por ejemplo, cargan en un segundo. Sin embargo, no son caros. Por eso nos eligen. También damos soporte. Luego medimos los resultados. Finalmente, te enviamos un reporte. Así sabes qué funciona. '.repeat(3));
    const re = byId(A.analyze({ html: easy, keyphrase: 'sitios web', host: 'a.com' }).readability.checks);
    expect(re.fh.rating).toBe('good');
    expect(re.transitions.rating).toBe('good');
    expect(re.sent_len.rating).toBe('good');

    const hard = p(`${'El sitio fue diseñado por nuestro equipo considerando las particularidades técnicas, comerciales y comunicacionales que caracterizan a las organizaciones contemporáneas latinoamericanas interesadas en la transformación digital integral. '.repeat(4)}El sitio fue diseñado. El sitio fue optimizado. El sitio fue publicado.`);
    const rh = byId(A.analyze({ html: hard, keyphrase: 'sitio', host: 'a.com' }).readability.checks);
    expect(rh.sent_len.rating).toBe('bad');
    expect(rh.passive.rating).toBe('bad');
    expect(rh.starts.text).toMatch(/"el"/);
    expect(rh.fh.rating).toBe('bad');
  });

  it('cuenta sílabas del español con diptongos e hiatos', () => {
    expect(A.syllables('casa')).toBe(2);
    expect(A.syllables('ciudad')).toBe(2); // diptongo "iu"
    expect(A.syllables('poesía')).toBe(4); // hiato "ía" y "oe"
    expect(A.syllables('auditoría')).toBe(5);
  });
});
