/// <reference lib="dom" />
import { assertSafeUrl } from './ssrf';
import { findBrowser, RenderError } from './render';

/**
 * "Navegación de agentes" (Agentic Web Optimization): can an autonomous agent (Claude computer use, OpenAI
 * Operator, Gemini…) use the page? Agents read the accessibility tree and the DOM, not the design. Chrome loads
 * each page and we collect: controls that only look clickable, unnamed controls, forms without labels,
 * overlays that block the page, captchas, visible prices and offer schema, and the calls to action.
 */

export interface AgentFacts {
  url: string;
  title: string;
  fakeButtons: Array<{ tag: string; text: string }>;
  unnamedControls: Array<{ role: string; html: string }>;
  forms: Array<{ fields: Array<{ type: string; name: string; label: string | null; autocomplete: string | null; required: boolean }>; submit: string | null }>;
  overlays: Array<{ role: string | null; ariaModal: boolean; coverage: number; closeName: string | null; text: string }>;
  captcha: string[];
  prices: string[];
  offerSchema: boolean;
  ctas: Array<{ text: string; tag: string; semantic: boolean }>;
  contactLinks: string[];
  interactive: number;
}

/** Runs inside the page (no closures: it is serialized by puppeteer). */
export function collectAgentFacts(): Omit<AgentFacts, 'url' | 'unnamedControls' | 'interactive'> {
  const txt = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  const SEMANTIC = 'a[href],button,input,select,textarea,summary,label,[role],[tabindex]';
  const fakeButtons: Array<{ tag: string; text: string }> = [];
  for (const el of Array.from(document.querySelectorAll('div,span,li,img,p,i,svg,td'))) {
    if (fakeButtons.length >= 30) break;
    if (el.closest(SEMANTIC) || !visible(el)) continue;
    const clickable = el.hasAttribute('onclick') || (getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer'));
    if (clickable) fakeButtons.push({ tag: el.tagName.toLowerCase(), text: txt(el).slice(0, 60) || (el.getAttribute('aria-label') ?? el.getAttribute('class') ?? '').slice(0, 60) });
  }

  const labelOf = (f: HTMLElement): string | null => {
    const aria = f.getAttribute('aria-label') || (f.getAttribute('aria-labelledby') ? txt(document.getElementById(f.getAttribute('aria-labelledby')!)) : '');
    if (aria) return aria;
    if (f.id) {
      const l = document.querySelector(`label[for="${CSS.escape(f.id)}"]`);
      if (l && txt(l)) return txt(l);
    }
    const wrap = f.closest('label');
    if (wrap && txt(wrap)) return txt(wrap);
    return f.getAttribute('title') || null;
  };
  const fieldSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),select,textarea';
  const groups: Element[] = Array.from(document.querySelectorAll('form'));
  // Some sites build forms without <form>: treat loose fields as one group.
  const loose = Array.from(document.querySelectorAll(fieldSel)).filter(f => !f.closest('form') && visible(f));
  const forms = [...groups.filter(visible), ...(loose.length ? [document.body] : [])].slice(0, 10).map(g => {
    const fields = Array.from(g.querySelectorAll(fieldSel))
      .filter(f => (g === document.body ? !f.closest('form') : true) && visible(f))
      .slice(0, 25)
      .map(f => ({ type: (f.getAttribute('type') || f.tagName).toLowerCase(), name: f.getAttribute('name') || f.getAttribute('id') || '', label: labelOf(f as HTMLElement), autocomplete: f.getAttribute('autocomplete'), required: f.hasAttribute('required') || f.getAttribute('aria-required') === 'true' }));
    const btn = g.querySelector('button[type=submit],input[type=submit],button:not([type])') as HTMLElement | null;
    const submit = btn ? (btn.getAttribute('aria-label') || txt(btn) || (btn as HTMLInputElement).value || null) : null;
    return { fields, submit };
  }).filter(f => f.fields.length);

  const vw = window.innerWidth * window.innerHeight;
  const overlays = Array.from(document.querySelectorAll('body *'))
    .filter(el => {
      const st = getComputedStyle(el);
      if (st.position !== 'fixed' && st.position !== 'sticky') return false;
      if (!visible(el)) return false;
      const r = el.getBoundingClientRect();
      return (r.width * r.height) / vw > 0.3 && !/^(header|nav)$/i.test(el.tagName) && el.getAttribute('role') !== 'banner';
    })
    .slice(0, 5)
    .map(el => {
      const r = el.getBoundingClientRect();
      const close = Array.from(el.querySelectorAll('button,a,[role=button]')).find(b => /cerrar|close|aceptar|accept|rechazar|reject|entendido|ok|continuar|×|✕|^x$/i.test((b.getAttribute('aria-label') || txt(b)).trim()));
      return { role: el.getAttribute('role'), ariaModal: el.getAttribute('aria-modal') === 'true', coverage: Math.round(((r.width * r.height) / vw) * 100), closeName: close ? close.getAttribute('aria-label') || txt(close) : null, text: txt(el).slice(0, 80) };
    });

  const captcha: string[] = [];
  const html = document.documentElement.innerHTML;
  if (/recaptcha/i.test(html)) captcha.push('reCAPTCHA');
  if (/hcaptcha/i.test(html)) captcha.push('hCaptcha');
  if (/challenges\.cloudflare\.com|cf-turnstile/i.test(html)) captcha.push('Cloudflare Turnstile');

  const bodyText = document.body ? document.body.innerText : '';
  const prices = Array.from(new Set(bodyText.match(/(?:\$|€|£|MXN|USD|EUR)\s?\d[\d.,]*(?:\s?(?:MXN|USD|EUR|\+\s?IVA))?|\d[\d.,]*\s?(?:MXN|USD|EUR|€|pesos)/gi) ?? [])).slice(0, 8);
  const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent ?? '').join(' ');
  const offerSchema = /"(@type)"\s*:\s*"(Offer|AggregateOffer)"|"offers"\s*:|"priceRange"\s*:|"price"\s*:/i.test(ld);

  const CTA = /comprar|agregar al carrito|añadir al carrito|a[nñ]adir|carrito|cotiza|cotizaci[oó]n|presupuesto|reserva|agenda|cita|contrata|solicita|suscr[ií]b|inscr[ií]b|add to cart|buy|order|book|quote|schedule|subscribe|get started|contact(o|ar)?|escr[ií]benos|whatsapp|ll[aá]manos/i;
  const ctas = Array.from(document.querySelectorAll('a[href],button,[role=button],input[type=submit],div,span'))
    .filter(el => visible(el) && CTA.test(el.getAttribute('aria-label') || txt(el) || (el as HTMLInputElement).value || '') && txt(el).length < 60 && !el.querySelector('a,button'))
    .slice(0, 15)
    .map(el => ({ text: (el.getAttribute('aria-label') || txt(el) || (el as HTMLInputElement).value || '').slice(0, 60), tag: el.tagName.toLowerCase(), semantic: el.matches('a[href],button,[role=button],input[type=submit]') }));
  const contactLinks = Array.from(new Set(Array.from(document.querySelectorAll('a[href^="mailto:"],a[href^="tel:"],a[href*="wa.me/"],a[href*="api.whatsapp.com"]')).map(a => (a.getAttribute('href') ?? '').split('?')[0]))).slice(0, 10);
  return { title: document.title, fakeButtons, forms, overlays, captcha, prices, offerSchema, ctas, contactLinks };
}

interface AxNode { role?: string; name?: string; children?: AxNode[] }
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch', 'searchbox', 'spinbutton', 'slider', 'listbox']);
export function unnamedFromAx(root: AxNode | null) {
  const out: Array<{ role: string; html: string }> = [];
  let interactive = 0;
  const walk = (n: AxNode) => {
    if (n.role && INTERACTIVE.has(n.role)) {
      interactive++;
      if (!(n.name ?? '').trim()) out.push({ role: n.role, html: '' });
    }
    (n.children ?? []).forEach(walk);
  };
  if (root) walk(root);
  return { unnamed: out.slice(0, 30), interactive };
}

// ---------------------------------------------------------------- scoring

export type AgentCheckId = 'semantic_controls' | 'named_controls' | 'form_labels' | 'no_blocking_overlay' | 'no_captcha' | 'machine_readable_offer' | 'clear_cta';
export const AGENT_CHECKS: Record<AgentCheckId, { label: string; weight: number; fix: string }> = {
  semantic_controls: { label: 'Controles reales (no divs clicables)', weight: 20, fix: 'Usa <button> o <a href> para todo lo que se puede clicar; si no puedes, agrega role="button", tabindex="0" y manejo de Enter/Espacio.' },
  named_controls: { label: 'Botones y enlaces con nombre', weight: 15, fix: 'Cada botón o enlace necesita texto visible o aria-label (sobre todo los de solo ícono: menú, carrito, buscar, cerrar).' },
  form_labels: { label: 'Formularios que un agente puede llenar', weight: 20, fix: 'Cada campo con <label> (o aria-label), el tipo correcto (email, tel), autocomplete (name, email, tel) y un botón de enviar con texto claro.' },
  no_blocking_overlay: { label: 'Sin modales que bloqueen', weight: 15, fix: 'Banners de cookies y popups con role="dialog", aria-modal y un botón de cerrar con nombre; mejor si no tapan el contenido al cargar.' },
  no_captcha: { label: 'Sin captcha en el camino principal', weight: 10, fix: 'Evita captchas visibles en contacto o compra: usa verificación invisible (Turnstile en modo "managed", reCAPTCHA v3) o protección del lado del servidor.' },
  machine_readable_offer: { label: 'Precios legibles por máquina', weight: 10, fix: 'Muestra el precio como texto (no en imagen) y márcalo con schema Offer (price, priceCurrency, availability).' },
  clear_cta: { label: 'Acción principal clara', weight: 10, fix: 'Un botón o enlace real con verbo claro: "Cotizar", "Agendar cita", "Agregar al carrito", "Contactar".' }
};

export interface AgentPageResult {
  url: string;
  title: string;
  score: number;
  checks: Array<{ id: AgentCheckId; score: number | null; detail: string }>;
  facts: AgentFacts;
}

export function scoreAgentPage(f: AgentFacts): AgentPageResult {
  const checks: AgentPageResult['checks'] = [];
  const add = (id: AgentCheckId, score: number | null, detail: string) => checks.push({ id, score, detail });
  add('semantic_controls', f.fakeButtons.length === 0 ? 1 : f.fakeButtons.length <= 3 ? 0.5 : 0, f.fakeButtons.length ? `${f.fakeButtons.length} elemento(s) parecen clicables pero no son botones ni enlaces${f.fakeButtons[0] ? `, por ejemplo <${f.fakeButtons[0].tag}> "${f.fakeButtons[0].text}"` : ''}.` : 'Todo lo clicable es un control real.');
  add('named_controls', f.unnamedControls.length === 0 ? 1 : f.unnamedControls.length <= 3 ? 0.5 : 0, f.unnamedControls.length ? `${f.unnamedControls.length} de ${f.interactive} controles sin nombre (${[...new Set(f.unnamedControls.map(u => u.role))].join(', ')}).` : `${f.interactive} controles, todos con nombre.`);
  if (f.forms.length) {
    const fields = f.forms.flatMap(x => x.fields);
    const labeled = fields.filter(x => x.label).length;
    const contactish = fields.filter(x => /mail|correo|tel|phone|fono|nombre|name/i.test(`${x.name} ${x.label ?? ''}`));
    const typed = contactish.filter(x => !/mail|correo/i.test(`${x.name} ${x.label}`) || x.type === 'email').length;
    const submitOk = f.forms.every(x => !!x.submit?.trim());
    const ratio = fields.length ? labeled / fields.length : 1;
    const s = ratio === 1 && submitOk && typed === contactish.length ? 1 : ratio >= 0.5 && submitOk ? 0.5 : 0;
    add('form_labels', s, `${labeled} de ${fields.length} campos con etiqueta${submitOk ? '' : '; hay un botón de enviar sin texto'}${typed < contactish.length ? '; el correo no usa type="email"' : ''}.`);
  } else add('form_labels', null, 'Sin formularios en esta página.');
  const blocking = f.overlays.filter(o => !(o.closeName && (o.role === 'dialog' || o.role === 'alertdialog' || o.ariaModal)));
  add('no_blocking_overlay', blocking.length ? (blocking.every(o => o.closeName) ? 0.5 : 0) : 1, blocking.length ? `${blocking.length} capa(s) fija(s) tapan ${Math.max(...blocking.map(o => o.coverage))} % de la pantalla al cargar${blocking[0].closeName ? ` (se cierran con "${blocking[0].closeName}", pero no están marcadas como diálogo)` : ' y no tienen un botón de cerrar con nombre'}: "${blocking[0].text}".` : 'Nada tapa la página al cargar.');
  add('no_captcha', f.captcha.length ? 0.5 : 1, f.captcha.length ? `Usa ${f.captcha.join(', ')}: puede frenar a agentes legítimos.` : 'Sin captcha.');
  add('machine_readable_offer', f.prices.length && f.offerSchema ? 1 : f.prices.length || f.offerSchema ? 0.5 : f.ctas.length ? 0 : null, f.prices.length || f.offerSchema ? `${f.prices.length ? `Precios en texto: ${f.prices.slice(0, 3).join(', ')}` : 'Sin precios en texto'}; ${f.offerSchema ? 'con' : 'sin'} schema de oferta.` : f.ctas.length ? 'Hay acciones de compra o cotización, pero ningún precio legible.' : 'Página sin precios ni acciones de compra.');
  const realCta = f.ctas.filter(c => c.semantic);
  add('clear_cta', realCta.length ? 1 : f.ctas.length ? 0.5 : 0, realCta.length ? `Acciones: ${realCta.slice(0, 3).map(c => `"${c.text}"`).join(', ')}.` : f.ctas.length ? `La acción "${f.ctas[0].text}" no es un botón ni un enlace real.` : 'No hay una acción clara (cotizar, agendar, comprar, contactar).');
  const scored = checks.filter(c => c.score !== null);
  const total = scored.reduce((n, c) => n + AGENT_CHECKS[c.id].weight, 0);
  const got = scored.reduce((n, c) => n + AGENT_CHECKS[c.id].weight * (c.score as number), 0);
  return { url: f.url, title: f.title, score: total ? Math.round((got / total) * 100) : 0, checks, facts: f };
}

/** The three things a visitor's agent usually needs, across all audited pages. */
export function agentTasks(pages: AgentPageResult[]) {
  const where = (pred: (p: AgentPageResult) => boolean) => pages.filter(pred).map(p => p.url);
  const priceAt = where(p => p.facts.prices.length > 0 || p.facts.offerSchema);
  const goodForm = where(p => p.facts.forms.some(f => f.submit && f.fields.every(x => x.label)));
  const anyForm = where(p => p.facts.forms.length > 0);
  const direct = where(p => p.facts.contactLinks.length > 0);
  const action = where(p => p.facts.ctas.some(c => c.semantic));
  const blocked = where(p => p.facts.captcha.length > 0);
  return [
    { id: 'find_price', label: 'Encontrar un precio', status: priceAt.length ? 'ok' : 'fail', detail: priceAt.length ? `En ${priceAt.length} página(s).` : 'Ninguna página revisada muestra precios en texto ni schema de oferta: el agente no puede responder "¿cuánto cuesta?".', pages: priceAt },
    { id: 'contact', label: 'Contactar o enviar un formulario', status: goodForm.length ? (goodForm.some(u => blocked.includes(u)) ? 'partial' : 'ok') : anyForm.length || direct.length ? 'partial' : 'fail', detail: goodForm.length ? `Formulario completo en ${goodForm.length} página(s)${goodForm.some(u => blocked.includes(u)) ? ', pero con captcha' : ''}.` : anyForm.length ? 'Hay formularios, pero con campos sin etiqueta o sin botón de enviar con nombre.' : direct.length ? 'Solo enlaces directos (correo, teléfono o WhatsApp), sin formulario.' : 'No se encontró forma de contacto.', pages: goodForm.length ? goodForm : anyForm.length ? anyForm : direct },
    { id: 'act', label: 'Cotizar, agendar o comprar', status: action.length ? 'ok' : pages.some(p => p.facts.ctas.length) ? 'partial' : 'fail', detail: action.length ? `Acción clara en ${action.length} página(s).` : pages.some(p => p.facts.ctas.length) ? 'Las acciones existen, pero no son botones o enlaces reales.' : 'No hay botones de cotizar, agendar ni comprar.', pages: action }
  ];
}

/** Opens each URL in Chrome (requests go through the SSRF guard; images and media are skipped). */
export async function auditAgentPages(urls: string[], opts: { allowHosts?: string[]; timeoutMs?: number; userAgent?: string } = {}): Promise<AgentPageResult[]> {
  const executablePath = findBrowser();
  if (!executablePath) throw new RenderError('BROWSER_NOT_FOUND', 'Esta revisión necesita Chrome, Chromium o Edge instalado (o CHROME_PATH).');
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-dev-shm-usage'] });
  const safe = new Map<string, Promise<boolean>>();
  const isSafe = (u: string) => {
    let host: string;
    try {
      const x = new URL(u);
      if (x.protocol === 'data:' || x.protocol === 'blob:') return Promise.resolve(true);
      if (!/^https?:$/.test(x.protocol)) return Promise.resolve(false);
      host = x.host;
    } catch {
      return Promise.resolve(false);
    }
    if (!safe.has(host)) safe.set(host, assertSafeUrl(u, { allowHosts: opts.allowHosts }).then(() => true, () => false));
    return safe.get(host)!;
  };
  const out: AgentPageResult[] = [];
  try {
    for (const url of urls) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.setUserAgent(opts.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 G.SEO-agent-audit');
        await page.setRequestInterception(true);
        page.on('request', req => {
          const t = req.resourceType();
          if (t === 'image' || t === 'media') return void req.abort().catch(() => undefined);
          isSafe(req.url()).then(ok => (ok ? req.continue() : req.abort('blockedbyclient'))).catch(() => undefined);
        });
        try {
          await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs ?? 30_000 });
        } catch (e) {
          if (!/timeout/i.test((e as Error).message)) throw e;
        }
        await new Promise(r => setTimeout(r, 800)); // late popups and cookie banners
        const facts = await page.evaluate(collectAgentFacts);
        const ax = (await page.accessibility.snapshot({ interestingOnly: true }).catch(() => null)) as AxNode | null;
        const { unnamed, interactive } = unnamedFromAx(ax);
        out.push(scoreAgentPage({ url, ...facts, unnamedControls: unnamed, interactive }));
      } catch (e) {
        out.push({ url, title: '', score: 0, checks: [], facts: { url, title: `No se pudo abrir: ${(e as Error).message.slice(0, 120)}`, fakeButtons: [], unnamedControls: [], forms: [], overlays: [], captcha: [], prices: [], offerSchema: false, ctas: [], contactLinks: [], interactive: 0 } });
      } finally {
        await page.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return out;
}
