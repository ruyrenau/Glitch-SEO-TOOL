/**
 * G.SEO editor panel: tabs, Google and social previews, and live SEO/readability analysis
 * of what is being written (block editor or classic editor). Config: window.gseoEditor.
 */
(function () {
  'use strict';
  var C = window.gseoEditor || {};
  var app = document.getElementById('gseo-app');
  if (!app || !window.GseoAnalysis) return;
  var $ = function (sel) { return app.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(app.querySelectorAll(sel)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  // ---------------------------------------------------------------- Tabs
  $$('.gseo-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.gseo-tab').forEach(function (x) { x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      $$('[data-panel]').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === t.getAttribute('data-tab')); });
    });
  });

  // ---------------------------------------------------------------- What is in the editor right now
  var be = function () { return window.wp && wp.data && wp.data.select && wp.data.select('core/editor'); };
  function postTitle() {
    var e = be();
    if (e && e.getEditedPostAttribute) return e.getEditedPostAttribute('title') || '';
    var t = document.getElementById('title');
    return t ? t.value : '';
  }
  function postContent() {
    var e = be();
    if (e && e.getEditedPostContent) return e.getEditedPostContent() || '';
    if (window.tinymce && tinymce.get('content') && !tinymce.get('content').isHidden()) return tinymce.get('content').getContent();
    var c = document.getElementById('content');
    return c ? c.value : '';
  }
  function postSlug() {
    var e = be();
    if (e && e.getEditedPostAttribute) return e.getEditedPostAttribute('slug') || (e.getEditedPostSlug ? e.getEditedPostSlug() : '') || '';
    var s = document.getElementById('post_name') || document.getElementById('editable-post-name-full');
    return s ? s.value || s.textContent || '' : C.slug || '';
  }
  function postUrl() {
    var e = be();
    var link = e && e.getPermalink ? e.getPermalink() : C.permalink;
    return link || C.permalink || C.home;
  }
  function excerptOf(html) {
    var t = GseoAnalysis.norm ? String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    return t.length > 155 ? t.slice(0, 154).replace(/\s+\S*$/, '') + '…' : t;
  }

  // ---------------------------------------------------------------- Fields
  var f = {
    kw: $('#gseo_focus_kw'), title: $('#gseo_title'), desc: $('#gseo_description'),
    ogt: $('#gseo_og_title'), ogd: $('#gseo_og_description'), ogi: $('#gseo_og_image'),
    twt: $('#gseo_tw_title'), twd: $('#gseo_tw_description'), twi: $('#gseo_tw_image'),
    seoScore: $('#gseo_seo_score'), readScore: $('#gseo_read_score')
  };
  function renderTitle(tpl) {
    var t = postTitle();
    return String(tpl || C.titleTemplate || '%title%').replace(/%title%/g, t).replace(/%sitename%/g, C.siteName || '').replace(/%tagline%/g, C.tagline || '').replace(/%sep%/g, C.sep || '|').replace(/%page%/g, '').replace(/\s+/g, ' ').trim();
  }
  function seoTitle() { return renderTitle(f.title.value || C.titleTemplate); }
  function seoDesc() { return f.desc.value || (C.autoDescription ? excerptOf(postContent()) : ''); }

  // Variable buttons insert at the cursor.
  $$('.gseo-vars button').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var input = document.getElementById(b.getAttribute('data-target'));
      var v = b.getAttribute('data-var');
      var pos = input.selectionStart == null ? input.value.length : input.selectionStart;
      if (!input.value && input.placeholder && input.id === 'gseo_title') input.value = C.titleTemplate;
      input.value = input.value.slice(0, pos) + (pos && input.value[pos - 1] !== ' ' ? ' ' : '') + v + ' ' + input.value.slice(pos);
      input.dispatchEvent(new Event('input'));
      input.focus();
    });
  });

  function bar(el, len, min, max) {
    if (!el) return;
    var pct = Math.min(100, (len / max) * 100);
    el.style.width = pct + '%';
    el.className = len === 0 ? '' : len > max ? 'ok' : len >= min ? 'good' : 'ok';
  }

  function bold(text, kw) {
    var out = esc(text);
    if (!kw) return out;
    // Accent-insensitive: the normalised "diseno" also bolds "Diseño".
    var cls = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };
    GseoAnalysis.norm(kw).split(' ').filter(function (w) { return w.length > 2; }).forEach(function (w) {
      var pat = w.split('').map(function (ch) { return cls[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('');
      out = out.replace(new RegExp('(^|[^\\wáéíóúñÁÉÍÓÚÑ])(' + pat + '[a-záéíóúñ]*)', 'gi'), '$1<b>$2</b>');
    });
    return out;
  }

  function preview() {
    var mobile = ($('input[name="gseo_preview_mode"]:checked') || {}).value !== 'desktop';
    var box = $('#gseo-serp');
    box.className = 'gseo-serp' + (mobile ? ' mobile' : '');
    var url = postUrl();
    var u;
    try { u = new URL(url); } catch (e) { u = { hostname: C.host, pathname: '/' }; }
    var crumbs = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    var title = seoTitle();
    var maxT = mobile ? 78 : 60;
    var d = seoDesc();
    var maxD = mobile ? 120 : 155;
    box.querySelector('.name').textContent = C.siteName || u.hostname;
    box.querySelector('.url').textContent = 'https://' + u.hostname + (crumbs.length ? ' › ' + crumbs.join(' › ') : '');
    box.querySelector('.t').textContent = title.length > maxT ? title.slice(0, maxT - 1) + '…' : title;
    box.querySelector('.d').innerHTML = (C.isPost && C.date ? '<span class="date">' + esc(C.date) + ' — </span>' : '') + bold(d.length > maxD ? d.slice(0, maxD - 1) + '…' : d, f.kw.value) || '<em>Escribe una meta descripción.</em>';
    bar($('#gseo-title-bar'), title.length, 30, 60);
    bar($('#gseo-desc-bar'), (f.desc.value || '').length, 120, 156);
    $('#gseo-title-count').textContent = title.length + ' / 60 caracteres';
    $('#gseo-desc-count').textContent = (f.desc.value || '').length + ' / 155 caracteres';

    // Social previews fall back to the SEO title / description / featured image.
    var img = function (own, fallback) { return own || fallback || C.featured || C.defaultImage || ''; };
    var fb = $('#gseo-fb');
    var ogImg = img(f.ogi.value);
    fb.querySelector('.img').style.backgroundImage = ogImg ? 'url("' + ogImg.replace(/"/g, '%22') + '")' : 'none';
    fb.querySelector('.img').textContent = ogImg ? '' : 'Sin imagen: elige una o pon una imagen destacada';
    fb.querySelector('.host').textContent = u.hostname;
    fb.querySelector('.st').textContent = f.ogt.value || title;
    fb.querySelector('.sd').textContent = f.ogd.value || d;
    var x = $('#gseo-x');
    var twImg = img(f.twi.value, f.ogi.value);
    x.querySelector('.img').style.backgroundImage = twImg ? 'url("' + twImg.replace(/"/g, '%22') + '")' : 'none';
    x.querySelector('.img').textContent = twImg ? '' : 'Sin imagen';
    x.querySelector('.host').textContent = u.hostname;
    x.querySelector('.st').textContent = f.twt.value || f.ogt.value || title;
    x.querySelector('.sd').textContent = f.twd.value || f.ogd.value || d;
  }

  // ---------------------------------------------------------------- Keyphrase used elsewhere (REST)
  var usedCache = {};
  var usedFor = '';
  var usedTimer = null;
  function checkUsed() {
    var kw = f.kw.value.trim();
    if (!kw || !C.rest || usedCache[kw]) return;
    clearTimeout(usedTimer);
    usedTimer = setTimeout(function () {
      fetch(C.rest.url + 'keyphrase?' + new URLSearchParams({ k: kw, exclude: String(C.postId || 0) }), { headers: { 'X-WP-Nonce': C.rest.nonce }, credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : { items: [] }; })
        .then(function (r) { usedCache[kw] = r.items || []; usedFor = kw; analyse(); })
        .catch(function () { usedCache[kw] = []; });
    }, 700);
  }

  // ---------------------------------------------------------------- Analysis
  var ICON = { good: 'Bien', ok: 'Mejorable', bad: 'Problema', na: '' };
  function list(checks) {
    var groups = [['bad', 'Problemas'], ['ok', 'Mejoras'], ['good', 'Bien hecho'], ['na', '']];
    return groups.map(function (g) {
      var items = checks.filter(function (c) { return c.rating === g[0]; });
      if (!items.length) return '';
      return (g[1] ? '<h4>' + g[1] + ' (' + items.length + ')</h4>' : '') + '<ul>' + items.map(function (c) {
        return '<li><span class="gseo-dot ' + c.rating + '" aria-label="' + ICON[c.rating] + '"></span><span><strong>' + esc(c.label) + ':</strong> ' + esc(c.text) + '</span></li>';
      }).join('') + '</ul>';
    }).join('');
  }
  function dot(sel, rating) {
    var d = $(sel);
    if (d) d.className = 'gseo-dot ' + (rating === 'na' ? '' : rating);
  }
  function analyse() {
    var kw = f.kw.value.trim();
    var r = GseoAnalysis.analyze({ html: postContent(), title: seoTitle(), description: seoDesc(), slug: postSlug(), keyphrase: kw, host: C.host, usedElsewhere: usedFor === kw ? usedCache[kw] : [] });
    $('#gseo-seo-results').innerHTML = list(r.seo.checks);
    $('#gseo-read-results').innerHTML = list(r.readability.checks);
    var s = r.stats;
    $('#gseo-stats').innerHTML = '<div><b>' + s.words + '</b>palabras</div><div><b>' + s.minutes + ' min</b>de lectura</div><div><b>' + s.sentences + '</b>oraciones</div><div><b>' + s.subheadings + '</b>subtítulos</div><div><b>' + (s.readingEase == null ? '—' : s.readingEase) + '</b>Fernández-Huerta</div>';
    dot('#gseo-dot-seo', r.seo.rating);
    dot('#gseo-dot-read', r.readability.rating);
    f.seoScore.value = String(r.seo.score);
    f.readScore.value = r.readability.rating === 'na' ? '' : String(r.readability.score);
    preview();
    checkUsed();
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(analyse, 600);
  }
  $$('input, textarea, select').forEach(function (el) { el.addEventListener('input', schedule); el.addEventListener('change', schedule); });
  // Block editor: re-analyse when the content changes.
  if (window.wp && wp.data && wp.data.subscribe) {
    var last = '';
    wp.data.subscribe(function () {
      var e = be();
      if (!e || !e.getEditedPostContent) return;
      var sig = (e.getEditedPostAttribute('title') || '') + '|' + (e.getEditedPostAttribute('slug') || '') + '|' + e.getEditedPostContent().length;
      if (sig !== last) {
        last = sig;
        schedule();
      }
    });
  }
  // Classic editor.
  ['title', 'content', 'post_name'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', schedule);
  });
  if (window.tinymce) {
    var hook = function (ed) { if (ed.id === 'content') ed.on('keyup change SetContent', schedule); };
    (tinymce.editors || []).forEach(hook);
    tinymce.on && tinymce.on('AddEditor', function (e) { hook(e.editor); });
  }
  $$('input[name="gseo_preview_mode"]').forEach(function (r) { r.addEventListener('change', preview); });

  // ---------------------------------------------------------------- Image pickers (media library)
  $$('.gseo-pick').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      if (!window.wp || !wp.media) return;
      var target = document.getElementById(b.getAttribute('data-target'));
      var frame = wp.media({ title: 'Imagen para compartir', library: { type: 'image' }, multiple: false, button: { text: 'Usar esta imagen' } });
      frame.on('select', function () {
        var a = frame.state().get('selection').first().toJSON();
        target.value = a.url;
        target.dispatchEvent(new Event('input'));
      });
      frame.open();
    });
  });

  analyse();
})();
