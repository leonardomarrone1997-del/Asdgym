package main

import (
	"net"
	"net/http"
	"strings"
	"testing"
)

// 1.26.2: an exe started while an older version is still open must not just show the old window (the person kept seeing
// the old version after replacing the exe). These tests fail with the code of 1.26.1, where no version was said.

func TestPidInAscolto(t *testing.T) {
	inglese := `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1012
  TCP    127.0.0.1:47815        0.0.0.0:0              LISTENING       7344
  TCP    127.0.0.1:47815        127.0.0.1:50211        ESTABLISHED     7344
  TCP    127.0.0.1:50211        127.0.0.1:47815        ESTABLISHED     9120
`
	if got := pidInAscolto(inglese, 47815); got != 7344 {
		t.Fatalf("English netstat: %d, want 7344", got)
	}
	italiano := strings.ReplaceAll(strings.ReplaceAll(inglese, "LISTENING", "IN ASCOLTO"), "ESTABLISHED", "STABILITA")
	if got := pidInAscolto(italiano, 47815); got != 7344 {
		t.Fatalf("Italian netstat (the state has two words): %d, want 7344", got)
	}
	if got := pidInAscolto(inglese, 47816); got != 0 {
		t.Fatalf("nobody on 47816: %d", got)
	}
	if got := pidInAscolto("  TCP    127.0.0.1:47815        127.0.0.1:50211        ESTABLISHED     9120\n", 47815); got != 0 {
		t.Fatalf("a connection to the port is not the one listening: %d", got)
	}
}

func TestNomeProcesso(t *testing.T) {
	if got := nomeProcesso(`"GymArtSegreteria.exe","7344","Console","1","42.120 K"` + "\r\n"); got != "GymArtSegreteria.exe" {
		t.Fatalf("got %q", got)
	}
	if got := nomeProcesso("INFORMAZIONI: nessuna attività in esecuzione corrispondente ai criteri specificati.\r\n"); got != "" {
		t.Fatalf("no process: got %q", got)
	}
	for nome, ok := range map[string]bool{"GymArtSegreteria.exe": true, "gymartsegreteria (1).exe": true, "GymArtSegreteria-1.25.2.exe": true, "msedge.exe": false, "": false, "svchost.exe": false} {
		if eNostroProgramma(nome) != ok {
			t.Errorf("eNostroProgramma(%q) = %v", nome, !ok)
		}
	}
}

func TestPiuVecchia(t *testing.T) {
	for _, c := range []struct {
		altra, mia string
		vecchia    bool
	}{{"", "1.26.2", true}, {"1.26.1", "1.26.2", true}, {"1.25.2", "1.26.2", true}, {"1.26.2", "1.26.2", false}, {"1.27.0", "1.26.2", false}, {"1.26.10", "1.26.2", false}} {
		if got := piuVecchia(c.altra, c.mia); got != c.vecchia {
			t.Errorf("piuVecchia(%q, %q) = %v", c.altra, c.mia, got)
		}
	}
	if q := testoCopiaVecchia("1.25.2", "1.26.2"); !strings.Contains(q, "la versione 1.25.2") || !strings.Contains(q, "1.26.2?") {
		t.Errorf("the question names both versions: %q", q)
	}
	if q := testoCopiaVecchia("", "1.26.2"); !strings.Contains(q, "una versione precedente") {
		t.Errorf("an old copy that does not say its version: %q", q)
	}
}

// The running program says who it is and its version on every answer; /__versione does not open its window and is not for other devices.
func TestVersioneSenzaAprire(t *testing.T) {
	srv, h := newTestServer(t)
	aperte := 0
	srv.openWindow = func() { aperte++ }
	r := do(h, call{method: "GET", target: "/__versione"})
	if r.StatusCode != http.StatusNoContent || r.Header.Get(appHeader) != "1" || r.Header.Get(versioneHeader) != "prova" {
		t.Fatalf("status %d, headers %v", r.StatusCode, r.Header)
	}
	if aperte != 0 {
		t.Fatal("asking the version opened a window")
	}
	if r := do(h, call{method: "GET", target: "/__versione", remote: true}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("from another device: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/api/stato"}); r.Header.Get(versioneHeader) != "prova" {
		t.Fatal("every answer says the version")
	}
}

// copiaAperta on a real port: this program (with its version), an older one (no version), something else.
func TestCopiaAperta(t *testing.T) {
	serve := func(h http.Handler) int {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		s := &http.Server{Handler: h}
		go s.Serve(ln)
		t.Cleanup(func() { s.Close() })
		return ln.Addr().(*net.TCPAddr).Port
	}
	srv, h := newTestServer(t)
	aperte := 0
	srv.openWindow = func() { aperte++ }
	if nostro, v := copiaAperta(serve(h)); !nostro || v != "prova" || aperte != 0 {
		t.Fatalf("this program: nostro=%v versione=%q finestre=%d", nostro, v, aperte)
	}
	vecchio := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set(appHeader, "1"); http.NotFound(w, r) }) // as 1.25.2 answers an unknown address
	if nostro, v := copiaAperta(serve(vecchio)); !nostro || v != "" || !piuVecchia(v, "1.26.2") {
		t.Fatalf("an older version: nostro=%v versione=%q", nostro, v)
	}
	altro := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	if nostro, _ := copiaAperta(serve(altro)); nostro {
		t.Fatal("another program on the port is not this one")
	}
	if nostro, _ := copiaAperta(1); nostro {
		t.Fatal("nobody on the port")
	}
}
