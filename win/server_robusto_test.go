package main

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

// Richieste sbagliate o ostili a tutte le rotte che non toccano la rete né il computer (niente scelta di cartelle, rete, aggiornamenti scaricati,
// chiusura del programma): il programma non deve mai andare in panico, restare appeso o rispondere con un errore del server a una richiesta
// che è semplicemente sbagliata.
func TestServerRobusto(t *testing.T) {
	_, h := newTestServer(t)
	rotte := [][2]string{
		{"GET", "/api/stato"}, {"POST", "/api/salva"}, {"GET", "/api/registro"}, {"POST", "/api/vivo"}, {"POST", "/api/chiudi"},
		{"GET", "/api/sicurezza"}, {"POST", "/api/sicurezza/controlla"}, {"POST", "/api/sicurezza/letto"}, {"GET", "/api/giornaliere"}, {"GET", "/api/giornaliere/archivio"},
		{"POST", "/api/documento"}, {"GET", "/api/documento/x"}, {"DELETE", "/api/documento/x"}, {"GET", "/api/logo"}, {"POST", "/api/logo"}, {"DELETE", "/api/logo"},
		{"GET", "/api/suoni"}, {"POST", "/api/suoni"}, {"GET", "/api/aggiornamenti"}, {"POST", "/api/aggiornamenti/impostazioni"}, {"GET", "/api/copie2"},
		{"GET", "/"}, {"GET", "/login"}, {"POST", "/login"}, {"POST", "/logout"}, {"GET", "/certificato"}, {"GET", "/app.js"}, {"GET", "/nonesiste"},
	}
	invalidi := string([]byte{0xff, 0xfe, 0xfd, '{', 0x80, '}'})
	corpi := []string{
		"", " ", "{}", "[]", "null", `"x"`, "123", "true", "{", `{"a":`, `{"a":}`, "\x00", "{\x00}", invalidi, `{"db":{}}`, `{"db":null,"rev":-1}`, `{"rev":"x","db":[]}`, `{"rev":1e999}`,
		`{"livello":5}`, `{"suona":["avvio"]}`, `{"canale":"http://127.0.0.1/","automatico":"si"}`, `{"canale":"` + strings.Repeat("a", 100000) + `"}`, `{"password":"` + strings.Repeat("p", 100000) + `"}`,
		strings.Repeat("[", 200000), strings.Repeat(`{"a":`, 100000), `{"` + strings.Repeat("k", 70000) + `":1}`, "%PDF-" + strings.Repeat("x", 100), "\x89PNG\r\n\x1a\n" + strings.Repeat("\x00", 100), "\xff\xd8\xff" + strings.Repeat("\x01", 100),
		"RIFF\x00\x00\x00\x00WEBP", "RIFF", strings.Repeat("\n", 5000),
	}
	query := []string{"", "?limite=-5", "?limite=abc", "?limite=99999999999999999999", "?limite=0", "?nome=../../etc/passwd", "?nome=%00", "?nome=2026-11-19", "?nome=" + strings.Repeat("x", 5000), "?t=%ff%fe", "?id=" + strings.Repeat("y", 3000)}
	percorsi := []string{"/api/documento/..%2f..%2fx", "/api/documento/doc-0000000000000000.pdf", "/api/documento/doc-zzzzzzzzzzzzzzzz.pdf", "/api/documento/", "/api/documento/%00", "/api/documento/doc-0000000000000000.pdf%00.exe",
		"/..%2f..%2fetc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/.git/config", "/index.html", "/segreto.go", "//api/stato", "/api//stato", "/api/stato/", "/api/%73tato"}
	n := 0
	chiama := func(metodo, target, corpo, token string, remote bool) {
		t.Helper()
		n++
		fatto := make(chan struct{})
		var codice int
		go func() {
			defer close(fatto)
			defer func() {
				if p := recover(); p != nil {
					t.Errorf("panico su %s %s (corpo di %d byte): %v", metodo, target[:min(len(target), 60)], len(corpo), p)
				}
			}()
			r := do(h, call{method: metodo, target: target, body: corpo, token: token, remote: remote})
			codice = r.StatusCode
			r.Body.Close()
		}()
		select {
		case <-fatto:
		case <-time.After(20 * time.Second):
			t.Fatalf("%s %s non risponde (corpo di %d byte)", metodo, target[:min(len(target), 60)], len(corpo))
		}
		if codice >= 500 && codice != 501 && codice != 503 { // 501 e 503: scanner, mirror e simili che qui non ci sono
			t.Errorf("%s %s (corpo di %d byte): errore del server %d invece di un rifiuto", metodo, target[:min(len(target), 60)], len(corpo), codice)
		}
	}
	for _, r := range rotte {
		for _, c := range corpi {
			for _, tok := range []string{testToken, "", "sbagliato"} {
				chiama(r[0], r[1], c, tok, false)
			}
		}
		for _, q := range query {
			chiama(r[0], r[1]+q, "{}", testToken, false)
		}
	}
	for _, p := range percorsi {
		for _, m := range []string{"GET", "POST", "DELETE", "PUT", "OPTIONS", "HEAD"} {
			chiama(m, p, "", testToken, false)
			chiama(m, p, "", "", true) // da un altro dispositivo, senza accesso
		}
	}
	for _, m := range []string{"PATCH", "PUT", "TRACE", "CONNECT", "FOO"} {
		for _, r := range rotte {
			chiama(m, r[1], "{}", testToken, false)
		}
	}
	t.Logf("%d richieste ostili: nessun panico, nessun errore del server", n)
	_ = fmt.Sprint()
}
