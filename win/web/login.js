/* Login page for devices that open the program over the network. */
(function () {
  var f = document.getElementById('f'), p = document.getElementById('p'), msg = document.getElementById('msg'), b = f.querySelector('button');
  function show(t) { msg.textContent = ''; if (!t) return; var n = document.createElement('div'); n.className = 'note note-bad'; n.textContent = t; msg.appendChild(n); }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!p.value) return;
    b.disabled = true; show('');
    fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p.value }) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.ok) { location.replace('/'); return; }
        show(j.errore || 'Non riesco ad accedere.'); b.disabled = false; p.value = ''; p.focus();
      });
    }, function () { show('Il programma sulla segreteria non risponde. Controlla che il computer sia acceso e collegato.'); b.disabled = false; });
  });
})();
