/* KICKS.UA — спільний скрипт сайту
 * Відповідає за: шапку (кнопки навігації), футер, промо-смугу, інформаційні блоки
 * та красиве форматування описів товарів. Все керується з адмінки (site-content.json).
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var hasDOM = typeof document !== 'undefined';

  // ===== Значення за замовчуванням (якщо в site-content.json ще нічого не задано) =====
  var DEFAULTS = {
    navigation: {
      items: [
        { id: 'nav-catalog',   label: '🛍 Каталог',  url: 'index.html',     enabled: true, badge: '' },
        { id: 'nav-favorites', label: '♥ Обране',    url: 'favorites.html', enabled: true, badge: 'fav' },
        { id: 'nav-cart',      label: '🛒 Кошик',    url: 'cart.html',      enabled: true, badge: 'cart' },
        { id: 'nav-delivery',  label: '🚚 Доставка', url: 'delivery.html',  enabled: true, badge: '' },
        { id: 'nav-contacts',  label: '📞 Контакти', url: 'contacts.html',  enabled: true, badge: '' }
      ],
      cta: { enabled: true, label: '💬 Написати нам', url: '' }
    },
    footer: {
      links: [
        { label: 'Telegram-канал', url: '@telegram', enabled: true },
        { label: 'Доставка і оплата', url: 'delivery.html', enabled: true },
        { label: 'Контакти', url: 'contacts.html', enabled: true },
        { label: 'Політика конфіденційності', url: 'privacy.html', enabled: true }
      ]
    },
    promo: { enabled: true, label: 'Знижка тижня', text: 'до −16% на топ-моделі · оплата при отриманні · доставка по всій Україні' }
  };

  var state = {
    nav: DEFAULTS.navigation,
    footer: DEFAULTS.footer,
    promo: DEFAULTS.promo,
    handle: '',
    blocks: []
  };

  // ===== Утиліти =====
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pageId() {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    return f || 'index';
  }

  // Перетворює те, що вписав адмін, у робоче посилання:
  //   ''  або '@telegram' -> Telegram з розділу «Контакти»
  //   '@nickname'         -> https://t.me/nickname
  //   't.me/...'          -> https://t.me/...
  function resolveUrl(url) {
    url = String(url || '').trim();
    if (/^\s*javascript:/i.test(url)) return '';
    if (!url || url === '@telegram') return state.handle ? 'https://t.me/' + state.handle.replace(/^@/, '') : '';
    if (/^@[A-Za-z0-9_]{3,}$/.test(url)) return 'https://t.me/' + url.slice(1);
    if (/^(t\.me|wa\.me|www\.|instagram\.com|facebook\.com|tiktok\.com)/i.test(url)) return 'https://' + url;
    return url;
  }
  function isExternal(u) { return /^(https?:)?\/\//i.test(u); }

  // ===== Кеш конфігурації (щоб шапка не «стрибала» при завантаженні) =====
  var CACHE_KEY = 'kicksSiteCache';
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        nav: state.nav, footer: state.footer, promo: state.promo, handle: state.handle
      }));
    } catch (e) {}
  }
  function applyCache(c) {
    if (!c) return;
    if (c.nav && Array.isArray(c.nav.items)) state.nav = c.nav;
    if (c.footer && Array.isArray(c.footer.links)) state.footer = c.footer;
    if (c.promo) state.promo = c.promo;
    if (typeof c.handle === 'string') state.handle = c.handle;
  }
  function applyData(data) {
    if (!data) return;
    if (data.navigation && Array.isArray(data.navigation.items)) {
      state.nav = { items: data.navigation.items, cta: data.navigation.cta || DEFAULTS.navigation.cta };
    }
    if (data.footer && Array.isArray(data.footer.links)) state.footer = data.footer;
    if (data.homepage && data.homepage.promo) state.promo = data.homepage.promo;
    state.handle = (data.contacts && data.contacts.telegramHandle) || '';
    state.blocks = Array.isArray(data.infoBlocks) ? data.infoBlocks : [];
  }

  var contentPromise = null;
  function getContent() {
    if (!contentPromise) {
      contentPromise = fetch('site-content.json?_=' + Date.now()).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    return contentPromise;
  }

  // ===== Стилі (шапка, футер, промо, блоки, опис товару) =====
  var CSS = [
    "nav.kx-nav{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 20px;padding:14px 6%;position:sticky;top:0;z-index:50;background:var(--canvas,#EDE9E1);border-bottom:2px solid var(--asphalt,#232320);}",
    ".kx-logo{font-family:'Archivo Black',sans-serif;font-size:21px;letter-spacing:-0.02em;text-decoration:none;color:var(--asphalt,#232320);}",
    ".kx-logo span{color:var(--cone,#FF4B12);}",
    ".kx-links{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".kx-btn{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700;letter-spacing:0.02em;text-decoration:none;color:var(--asphalt,#232320);background:var(--chalk,#FAF8F3);border:2px solid var(--asphalt,#232320);padding:9px 14px;box-shadow:3px 3px 0 var(--asphalt,#232320);display:inline-flex;align-items:center;gap:7px;white-space:nowrap;transition:transform .15s,box-shadow .15s,background .15s;}",
    ".kx-btn:hover{transform:translate(2px,2px);box-shadow:1px 1px 0 var(--asphalt,#232320);background:var(--stitch,#C9C2B2);}",
    ".kx-btn.active{background:var(--asphalt,#232320);color:var(--chalk,#FAF8F3);box-shadow:3px 3px 0 var(--cone,#FF4B12);}",
    ".kx-btn.active:hover{box-shadow:1px 1px 0 var(--cone,#FF4B12);}",
    ".kx-btn.kx-cta{background:var(--cone,#FF4B12);color:var(--chalk,#FAF8F3);font-family:'Archivo',sans-serif;font-size:14px;padding:11px 20px;}",
    ".kx-btn.kx-cta:hover{background:var(--asphalt,#232320);}",
    ".kx-badge{display:none;align-items:center;justify-content:center;background:var(--cone,#FF4B12);color:var(--chalk,#FAF8F3);border-radius:50%;min-width:18px;height:18px;padding:0 4px;font-size:10.5px;font-weight:700;}",
    ".kx-btn.active .kx-badge{background:var(--chalk,#FAF8F3);color:var(--asphalt,#232320);}",
    "@media (max-width:760px){nav.kx-nav{padding:12px 4%;gap:10px;}.kx-links{width:100%;flex-wrap:nowrap;overflow-x:auto;padding:2px 4px 8px 2px;-webkit-overflow-scrolling:touch;}.kx-btn{padding:8px 11px;font-size:12px;}.kx-btn.kx-cta{padding:9px 14px;font-size:13px;}}",

    "footer.kx-footer{padding:32px 6%;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:14px;border-top:2px solid var(--asphalt,#232320);}",
    ".kx-foot-links{display:flex;gap:20px;flex-wrap:wrap;font-family:'JetBrains Mono',monospace;font-size:12px;}",
    ".kx-foot-links a{color:var(--asphalt,#232320);text-decoration:none;border-bottom:1px solid var(--stitch,#C9C2B2);}",
    ".kx-foot-links a:hover{color:var(--cone,#FF4B12);border-color:var(--cone,#FF4B12);}",

    ".kx-promo{background:var(--asphalt,#232320);color:var(--chalk,#FAF8F3);padding:10px 6%;display:flex;justify-content:center;gap:10px;align-items:center;font-family:'JetBrains Mono',monospace;font-size:12.5px;letter-spacing:0.04em;flex-wrap:wrap;text-align:center;}",
    ".kx-promo:empty{display:none;}",
    ".kx-promo b{color:var(--cone,#FF4B12);}",

    "#siteBlocks:empty{display:none;}",
    ".kx-block{padding:0 6% 36px;max-width:760px;}",
    ".kx-block h3{font-family:'Archivo Black',sans-serif;font-size:20px;margin-bottom:10px;}",
    ".kx-block p{color:#4a483f;line-height:1.6;white-space:pre-line;}",
    ".kx-block.warn{background:var(--asphalt,#232320);color:var(--chalk,#FAF8F3);padding:26px 6%;max-width:none;margin-bottom:36px;}",
    ".kx-block.warn h3{color:var(--cone,#FF4B12);}",
    ".kx-block.warn p{color:var(--chalk,#FAF8F3);max-width:700px;}",

    ".kx-desc{margin-bottom:20px;color:#4a483f;font-size:15px;line-height:1.5;}",
    ".kx-desc-intro{font-weight:600;color:var(--asphalt,#232320);margin-bottom:10px;}",
    ".kx-desc-list{list-style:none;margin:0;padding:0;background:var(--chalk,#FAF8F3);border:1.5px solid var(--stitch,#C9C2B2);}",
    ".kx-d-row{display:flex;gap:12px;align-items:flex-start;padding:9px 14px;border-bottom:1px dashed var(--stitch,#C9C2B2);}",
    ".kx-d-row:last-child{border-bottom:none;}",
    ".kx-d-row.kx-d-gap{border-top:1px solid var(--stitch,#C9C2B2);}",
    ".kx-d-mark{flex:0 0 24px;text-align:center;font-size:16px;line-height:1.35;}",
    ".kx-d-text{flex:1;min-width:0;line-height:1.4;}",
    ".kx-d-text b{font-weight:700;color:var(--asphalt,#232320);margin-right:6px;}",
    ".kx-d-sub{padding-left:50px;padding-top:6px;padding-bottom:6px;border-bottom:none;font-size:14px;}",
    ".kx-d-sub .kx-d-mark{flex:0 0 10px;margin-top:6px;}",
    ".kx-d-sub .kx-d-mark::before{content:'';display:block;width:7px;height:7px;background:var(--cone,#FF4B12);}",
    ".kx-d-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 12px 50px;border-bottom:none;}",
    ".kx-chip{font-family:'JetBrains Mono',monospace;font-size:12px;border:1.5px solid var(--asphalt,#232320);background:var(--canvas,#EDE9E1);padding:4px 9px;}",
    "@media (max-width:600px){.kx-d-sub,.kx-d-chips{padding-left:36px;}}"
  ].join('\n');

  function injectCss() {
    if (!hasDOM || document.getElementById('kxStyles')) return;
    var st = document.createElement('style');
    st.id = 'kxStyles';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // ===== Бейджі лічильників =====
  function updateBadges() {
    if (!hasDOM) return;
    function count(key) {
      try { return JSON.parse(localStorage.getItem(key) || '[]').length; } catch (e) { return 0; }
    }
    [['cartBadge', 'kicksCart'], ['favBadge', 'kicksFavorites']].forEach(function (p) {
      var n = count(p[1]);
      document.querySelectorAll('#' + p[0]).forEach(function (el) {
        el.textContent = n;
        el.style.display = n > 0 ? 'inline-flex' : 'none';
      });
    });
  }

  // ===== Шапка =====
  function renderNav() {
    var el = document.getElementById('siteNav');
    if (!el) return;
    var cur = pageId();
    var items = (state.nav.items || []).filter(function (i) { return i && i.enabled !== false && i.label; });

    var links = items.map(function (i) {
      var u = resolveUrl(i.url) || '#';
      var ext = isExternal(u);
      var file = u.split('#')[0].split('?')[0].split('/').pop().replace(/\.html$/, '') || 'index';
      var active = !ext && u.indexOf('?') === -1 && u !== '#' && file === cur;
      var badge = i.badge === 'cart' ? '<span class="kx-badge" id="cartBadge">0</span>'
                : i.badge === 'fav'  ? '<span class="kx-badge" id="favBadge">0</span>' : '';
      return '<a class="kx-btn' + (active ? ' active' : '') + '" href="' + esc(u) + '"' +
        (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(i.label) + badge + '</a>';
    }).join('');

    var cta = state.nav.cta || {};
    var ctaUrl = resolveUrl(cta.url);
    var ctaHtml = (cta.enabled !== false && cta.label && ctaUrl)
      ? '<a class="kx-btn kx-cta" id="managerCtaLink" href="' + esc(ctaUrl) + '" target="_blank" rel="noopener">' + esc(cta.label) + '</a>'
      : '';

    el.innerHTML = '<a href="index.html" class="kx-logo">KICKS<span>.UA</span></a>' +
      '<div class="kx-links">' + links + ctaHtml + '</div>';
    updateBadges();
  }

  // ===== Футер =====
  function renderFooter() {
    var el = document.getElementById('siteFooter');
    if (!el) return;
    var links = (state.footer.links || []).filter(function (l) { return l && l.enabled !== false && l.label; })
      .map(function (l) {
        var u = resolveUrl(l.url);
        if (!u) return '';
        var ext = isExternal(u);
        return '<a href="' + esc(u) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + esc(l.label) + '</a>';
      }).join('');
    el.innerHTML = '<a href="index.html" class="kx-logo">KICKS<span>.UA</span></a><div class="kx-foot-links">' + links + '</div>';
  }

  // ===== Промо-смуга =====
  function renderPromo() {
    var el = document.getElementById('sitePromo');
    if (!el) return;
    var p = state.promo || {};
    if (p.enabled === false || !(p.text || p.label)) { el.innerHTML = ''; return; }
    el.innerHTML = '🔥 ' + (p.label ? '<b>' + esc(p.label) + '</b>' : '') + (p.text ? ' — ' + esc(p.text) : '');
  }

  // ===== Інформаційні блоки (для сторінок, окрім «Доставка», яка рендерить їх сама) =====
  function renderBlocks() {
    var el = document.getElementById('siteBlocks');
    if (!el) return;
    var page = pageId();
    el.innerHTML = (state.blocks || []).filter(function (b) {
      return b && b.enabled !== false && Array.isArray(b.pages) && b.pages.indexOf(page) > -1;
    }).map(function (b) {
      return '<div class="kx-block' + (b.style === 'warn' ? ' warn' : '') + '"><h3>' + esc(b.title) + '</h3><p>' + esc(b.text) + '</p></div>';
    }).join('');
  }

  // ===== Красивий опис товару =====
  // Кожен значок/емодзі (або ▪ •) = початок нового рядка. Дрібні маркери (▪) — підпункти.
  var MARK_RE = /((?:[0-9#*]\uFE0F?\u20E3)|(?:(?![©®™])\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*)|[•●○◦‣▸▹►▶■□])/gu;
  var SUB_RE = /^[▪▫◾◽•●○◦‣▸▹■□]/;

  function parseDescription(raw) {
    var rows = [];
    var gap = false;
    String(raw == null ? '' : raw).replace(/\r/g, '').split('\n').forEach(function (line) {
      line = line.trim();
      if (!line) { gap = true; return; }
      var parts = line.split(MARK_RE);
      var intro = (parts[0] || '').trim();
      if (intro) { rows.push({ mark: '', text: intro, sub: false, gap: gap, intro: rows.length === 0 }); gap = false; }
      for (var i = 1; i < parts.length; i += 2) {
        var mark = parts[i];
        var t = (parts[i + 1] || '').trim().replace(/[\s;,.]+$/, '');
        t = t.replace(/\s+([,;])/g, '$1');
        if (!t) {
          // значок без тексту (напр. 👇 в кінці) — дописуємо до попереднього рядка
          if (rows.length && !SUB_RE.test(mark) && !rows[rows.length - 1].sub) rows[rows.length - 1].text += ' ' + mark;
          continue;
        }
        rows.push({ mark: mark, text: t, sub: SUB_RE.test(mark), gap: gap, intro: false });
        gap = false;
      }
    });
    return rows;
  }

  function rowText(t) {
    var m = t.match(/^([^:：]{1,45}?)\s*[:：](?:\s+(.*))?$/);
    if (m) {
      return m[2] ? '<b>' + esc(m[1]) + ':</b><span>' + esc(m[2]) + '</span>' : '<b>' + esc(m[1]) + '</b>';
    }
    return '<span>' + esc(t) + '</span>';
  }

  function formatDescription(raw) {
    var rows = parseDescription(raw);
    if (!rows.length) return '';
    var html = '';
    var list = '';
    function flushList() {
      if (list) { html += '<ul class="kx-desc-list">' + list + '</ul>'; list = ''; }
    }
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r.intro) { html += '<p class="kx-desc-intro">' + esc(r.text) + '</p>'; continue; }
      // розміри виду "36 = 22,5 см" — компактні «чіпси»
      if (r.sub && r.text.indexOf('=') > -1 && !/[:：]/.test(r.text)) {
        var chips = '';
        while (i < rows.length && rows[i].sub && rows[i].text.indexOf('=') > -1 && !/[:：]/.test(rows[i].text)) {
          chips += '<span class="kx-chip">' + esc(rows[i].text) + '</span>';
          i++;
        }
        i--;
        list += '<li class="kx-d-chips">' + chips + '</li>';
        continue;
      }
      list += '<li class="kx-d-row' + (r.sub ? ' kx-d-sub' : '') + (r.gap ? ' kx-d-gap' : '') + '">' +
        '<span class="kx-d-mark">' + (r.sub ? '' : esc(r.mark)) + '</span>' +
        '<div class="kx-d-text">' + rowText(r.text) + '</div></li>';
    }
    flushList();
    return '<div class="kx-desc">' + html + '</div>';
  }

  // Текст без значків — для meta-description / SEO
  function plainDescription(raw) {
    return String(raw == null ? '' : raw).replace(MARK_RE, ' ').replace(/\s+/g, ' ').replace(/\s+([:;,.])/g, '$1').trim();
  }

  // ===== Ініціалізація =====
  function renderAll() {
    renderNav();
    renderFooter();
    renderPromo();
    renderBlocks();
  }

  root.KicksSite = {
    esc: esc,
    pageId: pageId,
    resolveUrl: resolveUrl,
    getContent: getContent,
    updateBadges: updateBadges,
    formatDescription: formatDescription,
    plainDescription: plainDescription,
    renderNav: renderNav
  };

  if (hasDOM) {
    injectCss();
    applyCache(readCache());
    renderNav(); // скрипт підключено одразу після <nav id="siteNav">, тож шапка з'являється без затримки

    document.addEventListener('DOMContentLoaded', function () {
      renderFooter();
      renderPromo();
      getContent().then(function (data) {
        applyData(data);
        writeCache();
        renderAll();
      }).catch(function (err) {
        console.warn('site.js: не вдалося завантажити site-content.json', err);
        renderAll();
      });
    });
    window.addEventListener('storage', updateBadges);
    window.addEventListener('pageshow', updateBadges);
  }
})();
