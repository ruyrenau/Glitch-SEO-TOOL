// Checks the G.SEO – SEO plugin against a real WordPress (Playground on :9400).
const B = 'http://127.0.0.1:9400';
const V = '/vieja-' + Date.now();
const info = await (await fetch(`${B}/test-info.json`)).json();
const auth = { authorization: 'Basic ' + Buffer.from(`admin:${info.app_password}`).toString('base64') };
const json = { ...auth, 'content-type': 'application/json; charset=utf-8' };
let fails = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? '✔' : '✘'} ${msg}${cond ? '' : `  ${extra}`}`);
  if (!cond) fails++;
};
const html = async p => (await fetch(B + p)).text();
const head = h => (h.match(/<!-- G\.SEO -->([\s\S]*?)<!-- \/G\.SEO -->/) ?? [])[1] ?? '';

// Per-page fields through /wp/v2 (what G.SEO's "Cambios SEO" and "Entidades" do).
const r = await fetch(`${B}/wp-json/wp/v2/pages/${info.page}`, { method: 'POST', headers: json, body: JSON.stringify({ meta: { _gseo_title: 'Auditoría SEO en Puebla %sep% %sitename%', _gseo_description: 'Auditorías SEO técnicas con resultados medibles.', _gseo_og_image: 'https://cdn.example.com/og.jpg', _glitch_schema_jsonld: JSON.stringify({ '@context': 'https://schema.org', '@type': 'Service', name: 'Auditoría </script><script>alert(1)</script>' }) } }) });
const m = (await r.json()).meta ?? {};
ok(r.status === 200 && m._gseo_title === 'Auditoría SEO en Puebla %sep% %sitename%', 'G.SEO edita título y descripción por la API', `${r.status}`);
let h = await html('/servicios/');
ok(h.includes('<title>Auditoría SEO en Puebla | Glitch Creativo</title>'), 'El título propio usa las variables', h.match(/<title>.*<\/title>/)?.[0]);
ok(head(h).includes('content="Auditorías SEO técnicas con resultados medibles."'), 'Meta descripción propia');
ok(head(h).includes('og:image" content="https://cdn.example.com/og.jpg"') && head(h).includes('summary_large_image'), 'Imagen para compartir y tarjeta grande');
ok(head(h).includes('"@type":"Service"') && !head(h).includes('</script><script>alert'), 'JSON-LD publicado y sin poder cerrar el <script>');
ok((h.match(/application\/ld\+json/g) ?? []).length === 1, 'El JSON-LD aparece una sola vez');
ok(!/<link rel=['"]canonical['"][^>]*>[\s\S]*<link rel=['"]canonical/.test(h), 'Un solo canonical');

// Viewers cannot write SEO fields.
const anon = await fetch(`${B}/wp-json/wp/v2/pages/${info.page}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ meta: { _gseo_title: 'hack' } }) });
ok(anon.status === 401, 'Sin credenciales no se puede editar', anon.status);
ok((await fetch(`${B}/wp-json/gseo-seo/v1/redirects`)).status === 401, 'Las redirecciones no son públicas');

// Canonical override and noindex/nofollow.
await fetch(`${B}/wp-json/wp/v2/posts/${info.post}`, { method: 'POST', headers: json, body: JSON.stringify({ meta: { _gseo_canonical: `${B}/servicios/`, _gseo_nofollow: true } }) });
h = await html('/guia-seo-local/');
ok(head(h).includes(`<link rel="canonical" href="${B}/servicios/"`), 'Canonical propio');
ok(/name='robots' content='[^']*nofollow/.test(h), 'nofollow en la página');
ok(head(h).includes('og:type" content="article"') && head(h).includes('article:published_time'), 'Las entradas son "article" con fecha');

// Search results and 404s.
h = await html('/?s=seo');
ok(/name='robots' content='noindex/.test(h), 'Búsqueda interna con noindex');

// 404 log is normalised and cleared by a redirect.
await fetch(`${B}${V}/`, { headers: { referer: 'https://blog.example.com/' } });
await fetch(`${B}${V}`);
let l = (await (await fetch(`${B}/wp-json/gseo-seo/v1/404s`, { headers: auth })).json()).items;
const row = l.find(x => x.path === V);
ok(row?.hits === 2 && row.referrer === 'https://blog.example.com/', 'Un 404 con y sin "/" final cuenta como la misma dirección', JSON.stringify(l));
await fetch(`${B}/wp-json/gseo-seo/v1/redirects`, { method: 'POST', headers: json, body: JSON.stringify({ source: V + '/', target: '/servicios/' }) });
l = (await (await fetch(`${B}/wp-json/gseo-seo/v1/404s`, { headers: auth })).json()).items;
ok(!l.some(x => x.path === V), 'Al redirigir, el 404 sale del registro');
const red = await fetch(`${B}${V}`, { redirect: 'manual' });
ok(red.status === 301 && red.headers.get('location') === `${B}/servicios/`, 'La redirección funciona', `${red.status} ${red.headers.get('location')}`);
ok(red.headers.get('x-redirect-by') === 'G.SEO', 'Se identifica como G.SEO');
// Redirect of a page that still exists.
await fetch(`${B}/wp-json/gseo-seo/v1/redirects`, { method: 'POST', headers: json, body: JSON.stringify({ source: '/sample-page', target: 'https://glitchcreativo.com/', code: 302 }) });
const r2 = await fetch(`${B}/sample-page/`, { redirect: 'manual' });
ok(r2.status === 302 && r2.headers.get('location') === 'https://glitchcreativo.com/', 'También redirige páginas que existen, a otro dominio');
const bad = await fetch(`${B}/wp-json/gseo-seo/v1/redirects`, { method: 'POST', headers: json, body: JSON.stringify({ source: 'https://otro-sitio.com/x', target: '/y' }) });
ok(bad.status === 400, 'No acepta orígenes de otro dominio', bad.status);
// Delete.
const list = await (await fetch(`${B}/wp-json/gseo-seo/v1/redirects?search=sample`, { headers: auth })).json();
const del = await fetch(`${B}/wp-json/gseo-seo/v1/redirects/${list.items[0].id}`, { method: 'DELETE', headers: auth });
ok(del.status === 200 && (await fetch(`${B}/sample-page/`, { redirect: 'manual' })).status === 200, 'Borrar una redirección la quita');

// Turning the output off leaves WordPress as it was.
await fetch(`${B}/wp-json/gseo-seo/v1/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ output: false }) });
h = await html('/servicios/');
ok(!h.includes('<!-- G.SEO -->') && h.includes("rel=\"canonical\"") === false ? true : !h.includes('<!-- G.SEO -->'), 'Con el SEO apagado no imprime nada propio');
await fetch(`${B}/wp-json/gseo-seo/v1/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ output: true }) });

// PHP notices or warnings.
const log = await fetch(`${B}/wp-content/debug.log`);
const text = log.status === 200 ? await log.text() : '';
ok(!/gseo/i.test(text), 'Sin avisos ni errores de PHP del plugin', text.split('\n').filter(x => /gseo/i.test(x)).slice(0, 5).join('\n'));

console.log(fails ? `\n${fails} fallaron` : '\nTodo bien');
process.exit(fails ? 1 : 0);
