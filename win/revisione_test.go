package main

// Prove delle correzioni della revisione del 24/11/2026: ognuna fallisce con il codice di prima.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// Tante password sbagliate mandate nello stesso momento non superano il limite dei tentativi.
func TestLoginTuttiInsiemeNonSuperanoIlLimite(t *testing.T) {
	_, h := reteServer(t)
	const n = 30
	var wg sync.WaitGroup
	codici := make(chan int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codici <- login(t, h, "sbagliata"+strconv.Itoa(i)).StatusCode
		}(i)
	}
	wg.Wait()
	close(codici)
	conta := map[int]int{}
	for c := range codici {
		conta[c]++
	}
	if conta[401] != maxFails || conta[429] != n-maxFails {
		t.Fatalf("controllate %d password (al massimo %d), fermate %d: %v", conta[401], maxFails, conta[429], conta)
	}
}

// Prima del login non si accetta un corpo grande: basta una password.
func TestLoginCorpoGrandeRifiutato(t *testing.T) {
	_, h := reteServer(t)
	corpo := `{"password":"` + strings.Repeat("a", 8<<10) + `"}`
	if r := do(h, rcall("POST", "/login", corpo)); r.StatusCode != 400 {
		t.Fatalf("corpo di 8 KB: %d", r.StatusCode)
	}
}

// L'elenco degli indirizzi con password sbagliate non cresce per sempre, ma chi sta aspettando continua ad aspettare.
func TestIndirizziSbagliatiNonCresconoPerSempre(t *testing.T) {
	srv, _ := reteServer(t)
	r := srv.rete
	for i := 0; i < maxFails; i++ {
		r.Fallito("10.9.9.9")
	}
	for i := 0; i < maxIndirizziSbagliati+50; i++ {
		r.Fallito("10.1." + strconv.Itoa(i/250) + "." + strconv.Itoa(i%250))
	}
	if len(r.fails) > maxIndirizziSbagliati {
		t.Fatalf("elenco di %d indirizzi", len(r.fails))
	}
	if r.Attesa("10.9.9.9") <= 0 {
		t.Fatal("l'indirizzo che doveva aspettare è stato dimenticato")
	}
}

// Le sessioni scadute non contano tra i dispositivi collegati.
func TestStatoNonContaLeSessioniScadute(t *testing.T) {
	srv, _ := reteServer(t)
	now := srv.rete.now()
	srv.rete.mu.Lock()
	srv.rete.sessions["vecchia"] = now.Add(-time.Minute)
	srv.rete.sessions["buona"] = now.Add(time.Hour)
	srv.rete.mu.Unlock()
	if n := srv.rete.Stato().Sessioni; n != 1 {
		t.Fatalf("dispositivi collegati: %d", n)
	}
}

// Una pagina di un altro sito non può far aprire finestre al programma; il secondo avvio del programma sì.
func TestApriRifiutaUnAltroSito(t *testing.T) {
	srv, h := newTestServer(t)
	aperte := 0
	srv.openWindow = func() { aperte++ }
	req := httptest.NewRequest("GET", "/__apri", nil)
	req.RemoteAddr, req.Host = "127.0.0.1:50000", testHost
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden || aperte != 0 {
		t.Fatalf("da un altro sito: %d, finestre %d", rec.Code, aperte)
	}
	do(h, call{method: "GET", target: "/__apri"})
	if aperte != 1 {
		t.Fatal("il secondo avvio del programma non apre più la finestra")
	}
}

// Con l'archivio protetto e non ancora aperto, i certificati scansionati non escono.
func TestDocumentoConArchivioChiuso(t *testing.T) {
	_, dir := protectedStore(t)
	static := fstest.MapFS{"index.html": {Data: []byte(`<meta name="gymart-token" content="__TOKEN__">`)}}
	srv, err := NewServer(mustOpen(t, dir), static, testHost, testToken, "prova")
	if err != nil {
		t.Fatal(err)
	}
	if !srv.store.Locked() {
		t.Fatal("l'archivio doveva essere chiuso")
	}
	r := do(srv.Handler(), call{method: "GET", target: "/api/documento/doc-0001-20261124-1.pdf?t=" + testToken})
	if r.StatusCode != 423 {
		t.Fatalf("documento con l'archivio chiuso: %d", r.StatusCode)
	}
}

// Se il canale cambia mentre si scarica, il file scaricato non diventa «pronto da installare».
func TestScaricaCanaleCambiatoNelFrattempo(t *testing.T) {
	exe := programmaFinto(3)
	m := manifestoDi("1.5.0", exe)
	var a *Aggiornamenti
	mux := http.NewServeMux()
	mux.HandleFunc("/aggiornamento.json", func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(m) })
	var s *httptest.Server
	mux.HandleFunc("/"+m.File, func(w http.ResponseWriter, r *http.Request) {
		altro := s.URL + "/un-altro-canale/"
		if err := a.Imposta(nil, &altro); err != nil {
			t.Errorf("cambio del canale: %v", err)
		}
		w.Write(exe)
	})
	s = httptest.NewServer(mux)
	defer s.Close()
	a, prog := nuovoAgg(t, s.URL+"/")
	if _, err := a.Controlla(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := a.Scarica(t.Context()); err == nil {
		t.Fatal("scaricato dal canale di prima come se niente fosse")
	}
	if st := a.Stato(); st.Fase == "pronto" {
		t.Fatalf("pronto da installare dopo il cambio di canale: %+v", st)
	}
	if _, err := os.Stat(prog + suffissoNuovo); err == nil {
		t.Fatal("il file del canale di prima è rimasto sul disco")
	}
}
