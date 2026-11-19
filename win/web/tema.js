/* Aspetto del programma: stile (vetro, club, morbido, sobrio), tema (automatico, chiaro, scuro) e movimento (automatico, pieno, ridotto, spento).
   Si legge dal browser di questo dispositivo e si applica prima che la pagina si disegni. */
(function (root) {
  'use strict';
  var STILI = ['sobrio', 'club', 'morbido', 'vetro'], TEMI = ['auto', 'chiaro', 'scuro'], MOVIMENTI = ['auto', 'pieno', 'ridotto', 'spento'];
  var mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  var mr = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function leggi(k, ok, def) { try { var v = root.localStorage.getItem(k); return ok.indexOf(v) >= 0 ? v : def; } catch (e) { return def; } }
  function stile() { return leggi('gymart-stile', STILI, 'sobrio'); } // "Gestionale": sober and flat
  function tema() { return leggi('gymart-tema', TEMI, 'auto'); }
  function movimento() { return leggi('gymart-movimento', MOVIMENTI, 'auto'); }
  /** What is really used: "automatico" is quiet (soft fades), and off when the system asks to reduce motion. */
  function movimentoEffettivo() { var m = movimento(); return m === 'auto' ? (mr && mr.matches ? 'spento' : 'ridotto') : m; } // by default only soft fades
  /** The menu on the left is narrow (icons only) on a tablet, or when the person reduced it. */
  function menuRidotto() { try { return root.localStorage.getItem('gymart-menu') === 'stretto'; } catch (e) { return false; } }
  function aggiornaMenu() {
    var w = root.innerWidth || 1280;
    root.document.documentElement.classList.toggle('rail', w > 700 && (w < 1100 || menuRidotto()));
  }
  function impostaMenu(ridotto) {
    try { root.localStorage.setItem('gymart-menu', ridotto ? 'stretto' : 'esteso'); } catch (e) {}
    aggiornaMenu();
  }
  function applica() {
    var t = tema(), scuro = t === 'scuro' || (t === 'auto' && !!mq && mq.matches), r = root.document.documentElement;
    r.setAttribute('data-stile', stile());
    r.setAttribute('data-scheme', scuro ? 'dark' : 'light');
    r.setAttribute('data-movimento', movimentoEffettivo());
    aggiornaMenu();
    // the colour of the browser bar follows the page
    var col = '';
    try { col = root.getComputedStyle(r).getPropertyValue('--top-bg').trim(); } catch (e) {}
    if (col) [].forEach.call(root.document.querySelectorAll('meta[name="theme-color"]'), function (m, i) { if (i) m.parentNode.removeChild(m); else { m.removeAttribute('media'); m.setAttribute('content', col); } });
    try { root.dispatchEvent(new root.CustomEvent('gymart:aspetto')); } catch (e) {}
  }
  function imposta(o) {
    try {
      if (o.stile && STILI.indexOf(o.stile) >= 0) root.localStorage.setItem('gymart-stile', o.stile);
      if (o.tema && TEMI.indexOf(o.tema) >= 0) root.localStorage.setItem('gymart-tema', o.tema);
      if (o.movimento && MOVIMENTI.indexOf(o.movimento) >= 0) root.localStorage.setItem('gymart-movimento', o.movimento);
    } catch (e) {}
    applica();
  }
  root.Aspetto = { STILI: STILI, TEMI: TEMI, MOVIMENTI: MOVIMENTI, stile: stile, tema: tema, movimento: movimento, movimentoEffettivo: movimentoEffettivo, imposta: imposta, applica: applica, menuRidotto: menuRidotto, impostaMenu: impostaMenu, aggiornaMenu: aggiornaMenu };
  applica();
  root.addEventListener('resize', aggiornaMenu, { passive: true });
  [mq, mr].forEach(function (q) { if (q) { if (q.addEventListener) q.addEventListener('change', applica); else if (q.addListener) q.addListener(applica); } });
})(window);
