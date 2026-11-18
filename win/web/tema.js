/* Aspetto del programma: stile (club, morbido, sobrio) e tema (automatico, chiaro, scuro).
   Si legge dal browser di questo dispositivo e si applica prima che la pagina si disegni. */
(function (root) {
  'use strict';
  var STILI = ['club', 'morbido', 'sobrio'], TEMI = ['auto', 'chiaro', 'scuro'];
  var mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  function leggi(k, ok, def) { try { var v = root.localStorage.getItem(k); return ok.indexOf(v) >= 0 ? v : def; } catch (e) { return def; } }
  function stile() { return leggi('gymart-stile', STILI, 'club'); }
  function tema() { return leggi('gymart-tema', TEMI, 'auto'); }
  function applica() {
    var t = tema(), scuro = t === 'scuro' || (t === 'auto' && !!mq && mq.matches), r = root.document.documentElement;
    r.setAttribute('data-stile', stile());
    r.setAttribute('data-scheme', scuro ? 'dark' : 'light');
    // the colour of the browser bar follows the page
    var col = '';
    try { col = root.getComputedStyle(r).getPropertyValue('--top-bg').trim(); } catch (e) {}
    if (col) [].forEach.call(root.document.querySelectorAll('meta[name="theme-color"]'), function (m, i) { if (i) m.parentNode.removeChild(m); else { m.removeAttribute('media'); m.setAttribute('content', col); } });
  }
  function imposta(o) {
    try {
      if (o.stile && STILI.indexOf(o.stile) >= 0) root.localStorage.setItem('gymart-stile', o.stile);
      if (o.tema && TEMI.indexOf(o.tema) >= 0) root.localStorage.setItem('gymart-tema', o.tema);
    } catch (e) {}
    applica();
  }
  root.Aspetto = { STILI: STILI, TEMI: TEMI, stile: stile, tema: tema, imposta: imposta, applica: applica };
  applica();
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', applica); else if (mq.addListener) mq.addListener(applica); }
})(window);
