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
  /* Il logo della palestra: il file sta sul computer; qui si sceglie, per questo dispositivo, se mostrarlo nel menu e come sfondo sfocato. */
  var LOGO = { sfondo: 'gymart-logo-sfondo', marchio: 'gymart-logo-marchio', sfocatura: 'gymart-logo-sfocatura', visibilita: 'gymart-logo-visibilita' }, logoUrl = '';
  function sino(k, def) { try { var v = root.localStorage.getItem(k); return v === null ? def : v === '1'; } catch (e) { return def; } }
  function numero(k, min, max, def) { try { var v = parseInt(root.localStorage.getItem(k), 10); return v >= min && v <= max ? v : def; } catch (e) { return def; } }
  function logo() { return { sfondo: sino(LOGO.sfondo, true), marchio: sino(LOGO.marchio, true), sfocatura: numero(LOGO.sfocatura, 0, 24, 8), visibilita: numero(LOGO.visibilita, 3, 30, 12) }; }
  /** url = l'indirizzo del logo ('' se non c'è); senza argomento si riapplicano le scelte. */
  function applicaLogo(url) {
    if (typeof url === 'string') logoUrl = url;
    var r = root.document.documentElement, l = logo();
    if (logoUrl) r.style.setProperty('--logo-url', 'url("' + logoUrl + '")'); else r.style.removeProperty('--logo-url');
    r.style.setProperty('--logo-blur', l.sfocatura + 'px'); r.style.setProperty('--logo-op', String(l.visibilita / 100));
    r.setAttribute('data-logo-sfondo', logoUrl && l.sfondo ? '1' : '0'); r.setAttribute('data-logo-marchio', logoUrl && l.marchio ? '1' : '0');
  }
  function impostaLogo(o) {
    try { Object.keys(o).forEach(function (k) { if (LOGO[k]) root.localStorage.setItem(LOGO[k], typeof o[k] === 'boolean' ? (o[k] ? '1' : '0') : String(o[k])); }); } catch (e) {}
    applicaLogo();
  }
  function applica() {
    var t = tema(), scuro = t === 'scuro' || (t === 'auto' && !!mq && mq.matches), r = root.document.documentElement;
    r.setAttribute('data-stile', stile());
    r.setAttribute('data-scheme', scuro ? 'dark' : 'light');
    r.setAttribute('data-movimento', movimentoEffettivo());
    aggiornaMenu(); applicaLogo();
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
  root.Aspetto = { logo: logo, impostaLogo: impostaLogo, applicaLogo: applicaLogo, STILI: STILI, TEMI: TEMI, MOVIMENTI: MOVIMENTI, stile: stile, tema: tema, movimento: movimento, movimentoEffettivo: movimentoEffettivo, imposta: imposta, applica: applica, menuRidotto: menuRidotto, impostaMenu: impostaMenu, aggiornaMenu: aggiornaMenu };
  applica();
  root.addEventListener('resize', aggiornaMenu, { passive: true });
  [mq, mr].forEach(function (q) { if (q) { if (q.addEventListener) q.addEventListener('change', applica); else if (q.addListener) q.addListener(applica); } });
})(window);
