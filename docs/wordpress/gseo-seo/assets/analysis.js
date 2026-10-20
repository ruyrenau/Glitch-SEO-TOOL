/**
 * G.SEO – content analysis (SEO + readability), tuned for Spanish. No dependencies; works in the browser
 * (window.GseoAnalysis) and in Node (module.exports) so it can be tested outside WordPress.
 *
 * analyze({ html, title, description, slug, keyphrase, host, usedElsewhere }) →
 *   { seo: { score, rating, checks[] }, readability: { score, rating, checks[] }, stats }
 * Each check: { id, label, rating: 'good' | 'ok' | 'bad', text }.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GseoAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = ('a al algo algunas algunos ante antes como con contra cual cuando de del desde donde durante e el ella ellas ellos en entre era es esa esas ese eso esos esta estas este esto estos ha hay la las le les lo los mas me mi mis muy ni no nos o os para pero por que se sea ser si sin sobre su sus te tu tus u un una unas uno unos y ya yo the of and to in for on with').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  // Spanish transition words and connectors (normalised: lower case, no accents).
  var TRANSITIONS = ('ademas asimismo tambien igualmente incluso es decir o sea por ejemplo en concreto en particular sin embargo no obstante aun asi por el contrario en cambio mientras que aunque a pesar de por lo tanto por consiguiente en consecuencia por eso por ello asi que de modo que de manera que dado que ya que puesto que porque debido a primero segundo tercero finalmente por ultimo en primer lugar en segundo lugar para empezar para terminar luego despues antes entonces a continuacion en resumen en conclusion en definitiva en otras palabras de hecho en realidad sobre todo especialmente principalmente por otro lado por una parte por otra parte mientras tanto al mismo tiempo en cuanto a respecto a con respecto a por supuesto claro que sin duda evidentemente de igual forma de igual manera del mismo modo es mas mas aun ante todo en general generalmente a menudo en efecto pues').split(' ');
  // Multi-word connectors are matched as phrases; build them from the list above.
  var TRANSITION_PHRASES = ['es decir', 'o sea', 'por ejemplo', 'en concreto', 'en particular', 'sin embargo', 'no obstante', 'aun asi', 'por el contrario', 'en cambio', 'mientras que', 'a pesar de', 'por lo tanto', 'por consiguiente', 'en consecuencia', 'por eso', 'por ello', 'asi que', 'de modo que', 'de manera que', 'dado que', 'ya que', 'puesto que', 'debido a', 'por ultimo', 'en primer lugar', 'en segundo lugar', 'para empezar', 'para terminar', 'a continuacion', 'en resumen', 'en conclusion', 'en definitiva', 'en otras palabras', 'de hecho', 'en realidad', 'sobre todo', 'por otro lado', 'por una parte', 'por otra parte', 'mientras tanto', 'al mismo tiempo', 'en cuanto a', 'respecto a', 'con respecto a', 'por supuesto', 'claro que', 'sin duda', 'de igual forma', 'de igual manera', 'del mismo modo', 'es mas', 'mas aun', 'ante todo', 'en general', 'a menudo', 'en efecto'];
  var TRANSITION_WORDS = ['ademas', 'asimismo', 'tambien', 'igualmente', 'incluso', 'aunque', 'porque', 'primero', 'segundo', 'tercero', 'finalmente', 'luego', 'despues', 'entonces', 'especialmente', 'principalmente', 'evidentemente', 'generalmente', 'pues'];
  void TRANSITIONS;

  var PASSIVE = /\b(es|son|era|eran|fue|fueron|sera|seran|sido|ser|siendo|sea|sean|fuera|fueran|fuese|fuesen|seria|serian|ha sido|han sido|habia sido|habian sido)\s+(\w+(ado|ada|ados|adas|ido|ida|idos|idas))\b/;

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ]+/g, ' ')
      .trim();
  }

  function decode(s) {
    return String(s)
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); });
  }

  function stripTags(html) {
    return decode(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function words(text) {
    var t = norm(text);
    return t ? t.split(' ') : [];
  }

  /** Splits text into sentences (., !, ?, …), keeping Spanish openers ¿¡ out of the way. */
  function sentences(text) {
    return String(text || '')
      .replace(/([.!?…]+)(\s+|$)/g, '$1\n')
      .split('\n')
      .map(function (s) { return s.replace(/^[\s¿¡"“«(]+/, '').trim(); })
      .filter(function (s) { return words(s).length > 0; });
  }

  /** Blocks of text: paragraphs, list items, headings. */
  function blocks(html) {
    var out = [];
    var re = /<(p|li|h[1-6]|blockquote|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    var m;
    while ((m = re.exec(html))) {
      var t = stripTags(m[2]);
      if (t) out.push({ tag: m[1].toLowerCase(), text: t });
    }
    // Plain text without tags (classic editor with autop off): split on blank lines.
    if (!out.length) {
      String(html || '').split(/\n\s*\n/).forEach(function (p) {
        var t = stripTags(p);
        if (t) out.push({ tag: 'p', text: t });
      });
    }
    return out;
  }

  function attrs(html, tag, attr) {
    var out = [];
    var re = new RegExp('<' + tag + '\\b[^>]*>', 'gi');
    var m;
    while ((m = re.exec(html))) {
      var a = new RegExp('\\s' + attr + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i').exec(m[0]);
      out.push(a ? decode(a[2]) : null);
    }
    return out;
  }

  /** Approximate Spanish syllable count (vowel groups, splitting hiatus). */
  function syllables(word) {
    var w = String(word).toLowerCase().replace(/[^a-záéíóúüñ]/g, '');
    if (!w) return 0;
    var groups = w.match(/[aeiouáéíóúü]+/g) || [];
    var n = 0;
    groups.forEach(function (g) {
      n += 1;
      for (var i = 1; i < g.length; i++) {
        var a = g[i - 1];
        var b = g[i];
        var strongA = 'aeoáéó'.indexOf(a) >= 0 || 'íú'.indexOf(a) >= 0;
        var strongB = 'aeoáéó'.indexOf(b) >= 0 || 'íú'.indexOf(b) >= 0;
        if (strongA && strongB) n += 1; // hiatus: two strong (or accented weak) vowels
      }
    });
    return Math.max(1, n);
  }

  /** Content words of a phrase (stop words removed), normalised. */
  function contentWords(phrase) {
    return words(phrase).filter(function (w) { return !STOPSET[w]; });
  }

  /**
   * How a text matches the keyphrase: 'exact' (the phrase as written, ignoring case/accents),
   * 'words' (all its content words, any order) or null.
   */
  function match(text, kw) {
    var t = ' ' + norm(text) + ' ';
    var k = norm(kw);
    if (!k) return null;
    if (t.indexOf(' ' + k + ' ') >= 0) return 'exact';
    var cw = contentWords(kw);
    if (!cw.length) return null;
    for (var i = 0; i < cw.length; i++) if (t.indexOf(' ' + cw[i] + ' ') < 0 && !stemIn(t, cw[i])) return null;
    return 'words';
  }

  /** Accepts simple Spanish plurals/genders: "silla" matches "sillas", "diseño" matches "diseños". */
  function stemIn(t, w) {
    if (w.length < 4) return false;
    var stem = w.replace(/(es|s|a|o)$/, '');
    return new RegExp(' ' + stem + '(a|o|as|os|es|s)? ').test(t);
  }

  function countPhrase(text, kw) {
    var t = ' ' + norm(text) + ' ';
    var k = ' ' + norm(kw) + ' ';
    if (k.trim() === '') return 0;
    var n = 0;
    var i = t.indexOf(k);
    while (i >= 0) {
      n++;
      i = t.indexOf(k, i + k.length - 1);
    }
    return n;
  }

  function check(id, label, rating, text) {
    return { id: id, label: label, rating: rating, text: text };
  }

  function summarise(checks) {
    var scored = checks.filter(function (c) { return c.rating !== 'na'; });
    if (!scored.length) return { score: 0, rating: 'na' };
    var pts = { good: 9, ok: 5, bad: 0 };
    var score = Math.round((scored.reduce(function (s, c) { return s + pts[c.rating]; }, 0) / (scored.length * 9)) * 100);
    return { score: score, rating: score >= 70 ? 'good' : score >= 45 ? 'ok' : 'bad' };
  }

  function isInternal(href, host) {
    if (!href) return false;
    if (/^(mailto|tel|javascript):/i.test(href) || href.charAt(0) === '#') return null; // not a page link
    if (/^https?:\/\//i.test(href)) {
      var h = href.replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].toLowerCase().replace(/^www\./, '');
      return h === String(host || '').toLowerCase().replace(/^www\./, '');
    }
    return true; // relative
  }

  function analyze(input) {
    var html = String(input.html || '');
    var text = stripTags(html);
    var allWords = words(text);
    var wc = allWords.length;
    var kw = String(input.keyphrase || '').trim();
    var kwWords = words(kw);
    var title = String(input.title || '');
    var desc = String(input.description || '');
    var slug = String(input.slug || '');
    var bl = blocks(html);
    var paragraphs = bl.filter(function (b) { return b.tag === 'p' || b.tag === 'li' || b.tag === 'blockquote' || b.tag === 'td'; });
    var subheads = bl.filter(function (b) { return b.tag === 'h2' || b.tag === 'h3'; });
    var imgAlts = attrs(html, 'img', 'alt');
    var hrefs = attrs(html, 'a', 'href');
    var sents = sentences(paragraphs.map(function (p) { return p.text; }).join(' ') || text);

    // ---------------------------------------------------------------- SEO
    var seo = [];
    if (!kw) {
      seo.push(check('kw', 'Keyword principal', 'bad', 'Escribe la keyword principal: la búsqueda por la que quieres que encuentren esta página.'));
    } else {
      seo.push(kwWords.length <= 4 ? check('kw', 'Largo de la keyword', 'good', 'Buen largo (' + kwWords.length + ' palabra' + (kwWords.length > 1 ? 's' : '') + ').') : kwWords.length <= 8 ? check('kw', 'Largo de la keyword', 'ok', 'Es algo larga (' + kwWords.length + ' palabras). Las búsquedas de 1 a 4 palabras son más fáciles de cubrir.') : check('kw', 'Largo de la keyword', 'bad', 'Es demasiado larga (' + kwWords.length + ' palabras). Elige una búsqueda más corta.'));

      var used = input.usedElsewhere || [];
      seo.push(used.length ? check('kw_used', 'Keyword ya usada', 'ok', 'Ya la usaste en ' + used.length + ' página' + (used.length > 1 ? 's' : '') + ' (' + used.slice(0, 3).map(function (u) { return u.title; }).join(', ') + '). Dos páginas por la misma búsqueda compiten entre sí.') : check('kw_used', 'Keyword ya usada', 'good', 'No la has usado en otra página. ¡Bien!'));

      var mt = match(title, kw);
      var starts = norm(title).indexOf(norm(kw)) === 0;
      seo.push(mt === 'exact' && starts ? check('kw_title', 'Keyword en el título SEO', 'good', 'El título empieza con la keyword. ¡Excelente!') : mt ? check('kw_title', 'Keyword en el título SEO', 'ok', 'El título contiene la keyword' + (mt === 'words' ? ' (en otro orden)' : '') + '. Mejor aún si va al principio.') : check('kw_title', 'Keyword en el título SEO', 'bad', 'El título SEO no contiene la keyword.'));

      seo.push(!desc ? check('kw_desc', 'Keyword en la meta descripción', 'bad', 'Escribe una meta descripción que incluya la keyword.') : match(desc, kw) ? check('kw_desc', 'Keyword en la meta descripción', 'good', 'La meta descripción incluye la keyword.') : check('kw_desc', 'Keyword en la meta descripción', 'bad', 'La meta descripción no incluye la keyword.'));

      var slugWords = words(slug.replace(/-/g, ' '));
      var cw = contentWords(kw);
      var inSlug = cw.filter(function (w) { return slugWords.indexOf(w) >= 0 || stemIn(' ' + slugWords.join(' ') + ' ', w); }).length;
      seo.push(!slug ? check('kw_slug', 'Keyword en la URL', 'ok', 'Guarda la página para revisar la URL.') : cw.length && inSlug === cw.length ? check('kw_slug', 'Keyword en la URL', 'good', 'La URL contiene la keyword.') : inSlug ? check('kw_slug', 'Keyword en la URL', 'ok', 'La URL contiene parte de la keyword.') : check('kw_slug', 'Keyword en la URL', 'bad', 'La URL (slug) no contiene la keyword.'));

      var intro = paragraphs.length ? paragraphs[0].text : text.split(' ').slice(0, 60).join(' ');
      seo.push(!wc ? check('kw_intro', 'Keyword en la introducción', 'bad', 'Todavía no hay texto.') : match(intro, kw) ? check('kw_intro', 'Keyword en la introducción', 'good', 'Aparece en el primer párrafo. ¡Bien!') : check('kw_intro', 'Keyword en la introducción', 'bad', 'Inclúyela en el primer párrafo: confirma de qué trata la página.'));

      var occ = countPhrase(text, kw);
      if (!occ) occ = sents.filter(function (s) { return match(s, kw) === 'words'; }).length;
      var density = wc ? (occ / wc) * 100 : 0;
      var dtxt = 'Aparece ' + occ + ' ' + (occ === 1 ? 'vez' : 'veces') + ' en ' + wc + ' palabras (' + density.toFixed(1) + '%).';
      seo.push(!wc ? check('kw_density', 'Apariciones de la keyword', 'bad', 'Todavía no hay texto.') : density < 0.5 ? check('kw_density', 'Apariciones de la keyword', 'bad', dtxt + ' Menciónala un poco más (al menos ' + Math.max(1, Math.ceil(wc * 0.005)) + ').') : density > 3 ? check('kw_density', 'Apariciones de la keyword', 'bad', dtxt + ' Demasiadas: suena forzado. Usa sinónimos.') : check('kw_density', 'Apariciones de la keyword', 'good', dtxt + ' ¡Bien!'));

      if (subheads.length) {
        var withKw = subheads.filter(function (h) { return match(h.text, kw); }).length;
        var share = withKw / subheads.length;
        seo.push(withKw === 0 ? check('kw_subheads', 'Keyword en subtítulos', 'bad', 'Ningún subtítulo (H2/H3) menciona la keyword o sus palabras.') : share > 0.75 && subheads.length > 1 ? check('kw_subheads', 'Keyword en subtítulos', 'ok', withKw + ' de ' + subheads.length + ' subtítulos la mencionan: demasiados, varía.') : check('kw_subheads', 'Keyword en subtítulos', 'good', withKw + ' de ' + subheads.length + ' subtítulos la mencionan. ¡Bien!'));
      }

      if (imgAlts.length) {
        var altKw = imgAlts.filter(function (a) { return a && match(a, kw); }).length;
        seo.push(altKw ? check('kw_alt', 'Keyword en el texto alternativo', 'good', altKw + ' imagen' + (altKw > 1 ? 'es tienen' : ' tiene') + ' la keyword en el alt.') : check('kw_alt', 'Keyword en el texto alternativo', 'ok', 'Ninguna imagen tiene la keyword en su texto alternativo (alt).'));
      }
    }

    seo.push(wc >= 300 ? check('length', 'Extensión del texto', 'good', wc + ' palabras. ¡Bien!') : wc >= 200 ? check('length', 'Extensión del texto', 'ok', wc + ' palabras. Algo corto: apunta a 300 o más.') : check('length', 'Extensión del texto', 'bad', wc + ' palabras. Muy poco texto: apunta a 300 o más.'));

    var tl = title.length;
    seo.push(!tl ? check('title_len', 'Largo del título SEO', 'bad', 'Escribe un título SEO.') : tl > 60 ? check('title_len', 'Largo del título SEO', 'bad', tl + ' caracteres: Google lo cortará (máx. ~60).') : tl < 30 ? check('title_len', 'Largo del título SEO', 'ok', tl + ' caracteres: puedes aprovechar más espacio (30–60).') : check('title_len', 'Largo del título SEO', 'good', tl + ' caracteres. ¡Bien!'));

    var dl = desc.length;
    seo.push(!dl ? check('desc_len', 'Largo de la meta descripción', 'bad', 'Sin meta descripción: Google elegirá un fragmento por su cuenta.') : dl > 156 ? check('desc_len', 'Largo de la meta descripción', 'ok', dl + ' caracteres: se cortará (máx. ~155).') : dl < 120 ? check('desc_len', 'Largo de la meta descripción', 'ok', dl + ' caracteres: puedes usar hasta 155.') : check('desc_len', 'Largo de la meta descripción', 'good', dl + ' caracteres. ¡Bien!'));

    var internal = hrefs.filter(function (h) { return isInternal(h, input.host) === true; }).length;
    var external = hrefs.filter(function (h) { return isInternal(h, input.host) === false; }).length;
    seo.push(internal ? check('links_in', 'Enlaces internos', 'good', internal + ' enlace' + (internal > 1 ? 's' : '') + ' a otras páginas de tu sitio.') : check('links_in', 'Enlaces internos', 'bad', 'Sin enlaces a otras páginas de tu sitio: agrega al menos uno.'));
    seo.push(external ? check('links_out', 'Enlaces externos', 'good', external + ' enlace' + (external > 1 ? 's' : '') + ' a otros sitios.') : check('links_out', 'Enlaces externos', 'ok', 'Sin enlaces a otros sitios: citar fuentes de calidad suma confianza.'));
    seo.push(imgAlts.length ? check('images', 'Imágenes', 'good', imgAlts.length + ' imagen' + (imgAlts.length > 1 ? 'es' : '') + '.') : check('images', 'Imágenes', 'ok', 'Sin imágenes: agrega al menos una con texto alternativo.'));
    var h1 = bl.filter(function (b) { return b.tag === 'h1'; }).length;
    if (h1) seo.push(check('h1', 'Encabezado H1', 'bad', 'El contenido tiene ' + h1 + ' H1. El título de la página ya es el H1: usa H2 y H3 dentro del texto.'));

    // ---------------------------------------------------------------- Readability
    var read = [];
    var sentWords = sents.map(function (s) { return words(s).length; });
    var syl = allWords.reduce(function (s, w) { return s + syllables(w); }, 0);
    var fh = wc && sents.length ? 206.84 - 0.6 * ((syl / wc) * 100) - 1.02 * ((sents.length / wc) * 100) : null;
    if (wc < 50) {
      read.push(check('too_short', 'Texto', 'na', 'Escribe al menos 50 palabras para analizar la legibilidad.'));
    } else {
      var level = fh >= 90 ? 'muy fácil' : fh >= 80 ? 'fácil' : fh >= 70 ? 'bastante fácil' : fh >= 60 ? 'normal' : fh >= 50 ? 'algo difícil' : fh >= 30 ? 'difícil' : 'muy difícil';
      read.push(check('fh', 'Facilidad de lectura (Fernández-Huerta)', fh >= 60 ? 'good' : fh >= 50 ? 'ok' : 'bad', Math.round(fh) + ' de 100: ' + level + '.' + (fh < 60 ? ' Usa frases y palabras más cortas.' : '')));

      var longP = paragraphs.filter(function (p) { return words(p.text).length > 150; }).length;
      read.push(longP ? check('para_len', 'Largo de párrafos', 'bad', longP + ' párrafo' + (longP > 1 ? 's tienen' : ' tiene') + ' más de 150 palabras: divídelos.') : check('para_len', 'Largo de párrafos', 'good', 'Ningún párrafo es demasiado largo. ¡Bien!'));

      var longS = sentWords.filter(function (n) { return n > 25; }).length;
      var pctLong = sents.length ? (longS / sents.length) * 100 : 0;
      read.push(pctLong <= 25 ? check('sent_len', 'Largo de oraciones', 'good', Math.round(pctLong) + '% de las oraciones tienen más de 25 palabras. ¡Bien!') : pctLong <= 30 ? check('sent_len', 'Largo de oraciones', 'ok', Math.round(pctLong) + '% de las oraciones tienen más de 25 palabras (máx. recomendado 25%).') : check('sent_len', 'Largo de oraciones', 'bad', Math.round(pctLong) + '% de las oraciones tienen más de 25 palabras: acórtalas (máx. 25%).'));

      // Words between subheadings.
      var sections = [];
      var cur = 0;
      bl.forEach(function (b) {
        if (/^h[2-6]$/.test(b.tag)) {
          sections.push(cur);
          cur = 0;
        } else cur += words(b.text).length;
      });
      sections.push(cur);
      var longSec = sections.filter(function (n) { return n > 300; }).length;
      read.push(wc > 300 && !subheads.length ? check('subheads', 'Subtítulos', 'bad', 'Más de 300 palabras sin subtítulos: agrega H2 o H3 para dividir el texto.') : longSec ? check('subheads', 'Subtítulos', 'ok', longSec + ' sección' + (longSec > 1 ? 'es tienen' : ' tiene') + ' más de 300 palabras sin subtítulo.') : check('subheads', 'Subtítulos', 'good', 'El texto está bien dividido con subtítulos.'));

      if (sents.length >= 5) {
        var trans = sents.filter(function (s) {
          var t = ' ' + norm(s) + ' ';
          return TRANSITION_PHRASES.some(function (p) { return t.indexOf(' ' + p + ' ') >= 0; }) || TRANSITION_WORDS.some(function (w) { return t.indexOf(' ' + w + ' ') >= 0; });
        }).length;
        var pctT = (trans / sents.length) * 100;
        read.push(pctT >= 30 ? check('transitions', 'Palabras de transición', 'good', Math.round(pctT) + '% de las oraciones usan conectores (además, sin embargo, por eso…). ¡Bien!') : pctT >= 20 ? check('transitions', 'Palabras de transición', 'ok', Math.round(pctT) + '% de las oraciones usan conectores: apunta a 30%.') : check('transitions', 'Palabras de transición', 'bad', 'Solo ' + Math.round(pctT) + '% de las oraciones usan conectores (además, por ejemplo, sin embargo…): apunta a 30%.'));

        var passive = sents.filter(function (s) { return PASSIVE.test(norm(s)); }).length;
        var pctP = (passive / sents.length) * 100;
        read.push(pctP <= 10 ? check('passive', 'Voz pasiva', 'good', Math.round(pctP) + '% de las oraciones en voz pasiva. ¡Bien!') : pctP <= 15 ? check('passive', 'Voz pasiva', 'ok', Math.round(pctP) + '% de las oraciones en voz pasiva (máx. recomendado 10%).') : check('passive', 'Voz pasiva', 'bad', Math.round(pctP) + '% de las oraciones en voz pasiva ("fue diseñado por…"): usa la voz activa.'));
      }

      var firsts = sents.map(function (s) { return words(s)[0] || ''; });
      var run = 1;
      var repeats = [];
      for (var i = 1; i < firsts.length; i++) {
        if (firsts[i] && firsts[i] === firsts[i - 1]) {
          run++;
          if (run === 3) repeats.push(firsts[i]);
        } else run = 1;
      }
      read.push(repeats.length ? check('starts', 'Inicio de oraciones', 'bad', '3 o más oraciones seguidas empiezan con "' + repeats.join('", "') + '": varía el inicio.') : check('starts', 'Inicio de oraciones', 'good', 'Las oraciones empiezan de forma variada. ¡Bien!'));
    }

    var s = summarise(seo);
    var r = summarise(read);
    return {
      seo: { score: kw ? s.score : Math.min(s.score, 40), rating: kw ? s.rating : 'bad', checks: seo },
      readability: { score: r.score, rating: r.rating, checks: read },
      stats: { words: wc, sentences: sents.length, paragraphs: paragraphs.length, subheadings: subheads.length, images: imgAlts.length, readingEase: fh === null ? null : Math.round(fh), minutes: Math.max(1, Math.round(wc / 200)) }
    };
  }

  return { analyze: analyze, norm: norm, syllables: syllables, sentences: sentences, match: match };
});
