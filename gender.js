/* KICKS.UA — визначення статі товару (жіноче / чоловіче / унісекс).
 *
 * Порядок визначення:
 *   1) значення, яке вручну вказано в адмінці (поле gender: "women" | "men" | "unisex");
 *   2) слова в назві й описі: «Жіночі / Чоловічі», W / M, women / men;
 *   3) діапазон розмірів: 36–41 → жіноче, від 41 і більше → чоловіче, широкий діапазон → унісекс.
 * Товар «унісекс» показується і в жіночому, і в чоловічому розділі.
 */
(function (root) {
  'use strict';

  var LABELS = { women: 'Жіноче', men: 'Чоловіче', unisex: 'Унісекс' };

  var B = '(^|[^a-zа-яіїєґ0-9])';       // початок слова
  var E = '(?=$|[^a-zа-яіїєґ0-9])';     // кінець слова
  var RE_F = new RegExp('жіноч|женск|wmns|' + B + '(w|women|womens)' + E);
  var RE_M = new RegExp('чолов|мужск|' + B + '(m|men|mens)' + E);

  function sizeRange(p) {
    var list = [];
    function add(v) {
      var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
      if (!isNaN(n)) list.push(n);
    }
    // variants містять усі розміри (навіть ті, що зараз закінчились), тож визначення не «стрибає»
    if (p && Array.isArray(p.variants) && p.variants.length) p.variants.forEach(function (v) { add(v && v.size); });
    if (!list.length && p && Array.isArray(p.sizes)) p.sizes.forEach(add);
    if (!list.length) return null;
    return { min: Math.min.apply(null, list), max: Math.max.apply(null, list) };
  }

  function detect(p) {
    if (!p) return 'unisex';
    var text = (String(p.name || '') + ' ' + String(p.description || '')).toLowerCase();
    var f = RE_F.test(text);
    var m = RE_M.test(text);
    if (f && !m) return 'women';
    if (m && !f) return 'men';
    if (f && m) return 'unisex';

    var r = sizeRange(p);
    if (r) {
      if (r.min >= 41) return 'men';
      if (r.max <= 41) return 'women';
    }
    return 'unisex';
  }

  function get(p) {
    var g = p && p.gender;
    if (g === 'women' || g === 'men' || g === 'unisex') return g;
    return detect(p);
  }

  function label(g) { return LABELS[g] || ''; }

  root.KicksGender = { detect: detect, get: get, label: label, LABELS: LABELS };
})(typeof window !== 'undefined' ? window : globalThis);
