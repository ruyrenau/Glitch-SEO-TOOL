// Plugin v1.2: automatic schema, social overrides, category SEO, redirect on slug change, keyphrase lookup.
const B = 'http://127.0.0.1:9400';
const info = await (await fetch(`${B}/test-info.json`)).json();
const auth = { authorization: 'Basic ' + Buffer.from(`admin:${info.app_password}`).toString('base64') };
const KW = 'marca memorable ' + Date.now().toString(36);
const json = { ...auth, 'content-type': 'application/json; charset=utf-8' };
let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${msg}${cond ? '' : `  ${extra}`}`);
  if (!cond) fails++;
};
const html = async p => (await fetch(B + p)).text();
const graphOf = h => {
  const m = h.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
};
const types = g => (g?.['@graph'] ?? []).map(n => n['@type']);
const wp = (path, body, method = 'POST') => fetch(`${B}/wp-json${path}`, { method, headers: json, body: JSON.stringify(body) }).then(r => r.json());

// A post in a category, with focus keyphrase and social overrides.
const cat = await wp('/wp/v2/categories', { name: 'Branding', slug: 'branding-' + Date.now(), description: 'Todo sobre identidad de marca.' });
const post = await wp('/wp/v2/posts', {
  title: 'Cómo crear una marca memorable',
  slug: 'marca-memorable-' + Date.now(),
  status: 'publish',
  categories: [cat.id],
  content: '<p>Una marca memorable empieza por una idea clara.</p>',
  meta: { _gseo_focus_kw: KW, _gseo_og_title: 'Título para Facebook', _gseo_tw_title: 'Título para X', _gseo_tw_image: 'https://cdn.example.com/x.jpg' }
});
let h = await html(new URL(post.link).pathname);
let g = graphOf(h);
ok(['Organization', 'WebSite', 'WebPage', 'BreadcrumbList', 'Person', 'Article'].every(t => types(g).includes(t)), 'Entrada: grafo con Organization, WebSite, WebPage, BreadcrumbList, Person y Article', types(g).join(','));
const art = g['@graph'].find(n => n['@type'] === 'Article');
ok(art.headline === 'Cómo crear una marca memorable' && art.keywords?.[0] === KW && art.articleSection?.[0] === 'Branding' && art.author['@id'].includes('/schema/person/'), 'Article con título, keyword, sección y autor');
const bc = g['@graph'].find(n => n['@type'] === 'BreadcrumbList').itemListElement.map(i => i.name);
ok(JSON.stringify(bc) === JSON.stringify(['Inicio', 'Branding', 'Cómo crear una marca memorable']), 'Migas de pan: Inicio › Branding › entrada', JSON.stringify(bc));
ok(h.includes('property="og:title" content="Título para Facebook"') && h.includes('name="twitter:title" content="Título para X"') && h.includes('name="twitter:image" content="https://cdn.example.com/x.jpg"'), 'Facebook y X con títulos e imagen propios');

// A page with a chosen type: no Article by default.
await wp(`/wp/v2/pages/${info.page}`, { meta: { _gseo_schema_page: 'ContactPage', _glitch_schema_jsonld: '' } }); // an entity graph from G.SEO would take precedence
g = graphOf(await html('/servicios/'));
ok(types(g).includes('ContactPage') && !types(g).includes('Article'), 'Página: tipo elegido (ContactPage) y sin Article', types(g).join(','));

// Category SEO.
await wp(`/wp/v2/categories/${cat.id}`, { meta: { _gseo_title: 'Branding y marca %sep% %sitename%', _gseo_description: 'Guías de branding para negocios.', _gseo_noindex: true } });
h = await html(new URL(cat.link).pathname);
ok(h.includes('<title>Branding y marca | Glitch Creativo</title>'), 'Categoría con título SEO propio', h.match(/<title>.*<\/title>/)?.[0]);
ok(h.includes('content="Guías de branding para negocios."'), 'Categoría con meta descripción propia');
ok(/name='robots' content='noindex/.test(h), 'Categoría con noindex');
ok(types(graphOf(h)).includes('CollectionPage'), 'Categoría como CollectionPage');

// Changing the slug of a published post creates the 301 (and no chains when it changes again).
const oldPath = new URL(post.link).pathname;
const moved = await wp(`/wp/v2/posts/${post.id}`, { slug: 'marca-que-se-recuerda-' + Date.now() });
let r = await fetch(B + oldPath, { redirect: 'manual' });
ok(r.status === 301 && r.headers.get('location') === moved.link, 'Cambiar el slug redirige la URL vieja a la nueva', `${r.status} ${r.headers.get('location')}`);
const moved2 = await wp(`/wp/v2/posts/${post.id}`, { slug: 'marca-final-' + Date.now() });
r = await fetch(B + oldPath, { redirect: 'manual' });
ok(r.headers.get('location') === moved2.link, 'Un segundo cambio actualiza la redirección anterior (sin cadenas)', r.headers.get('location'));
const list = await (await fetch(`${B}/wp-json/gseo-seo/v1/redirects?search=marca`, { headers: auth })).json();
ok(list.items.some(x => x.note.startsWith('Cambio de URL')), 'La redirección queda anotada como "Cambio de URL"');

// Keyphrase already used elsewhere (for the editor analysis).
const used = await (await fetch(`${B}/wp-json/gseo-seo/v1/keyphrase?k=${encodeURIComponent(KW.toUpperCase())}&exclude=0`, { headers: auth })).json();
ok(used.items.length === 1 && used.items[0].id === post.id, 'Detecta la keyword ya usada (sin importar mayúsculas)', JSON.stringify(used));
const none = await (await fetch(`${B}/wp-json/gseo-seo/v1/keyphrase?k=${encodeURIComponent(KW)}&exclude=${post.id}`, { headers: auth })).json();
ok(none.items.length === 0, 'Excluye la página que se está editando');

// Breadcrumbs shortcode.
const sc = await wp('/wp/v2/pages', { title: 'Migas', status: 'publish', parent: info.page, content: '[gseo_breadcrumbs]' });
h = await html(new URL(sc.link).pathname);
ok(/<nav class="gseo-breadcrumbs" aria-label="Migas de pan"><a href="[^"]+">Inicio<\/a> <span class="sep">›<\/span> <a href="[^"]*servicios[^"]*">Servicios de SEO<\/a> <span class="sep">›<\/span> <span aria-current="page">Migas<\/span><\/nav>/.test(h), 'Shortcode [gseo_breadcrumbs] con la página madre');

const log = await fetch(`${B}/wp-content/debug.log`);
const text = log.status === 200 ? await log.text() : '';
ok(!/gseo/i.test(text), 'Sin avisos ni errores de PHP', text.split('\n').filter(x => /gseo/i.test(x)).slice(0, 5).join('\n'));
console.log(fails ? `\n${fails} fallaron` : '\nTodo bien');
process.exit(fails ? 1 : 0);
