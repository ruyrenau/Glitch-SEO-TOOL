import http from 'http';
import type { AddressInfo } from 'net';

/**
 * A tiny local website with known SEO problems, used by crawler and API tests.
 * Every problem is intentional and listed next to the route.
 */
export interface FixtureSite {
  origin: string;
  sitemapXml: string;
  requests: string[];
  /** Version 2 simulates a bad deploy (noindex, canonical change, 500, schema removed, robots change). */
  setVersion: (v: 1 | 2) => void;
  close: () => Promise<void>;
}

const page = (o: { title?: string; desc?: string; canonical?: string; robots?: string; h1?: string[]; body?: string; links?: string[]; jsonld?: string; lang?: string | null; head?: string }) => `<!doctype html>
<html${o.lang === null ? '' : ` lang="${o.lang ?? 'es'}"`}><head>
${o.title !== undefined ? `<title>${o.title}</title>` : ''}
${o.desc ? `<meta name="description" content="${o.desc}">` : ''}
${o.canonical ? `<link rel="canonical" href="${o.canonical}">` : ''}
${o.robots ? `<meta name="robots" content="${o.robots}">` : ''}
${o.jsonld !== undefined ? `<script type="application/ld+json">${o.jsonld}</script>` : ''}
${o.head ?? ''}
</head><body>
<nav><a href="/">Inicio</a> <a href="/about">Nosotros</a></nav>
<main>
${(o.h1 ?? []).map(h => `<h1>${h}</h1>`).join('')}
${o.body ?? ''}
${(o.links ?? []).map(l => `<a href="${l}">${l}</a>`).join(' ')}
</main>
<footer>Pie de página repetido en todas las páginas</footer>
</body></html>`;

const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${i % 37}`).join(' ');

export async function startFixtureSite(port = 0): Promise<FixtureSite> {
  const requests: string[] = [];
  let origin = '';
  const routes: Record<string, (res: http.ServerResponse) => void> = {};
  const routesV2: Record<string, (res: http.ServerResponse) => void> = {};
  let version: 1 | 2 = 1;
  const html = (body: string, status = 200, headers: Record<string, string> = {}) => (res: http.ServerResponse) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
    res.end(body);
  };
  const redirect = (to: string, status = 301) => (res: http.ServerResponse) => {
    res.writeHead(status, { location: to });
    res.end();
  };

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push(url);
    const handler = (version === 2 && routesV2[url]) || routes[url];
    if (handler) return handler(res);
    html(page({ title: 'No encontrado', h1: ['404'] }), 404)(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const abs = (p: string) => `${origin}${p}`;
  const longBody = (seed: string) => `<p>${words(220, seed)}</p>`;

  Object.assign(routes, {
    '/robots.txt': (res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`User-agent: *\nDisallow: /private/\nAllow: /private/public-note\n\nSitemap: ${abs('/sitemap.xml')}\n`);
    },
    // OK page with schema, self canonical, images (one without alt)
    '/': html(page({
      title: 'Glitch Demo Store — Auditorías SEO técnicas en México',
      desc: 'Tienda demo para pruebas del crawler.',
      canonical: abs('/'),
      h1: ['Inicio'],
      jsonld: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Demo' }),
      body: `${longBody('home')}<img src="/a.png" alt="logo"><img src="/b.png">`,
      links: ['/about', '/old', '/missing', '/error', '/noindex-page', '/dup-a', '/dup-b', '/thin', '/canonical-to-redirect', '/bad-schema', '/private/secret', '/loop-a', '/cart', '/products?sort=asc', '/deep/1', 'mailto:hola@example.com', 'https://external.example.org/x']
    })),
    // Resources: CSS + JS (ok), a missing script, a PDF link, a heavy image and an "image" served as HTML.
    '/about': html(page({ title: 'Sobre nosotros: equipo de SEO técnico en Puebla', desc: 'Quiénes somos.', canonical: abs('/about'), h1: ['Nosotros'], body: `${longBody('about')}<img src="/a.png" alt="logo">`, links: ['/guia.pdf'], head: '<link rel="stylesheet" href="/style.css"><script src="/app.js"></script><script src="/missing.js"></script>', jsonld: '{"@context":"https://schema.org","@type":"AboutPage"}' })),
    // Redirect chain: /old -> /older -> /about
    '/old': redirect('/older'),
    '/older': redirect('/about', 302),
    // Redirect loop
    '/loop-a': redirect('/loop-b'),
    '/loop-b': redirect('/loop-a'),
    '/error': html(page({ title: 'Error' }), 500),
    // noindex page that is also listed in the sitemap
    '/noindex-page': html(page({ title: 'Página con noindex accidental de staging', desc: 'x', canonical: abs('/noindex-page'), robots: 'noindex, follow', h1: ['Oculta'], body: longBody('noidx') })),
    // Exact duplicates (same title, description and main content)
    '/dup-a': html(page({ title: 'Servicio duplicado de auditoría SEO técnica', desc: 'Misma descripción', canonical: abs('/dup-a'), h1: ['Duplicado'], body: longBody('dup') })),
    '/dup-b': html(page({ title: 'Servicio duplicado de auditoría SEO técnica', desc: 'Misma descripción', canonical: abs('/dup-b'), h1: ['Duplicado'], body: longBody('dup') })),
    // Thin, short title, no description, no h1, no lang, no canonical
    '/thin': html(page({ title: 'Corto', lang: null, body: '<p>Poco texto aquí.</p>' })),
    // Canonical pointing to a redirect
    '/canonical-to-redirect': html(page({ title: 'Canonical que apunta a una redirección 301', desc: 'c', canonical: abs('/old'), h1: ['Canon'], body: longBody('canon') })),
    // Broken JSON-LD + multiple h1 + very long title
    '/bad-schema': html(page({ title: 'Página con datos estructurados rotos y un título excesivamente largo para Google', desc: 'b', canonical: abs('/bad-schema'), h1: ['Uno', 'Dos'], body: longBody('schema'), jsonld: '{"@context":"https://schema.org","@type":"Article",}' })),
    '/private/secret': html(page({ title: 'Nunca debería solicitarse' })),
    '/cart': html(page({ title: 'Carrito: nunca debería solicitarse' })),
    // Indexable parameter URL (self canonical with query)
    '/products?sort=asc': html(page({ title: 'Productos ordenados ascendente por precio', desc: 'p', canonical: abs('/products?sort=asc'), h1: ['Productos'], body: longBody('prod') })),
    // Deep chain of pages: /deep/1 -> /deep/2 -> ... -> /deep/6
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map(n => [
        `/deep/${n}`,
        html(page({ title: `Página profunda número ${n} del sitio de pruebas`, desc: `deep ${n}`, canonical: abs(`/deep/${n}`), h1: [`Nivel ${n}`], body: longBody(`deep${n}`), links: n < 6 ? [`/deep/${n + 1}`] : [] }))
      ])
    ),
    // Only reachable through the sitemap (orphan)
    '/orphan': html(page({ title: 'Página huérfana sólo presente en el sitemap', desc: 'o', canonical: abs('/orphan'), h1: ['Huérfana'], body: longBody('orphan') }))
  });

  const sitemapXml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/about', '/noindex-page', '/old', '/orphan', '/missing', '/private/secret']
    .map(p => `<url><loc>${abs(p)}</loc></url>`)
    .join('')}</urlset>`;
  const file = (type: string, body: string | Buffer) => (res: http.ServerResponse) => {
    res.writeHead(200, { 'content-type': type, 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  routes['/style.css'] = file('text/css', 'body{margin:0}');
  routes['/app.js'] = file('application/javascript', 'console.log(1)');
  routes['/guia.pdf'] = file('application/pdf', '%PDF-1.4 demo');
  routes['/a.png'] = file('image/png', Buffer.alloc(300 * 1024));
  routes['/b.png'] = file('text/html', '<p>not an image</p>');
  routes['/sitemap.xml'] = res => {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(sitemapXml);
  };

  Object.assign(routesV2, {
    '/robots.txt': (res: http.ServerResponse) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`User-agent: *
Disallow: /private/
Disallow: /deep/

Sitemap: ${abs('/sitemap.xml')}
`);
    },
    // Regression: noindex shipped to production
    '/about': html(page({ title: 'Sobre nosotros: equipo de SEO técnico en Puebla', desc: 'Quiénes somos.', canonical: abs('/about'), robots: 'noindex', h1: ['Nosotros'], body: longBody('about') })),
    // Canonical changed to another URL
    '/dup-a': html(page({ title: 'Servicio duplicado de auditoría SEO técnica', desc: 'Misma descripción', canonical: abs('/dup-b'), h1: ['Duplicado'], body: longBody('dup') })),
    // Page broke
    '/products?sort=asc': html(page({ title: 'Error' }), 500),
    // Content emptied and schema removed on the homepage
    '/': html(page({
      title: 'Glitch Demo Store — Auditorías SEO técnicas en México',
      desc: 'Tienda demo para pruebas del crawler.',
      canonical: abs('/'),
      h1: ['Inicio'],
      body: '<p>Próximamente.</p>',
      links: ['/about', '/old', '/missing', '/error', '/noindex-page', '/dup-a', '/dup-b', '/thin', '/canonical-to-redirect', '/bad-schema', '/private/secret', '/loop-a', '/cart', '/products?sort=asc', '/deep/1']
    }))
  });

  return { origin, sitemapXml, requests, setVersion: v => (version = v), close: () => new Promise(r => server.close(() => r())) };
}
