import { describe, it, expect } from 'vitest';
import { internalPageRank, tfidf, terms, cosine, anchorCandidates, findPhrase, injectLink, matchRedirect } from '../src/link-graph';

describe('internalPageRank', () => {
  it('gives the most linked page the highest score and orphans the lowest', () => {
    const r = internalPageRank(['/', '/a', '/b', '/huerfana'], [['/', '/a'], ['/', '/b'], ['/a', '/'], ['/b', '/'], ['/a', '/b']]);
    expect(r.get('/')!.score).toBe(100);
    expect(r.get('/huerfana')!.inlinks).toBe(0);
    expect(r.get('/huerfana')!.score).toBeLessThan(r.get('/a')!.score);
  });
});

describe('text similarity', () => {
  it('ranks pages of the same topic closer', () => {
    const [a, b, c] = tfidf([terms('Sillas ergonómicas de oficina con soporte lumbar'), terms('Cómo elegir una silla ergonómica para la oficina'), terms('Recetas de cocina mexicana fáciles')]);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});

describe('anchors', () => {
  it('builds anchor candidates and finds them without caring about accents or case', () => {
    const c = anchorCandidates({ title: 'Sillas ergonómicas | Tienda', h1: 'Sillas ergonómicas', queries: ['silla ergonomica oficina'] });
    expect(c).toEqual(['silla ergonomica oficina', 'Sillas ergonómicas']);
    const hit = findPhrase(['Para trabajar horas te recomendamos unas SILLAS ERGONOMICAS buenas.'], c);
    expect(hit).toMatchObject({ phrase: 'Sillas ergonómicas', found: 'SILLAS ERGONOMICAS' });
    expect(hit!.context).toContain('[[SILLAS ERGONOMICAS]]');
  });
});

describe('injectLink', () => {
  const html = '<!-- wp:heading --><h2>Sillas ergonómicas</h2><!-- /wp:heading -->\n<!-- wp:paragraph --><p>Ver <a href="/x">sillas ergonómicas</a> y [gallery ids="1"] y también sillas ergonómicas baratas.</p><!-- /wp:paragraph -->';
  it('links the first plain-text occurrence only, leaving everything else byte for byte', () => {
    const out = injectLink(html, 'sillas ergonómicas', 'https://t.example.com/sillas')!;
    expect(out).toBe(html.replace('también sillas ergonómicas baratas', 'también <a href="https://t.example.com/sillas">sillas ergonómicas</a> baratas'));
  });
  it('returns null when the phrase only appears in headings or links', () => {
    expect(injectLink('<h2>Sillas</h2><p><a href="/a">Sillas</a></p>', 'sillas', '/b')).toBeNull();
  });
});

describe('matchRedirect', () => {
  const live = [
    { url: 'https://t.example.com/', title: 'Inicio' },
    { url: 'https://t.example.com/blog/sillas-ergonomicas-oficina', title: 'Sillas ergonómicas para oficina' },
    { url: 'https://t.example.com/blog/', title: 'Blog' },
    { url: 'https://t.example.com/contacto', title: 'Contacto' }
  ];
  it('finds the most similar live page', () => {
    expect(matchRedirect({ url: 'https://t.example.com/blog/silla-ergonomica-2023.html' }, live, 'https://t.example.com/')).toMatchObject({ target: 'https://t.example.com/blog/sillas-ergonomicas-oficina', confidence: 'alta' });
  });
  it('falls back to the parent folder, then home', () => {
    expect(matchRedirect({ url: 'https://t.example.com/blog/xyz-123' }, live, 'https://t.example.com/')).toMatchObject({ target: 'https://t.example.com/blog/', confidence: 'baja' });
    expect(matchRedirect({ url: 'https://t.example.com/zzz' }, live, 'https://t.example.com/')).toMatchObject({ target: 'https://t.example.com/', confidence: 'baja' });
  });
});
