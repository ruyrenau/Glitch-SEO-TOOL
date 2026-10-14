import * as cheerio from 'cheerio';
import { normalizeUrl } from './extract';

/**
 * Reads a page's HTML and proposes schema.org forms for it: what the page already says
 * (title, description, images, dates, author, price, phone, address, socials, breadcrumbs, FAQ, video)
 * mapped onto the generator's fields. The user reviews and completes everything before using it.
 */

type FormValue = string | boolean | string[] | Record<string, unknown> | Array<Record<string, unknown>> | undefined;
export interface PrefillForm {
  typeId: string;
  type: string;
  values: Record<string, FormValue>;
  reason: string;
}

export interface PageHints {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  lang: string | null;
  siteName: string | null;
  images: string[];
  logo: string | null;
  published: string | null;
  modified: string | null;
  author: string | null;
  price: string | null;
  currency: string | null;
  telephone: string | null;
  email: string | null;
  sameAs: string[];
  address: Record<string, string> | null;
  breadcrumbs: Array<{ name: string; item: string }>;
  faq: Array<{ name: string; acceptedAnswer: string }>;
  video: { embedUrl: string; thumbnailUrl: string | null } | null;
  ogType: string | null;
  keywords: string | null;
  existing: Array<{ type: string; json: unknown }>;
}

const SOCIAL = /(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|wikipedia|threads|github|whatsapp)\.(com|org|net)$/i;
const clean = (s: string | undefined | null) => (s ? s.replace(/\s+/g, ' ').trim() : '') || null;

export function extractPageHints(html: string, pageUrl: string): PageHints {
  const $ = cheerio.load(html);
  const meta = (sel: string) => clean($(sel).first().attr('content'));
  const abs = (u: string | undefined | null) => (u ? normalizeUrl(u.trim(), pageUrl) : null);
  const host = new URL(pageUrl).hostname;

  const existing: PageHints['existing'] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).text());
      const nodes = Array.isArray(j) ? j : Array.isArray(j?.['@graph']) ? j['@graph'] : [j];
      for (const n of nodes) existing.push({ type: String(Array.isArray(n?.['@type']) ? n['@type'][0] : n?.['@type'] ?? 'Desconocido'), json: n });
    } catch {
      existing.push({ type: 'JSON inválido', json: null });
    }
  });

  const images = [meta('meta[property="og:image"]'), meta('meta[name="twitter:image"]'), ...$('main img, article img, img').slice(0, 30).map((_, el) => $(el).attr('src') ?? $(el).attr('data-src')).get()]
    .map(abs)
    .filter((u): u is string => !!u && !/\.svg(\?|$)|data:|pixel|spacer|1x1/i.test(u));
  const logoImg = $('header img, [class*=logo] img, img[class*=logo], img[alt*=logo i], img[src*=logo i]').first().attr('src');
  const logo = abs(logoImg) ?? abs($('link[rel="apple-touch-icon"]').attr('href')) ?? abs($('link[rel~="icon"]').attr('href'));

  const sameAs = [
    ...new Set(
      $('a[href]')
        .map((_, el) => abs($(el).attr('href')))
        .get()
        .filter((u): u is string => {
          try {
            const h = new URL(u).hostname.replace(/^www\./, '');
            return SOCIAL.test(h) && h !== host && !/share|sharer|intent\/tweet|wa\.me\/\?|send\?/i.test(u);
          } catch {
            return false;
          }
        })
    )
  ].slice(0, 10);

  const tel = $('a[href^="tel:"]').first().attr('href');
  const mail = $('a[href^="mailto:"]').first().attr('href');
  const itemprop = (p: string) => clean($(`[itemprop="${p}"]`).first().attr('content') ?? $(`[itemprop="${p}"]`).first().text());
  const addr = { streetAddress: itemprop('streetAddress'), addressLocality: itemprop('addressLocality'), addressRegion: itemprop('addressRegion'), postalCode: itemprop('postalCode'), addressCountry: itemprop('addressCountry') };
  const address = Object.values(addr).some(Boolean) ? (Object.fromEntries(Object.entries(addr).filter(([, v]) => v)) as Record<string, string>) : null;

  const crumbsEl = $('nav[aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"]').first();
  const breadcrumbs = crumbsEl
    .find('a[href]')
    .map((_, el) => ({ name: clean($(el).text()) ?? '', item: abs($(el).attr('href')) ?? '' }))
    .get()
    .filter(b => b.name && b.item);
  const lastCrumb = clean(crumbsEl.find('li').last().text());
  if (breadcrumbs.length && lastCrumb && breadcrumbs[breadcrumbs.length - 1].name !== lastCrumb) breadcrumbs.push({ name: lastCrumb, item: pageUrl });

  const faq: PageHints['faq'] = [];
  $('details').each((_, el) => {
    const q = clean($(el).find('summary').first().text());
    const a = clean($(el).clone().find('summary').remove().end().text());
    if (q && a) faq.push({ name: q, acceptedAnswer: a.slice(0, 1500) });
  });
  if (faq.length < 2) {
    $('h2, h3, h4, dt, [class*="question"]').each((_, el) => {
      const q = clean($(el).text());
      if (!q || !/\?\s*$/.test(q) || q.length > 200) return;
      const a = clean($(el).nextUntil('h2, h3, h4, dt').text()) ?? clean($(el).next('dd').text());
      if (a && !faq.some(f => f.name === q)) faq.push({ name: q, acceptedAnswer: a.slice(0, 1500) });
    });
  }

  const iframe = $('iframe[src*="youtube.com/embed"], iframe[src*="youtube-nocookie.com/embed"], iframe[src*="player.vimeo.com"]').first().attr('src');
  const yt = iframe ? /embed\/([\w-]{6,})/.exec(iframe)?.[1] : null;

  return {
    url: abs(meta('link[rel="canonical"]') ?? $('link[rel="canonical"]').attr('href')) ?? pageUrl,
    title: meta('meta[property="og:title"]') ?? clean($('title').first().text()),
    description: meta('meta[name="description" i]') ?? meta('meta[property="og:description"]'),
    h1: clean($('h1').first().text()),
    lang: clean($('html').attr('lang')),
    siteName: meta('meta[property="og:site_name"]'),
    images: [...new Set(images)].slice(0, 6),
    logo,
    published: meta('meta[property="article:published_time"]') ?? meta('meta[itemprop="datePublished"]') ?? clean($('time[datetime]').first().attr('datetime')),
    modified: meta('meta[property="article:modified_time"]') ?? meta('meta[property="og:updated_time"]') ?? meta('meta[itemprop="dateModified"]'),
    author: meta('meta[name="author"]') ?? meta('meta[property="article:author"]') ?? clean($('[rel="author"], [itemprop="author"] [itemprop="name"], .author-name, .author').first().text()),
    price: meta('meta[property="product:price:amount"]') ?? meta('meta[property="og:price:amount"]') ?? itemprop('price'),
    currency: meta('meta[property="product:price:currency"]') ?? meta('meta[property="og:price:currency"]') ?? itemprop('priceCurrency'),
    telephone: tel ? decodeURIComponent(tel.slice(4)).trim() : itemprop('telephone'),
    email: mail ? mail.slice(7).split('?')[0] : null,
    sameAs,
    address,
    breadcrumbs: breadcrumbs.slice(0, 10),
    faq: faq.slice(0, 30),
    video: iframe ? { embedUrl: abs(iframe)!, thumbnailUrl: yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : null } : null,
    ogType: meta('meta[property="og:type"]'),
    keywords: meta('meta[name="keywords" i]'),
    existing
  };
}

/** Proposes forms for the page, most specific first. */
export function suggestSchemaForms(h: PageHints): PrefillForm[] {
  const out: PrefillForm[] = [];
  const isHome = new URL(h.url).pathname.replace(/\/+$/, '') === '';
  const name = h.siteName ?? h.title?.split(/\s[|\-–·]\s/).pop()?.trim() ?? null;
  const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined);
  const dt = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : undefined);
  const looksLocal = !!(h.telephone && h.address);

  if (h.price) {
    out.push({ typeId: 'Product', type: 'Product', reason: 'La página tiene un precio.', values: { name: h.h1 ?? h.title ?? undefined, description: h.description ?? undefined, image: h.images, offers: [{ price: h.price, priceCurrency: h.currency ?? '', availability: 'InStock', url: h.url }] } });
  }
  if (h.ogType === 'article' || h.published) {
    out.push({ typeId: 'Article', type: /blog/i.test(h.url) ? 'BlogPosting' : 'Article', reason: 'La página tiene fecha de publicación o es de tipo artículo.', values: { headline: h.h1 ?? h.title ?? undefined, description: h.description ?? undefined, image: h.images, datePublished: dt(h.published) ?? date(h.published), dateModified: dt(h.modified) ?? date(h.modified), author: h.author ? [{ '@type': 'Person', name: h.author }] : undefined, mainEntityOfPage: h.url, keywords: h.keywords ?? undefined, inLanguage: h.lang ?? undefined } });
  }
  if (h.faq.length >= 2) out.push({ typeId: 'FAQPage', type: 'FAQPage', reason: `Se encontraron ${h.faq.length} preguntas con respuesta en la página.`, values: { mainEntity: h.faq } });
  if (h.video) out.push({ typeId: 'VideoObject', type: 'VideoObject', reason: 'La página incrusta un video.', values: { name: h.title ?? undefined, description: h.description ?? undefined, embedUrl: h.video.embedUrl, thumbnailUrl: h.video.thumbnailUrl ? [h.video.thumbnailUrl] : undefined } });
  if (looksLocal) {
    out.push({ typeId: 'LocalBusiness', type: 'LocalBusiness', reason: 'La página tiene teléfono y dirección: puede ser un negocio local. Elige el giro.', values: { name: name ?? undefined, url: h.url, telephone: h.telephone ?? undefined, address: h.address ?? undefined, image: h.images.slice(0, 3), description: h.description ?? undefined, sameAs: h.sameAs } });
  }
  if (isHome) {
    if (!looksLocal) out.push({ typeId: 'Organization', type: 'Organization', reason: 'Es la página de inicio: identifica a la organización.', values: { name: name ?? undefined, url: h.url, logo: h.logo ?? undefined, description: h.description ?? undefined, sameAs: h.sameAs, email: h.email ?? undefined, telephone: h.telephone ?? undefined, address: h.address ?? undefined } });
    out.push({ typeId: 'WebSite', type: 'WebSite', reason: 'Es la página de inicio: da el nombre del sitio a Google.', values: { name: name ?? undefined, url: h.url, inLanguage: h.lang ?? undefined } });
  }
  if (h.breadcrumbs.length >= 2) out.push({ typeId: 'BreadcrumbList', type: 'BreadcrumbList', reason: 'La página muestra migas de pan.', values: { itemListElement: h.breadcrumbs } });
  if (!out.length) out.push({ typeId: 'WebPage', type: 'WebPage', reason: 'No se detectó un tipo más específico; empieza por la página y cambia el tipo si aplica.', values: { name: h.title ?? undefined, description: h.description ?? undefined, url: h.url, inLanguage: h.lang ?? undefined, primaryImageOfPage: h.images[0] } });
  return out;
}
