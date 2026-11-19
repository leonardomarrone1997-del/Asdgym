/* Movimento: animazioni e scorrimento morbido con GSAP, ScrollTrigger e Lenis (vendor/).
   Tutto è un MIGLIORAMENTO: senza le librerie, con il movimento "spento" o con "riduci movimento" del sistema il programma funziona identico,
   e nessun contenuto resta mai nascosto (ogni animazione finisce togliendo le proprie tracce, e una rete di sicurezza scopre quello che fosse rimasto).
   Le tecniche (cifre che scorrono, luce che segue il puntatore, rivelazioni con sfocatura) le ho imparate guardando React Bits
   (licenza MIT + Commons Clause: l'uso dentro un'applicazione è permesso, ridistribuire i componenti da soli o "portati" no; qui il suo codice NON è copiato,
   le funzioni sono scritte da zero; vedi vendor/LICENZE.txt). */
(function (root) {
  'use strict';
  var doc = root.document, html = doc.documentElement;
  var G = root.gsap, ST = root.ScrollTrigger, LEN = root.Lenis;
  var M = { motore: !!G, lenis: null, ctx: null, tl: null, chiave: null, ultimaLuce: null, pillPos: null, fondoCtx: null };
  var puntatoreFine = root.matchMedia ? root.matchMedia('(pointer: fine)') : null;

  function modo() { return html.getAttribute('data-movimento') || 'spento'; }
  function pieno() { return !!G && modo() === 'pieno'; }
  /** Every public function is wrapped: an animation that fails must never stop the program. */
  function sicuro(nome, f) { return function () { try { return f.apply(M, arguments); } catch (e) { if (root.console && root.console.warn) root.console.warn('movimento ' + nome + ': ' + e.message); } }; }

  if (G) {
    if (ST) G.registerPlugin(ST);
    G.defaults({ ease: 'power3.out', duration: 0.6 });
    G.config({ nullTargetWarn: false });
    html.setAttribute('data-motore', 'gsap'); // from now the CSS animations of before are switched off (see gymart.css)
  }

  /* ---------- scorrimento morbido (Lenis), solo con mouse e finestra larga ---------- */
  function vuoleLenis() { return pieno() && !!LEN && !!puntatoreFine && puntatoreFine.matches && root.innerWidth > 700; }
  function avviaLenis() {
    if (M.lenis || !vuoleLenis()) return;
    // Lenis wraps the browser's own scroll: sticky headers, the keyboard and the scroll bar keep working. Touch devices are left native (syncTouch false).
    M.lenis = new LEN({ lerp: 0.11, wheelMultiplier: 0.95, smoothWheel: true, syncTouch: false, allowNestedScroll: true, autoRaf: false, anchors: false });
    if (ST) M.lenis.on('scroll', ST.update);
    M.tick = function (t) { if (M.lenis) M.lenis.raf(t * 1000); };
    G.ticker.add(M.tick);
    G.ticker.lagSmoothing(0);
  }
  function fermaLenis() {
    if (!M.lenis) return;
    G.ticker.remove(M.tick);
    M.lenis.destroy();
    M.lenis = null;
    G.ticker.lagSmoothing(500, 33);
  }

  /* ---------- sfondo che si muove piano (stili della famiglia del vetro: Liquid Glass e Sole) ---------- */
  function aggiornaFondo() {
    if (M.fondoCtx) { M.fondoCtx.revert(); M.fondoCtx = null; }
    if (!pieno() || !html.hasAttribute('data-vetro')) return;
    var blob = doc.querySelectorAll('.fondo i');
    if (!blob.length) return;
    M.fondoCtx = G.context(function () {
      [].forEach.call(blob, function (b, i) {
        G.to(b, { x: i === 1 ? -70 : 80, y: i === 2 ? -60 : 70, scale: 1.12, duration: 22 + i * 5, ease: 'sine.inOut', repeat: -1, yoyo: true });
      });
    });
  }

  /* ---------- che cosa va fatto quando cambiano le impostazioni ---------- */
  M.aggiorna = sicuro('aggiorna', function () {
    if (!G) return;
    if (vuoleLenis()) avviaLenis(); else fermaLenis();
    aggiornaFondo();
    if (!pieno()) { this.pulisci(); html.setAttribute('data-entrata', 'fine'); } // movement switched off: whatever was running stops and leaves no trace
  });
  M.pulisci = sicuro('pulisci', function () {
    if (M.ctx) { M.ctx.revert(); M.ctx = null; }
    [].forEach.call(doc.querySelectorAll('[data-v]'), function (b) { if (b.querySelector('.od')) b.textContent = formatta(parseFloat(b.getAttribute('data-v')), b.getAttribute('data-f')); }); // digits stopped half way become plain numbers
    M.tl = null;
  });

  /* ---------- numeri: cifre che scorrono (idea: "Counter" di React Bits; qui un contatore mio con GSAP) ---------- */
  function formatta(v, f) { return f === 'eur' ? root.Core.fmtMoney(v) : f === 'pct' ? Math.round(v) + '%' : String(Math.round(v)); }
  function costruisciCifre(b, testo) {
    b.textContent = '';
    var vis = doc.createElement('span'), sr = doc.createElement('span'), strisce = [], i;
    vis.className = 'od'; vis.setAttribute('aria-hidden', 'true');
    sr.className = 'sr-only'; sr.textContent = testo;
    for (i = 0; i < testo.length; i++) {
      var ch = testo.charAt(i);
      if (ch >= '0' && ch <= '9') {
        var d = doc.createElement('span'), s = doc.createElement('span'), k;
        d.className = 'od-d'; s.className = 'od-s';
        for (k = 0; k < 20; k++) { var it = doc.createElement('i'); it.textContent = String(k % 10); s.appendChild(it); } // two turns of digits: the last digit always arrives rolling upwards
        d.appendChild(s); vis.appendChild(d); strisce.push({ el: s, v: +ch });
      } else {
        var c = doc.createElement('span'); c.className = 'od-c'; c.textContent = ch; vis.appendChild(c);
      }
    }
    b.appendChild(vis); b.appendChild(sr);
    return strisce;
  }
  function animaNumeri(view, tl) {
    [].forEach.call(view.querySelectorAll('[data-v]'), function (b) {
      var v = parseFloat(b.getAttribute('data-v')), testo = formatta(v, b.getAttribute('data-f'));
      var strisce = costruisciCifre(b, testo);
      if (!strisce.length) { b.textContent = testo; return; }
      strisce.forEach(function (x) { G.set(x.el, { yPercent: -x.v * 5 }); });
      var t = G.to(strisce.map(function (x) { return x.el; }), {
        yPercent: function (i) { return -(strisce[i].v + 10) * 5; }, duration: 1.25, ease: 'expo.out', stagger: { each: 0.06, from: 'end' },
        onComplete: function () { b.textContent = testo; } // the digits give way to plain text: copying, searching and screen readers see a normal number
      });
      tl.add(t, 0.2);
    });
  }

  /* ---------- grafici ---------- */
  function animaGrafici(view, tl) {
    var barre = view.querySelectorAll('.chart .bar');
    if (barre.length) tl.add(G.from(barre, { scaleY: 0, transformOrigin: '50% 100%', duration: 0.95, ease: 'back.out(1.25)', stagger: 0.035, clearProps: 'transform' }), 0.15);
    var orizz = view.querySelectorAll('.hbar .ht i');
    if (orizz.length) tl.add(G.from(orizz, { scaleX: 0, transformOrigin: '0% 50%', duration: 0.9, stagger: 0.06, clearProps: 'transform' }), 0.2);
    [].forEach.call(view.querySelectorAll('.chart .fetta'), function (f, i) {
      var da = (f.getAttribute('stroke-dasharray') || '').split(' ');
      if (da.length < 2) return;
      tl.add(G.fromTo(f, { attr: { 'stroke-dasharray': '0 ' + da[1] } }, { attr: { 'stroke-dasharray': da[0] + ' ' + da[1] }, duration: 1, ease: 'power2.out' }), 0.2 + i * 0.12);
    });
  }

  /* ---------- ingresso della pagina ---------- */
  /** Called after every drawing of the page. The animation plays only when the page itself changed (chiave), not after a save or a filter. */
  M.entra = sicuro('entra', function (view, chiave) {
    var nuova = chiave !== M.chiave;
    M.chiave = chiave;
    html.setAttribute('data-entrata', 'fine');
    if (!nuova) { return; }
    this.pulisci();
    if (!G || !pieno() || doc.hidden) return;
    html.setAttribute('data-entrata', 'in-corso');
    var tl = M.tl = G.timeline({ onComplete: function () { html.setAttribute('data-entrata', 'fine'); } });
    M.ctx = G.context(function () {
      var figli = [].slice.call(view.children).filter(function (e) { return e.nodeType === 1 && !e.hidden; }).slice(0, 40), h = root.innerHeight || 800, dentro = [], sotto = [];
      figli.forEach(function (e) { (e.getBoundingClientRect().top < h * 0.96 ? dentro : sotto).push(e); });
      // below the fold: dimmed (opacity only, so they stay reachable by keyboard and tools) until they scroll into view
      if (ST && sotto.length) G.set(sotto, { opacity: 0, y: 30, filter: 'blur(8px)' });
      // the whole entrance lasts about a second however many blocks the page has: the delay between blocks is shared out (stagger.amount)
      if (dentro.length) tl.add(G.from(dentro, { opacity: 0, y: 22, filter: 'blur(10px)', duration: 0.6, stagger: { amount: Math.min(0.4, 0.06 * dentro.length) }, clearProps: 'opacity,transform,filter' }), 0);
      if (ST && sotto.length) ST.batch(sotto, { start: 'top 95%', once: true, onEnter: function (b) { G.to(b, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.6, stagger: { amount: Math.min(0.3, 0.07 * b.length) }, overwrite: true, clearProps: 'opacity,transform,filter' }); } });
      G.delayedCall(7, function () { sotto.forEach(function (e) { if (e.style.opacity === '0') G.set(e, { clearProps: 'opacity,transform,filter' }); }); }); // safety net: nothing stays hidden
      animaNumeri(view, tl);
      animaGrafici(view, tl);
      if (ST) G.delayedCall(0.6, function () { ST.refresh(); });
    });
    if (M.lenis) M.lenis.scrollTo(0, { immediate: true, force: true });
  });

  /* ---------- luce che segue il puntatore (idea: "SpotlightCard") ---------- */
  M.decora = sicuro('decora', function (view) {
    var fine = !!puntatoreFine && puntatoreFine.matches;
    [].forEach.call(view.querySelectorAll('.tile,.card'), function (e) { e.classList.toggle('spot', pieno() && fine); });
  });
  function alPuntatore(e) {
    if (!pieno() || e.pointerType === 'touch') return;
    var t = e.target && e.target.closest ? e.target.closest('.spot') : null;
    if (M.ultimaLuce && M.ultimaLuce !== t) M.ultimaLuce.style.setProperty('--sp', '0');
    M.ultimaLuce = t;
    if (t) {
      var r = t.getBoundingClientRect();
      t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px'); t.style.setProperty('--sp', '1');
    }
  }
  doc.addEventListener('pointermove', alPuntatore, { passive: true });
  html.addEventListener('mouseleave', function () { if (M.ultimaLuce) M.ultimaLuce.style.setProperty('--sp', '0'); });

  /* ---------- menu a sinistra: la pillola bianca scivola da una voce all'altra ---------- */
  M.menu = sicuro('menu', function (nav) {
    var pill = doc.createElement('span'), att = nav.querySelector('a[aria-current="page"]:not(.nav-sub)');
    pill.className = 'nav-pill';
    nav.insertBefore(pill, nav.firstChild);
    if (!G || !pieno() || !att || !att.offsetHeight) { M.pillPos = null; return; }
    var a = { top: att.offsetTop, height: att.offsetHeight }; // the sides come from the stylesheet (it follows the narrow menu too)
    if (M.pillPos) G.fromTo(pill, { top: M.pillPos.top, height: M.pillPos.height }, { top: a.top, height: a.height, duration: 0.55, ease: 'power3.inOut' });
    else G.set(pill, { top: a.top, height: a.height });
    M.pillPos = a;
  });

  /* ---------- avviso a comparsa ---------- */
  M.avviso = sicuro('avviso', function (t) {
    if (!pieno()) return;
    G.fromTo(t, { y: 26, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: 'back.out(1.7)', clearProps: 'transform,opacity' });
  });

  /* ---------- per i test e per il programma ---------- */
  M.fine = function () { return html.getAttribute('data-entrata') === 'fine'; };
  M.attivo = function () { return pieno(); };
  M.lenisAttivo = function () { return !!M.lenis; };

  root.addEventListener('gymart:aspetto', function () { M.aggiorna(); });
  root.addEventListener('resize', function () { if (G) { if (vuoleLenis()) avviaLenis(); else fermaLenis(); } }, { passive: true });
  if (doc.fonts && doc.fonts.ready && ST) doc.fonts.ready.then(function () { ST.refresh(); });
  root.Movimento = M;
  html.setAttribute('data-entrata', 'fine');
  M.aggiorna();
})(window);
