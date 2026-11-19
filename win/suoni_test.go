package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

// campioni legge un file WAV fatto da sintetizza e controlla l'intestazione.
func campioni(t *testing.T, w []byte) []float64 {
	t.Helper()
	if len(w) < 44 || string(w[0:4]) != "RIFF" || string(w[8:16]) != "WAVEfmt " || string(w[36:40]) != "data" {
		t.Fatalf("intestazione WAV non valida: % x", w[:min(44, len(w))])
	}
	if got := binary.LittleEndian.Uint32(w[4:]); int(got) != len(w)-8 {
		t.Errorf("dimensione RIFF %d, attesa %d", got, len(w)-8)
	}
	if binary.LittleEndian.Uint16(w[20:]) != 1 || binary.LittleEndian.Uint16(w[22:]) != 1 || binary.LittleEndian.Uint32(w[24:]) != suoniRate || binary.LittleEndian.Uint16(w[34:]) != 16 {
		t.Errorf("formato non PCM 16 bit mono a %d Hz", suoniRate)
	}
	if binary.LittleEndian.Uint32(w[28:]) != suoniRate*2 || binary.LittleEndian.Uint16(w[32:]) != 2 {
		t.Errorf("byte al secondo o allineamento sbagliati")
	}
	if got := binary.LittleEndian.Uint32(w[40:]); int(got) != len(w)-44 || got%2 != 0 {
		t.Errorf("dimensione dati %d, attesa %d", got, len(w)-44)
	}
	s := make([]float64, (len(w)-44)/2)
	for i := range s {
		s[i] = float64(int16(binary.LittleEndian.Uint16(w[44+2*i:]))) / 32768
	}
	return s
}

// potenza è l'energia di una frequenza in un tratto di suono (Goertzel).
func potenza(s []float64, f float64) float64 {
	w := 2 * math.Pi * f / suoniRate
	c := 2 * math.Cos(w)
	var s1, s2 float64
	for _, x := range s {
		s0 := x + c*s1 - s2
		s2, s1 = s1, s0
	}
	return s1*s1 + s2*s2 - c*s1*s2
}

func TestSuoniSonoSuoni(t *testing.T) {
	for _, nome := range []string{"avvio", "chiusura"} {
		var picchi []float64
		for _, livello := range []string{"piano", "normale"} {
			w := sintetizza(nome, livello)
			s := campioni(t, w)
			d := durataWAV(w)
			if d < 1200*time.Millisecond || d > 1800*time.Millisecond {
				t.Errorf("%s/%s dura %v: un suono piccolo sta fra 1,2 e 1,8 secondi", nome, livello, d)
			}
			var picco, somma float64
			for _, x := range s {
				picco = math.Max(picco, math.Abs(x))
				somma += x * x
			}
			rms := math.Sqrt(somma / float64(len(s)))
			if math.Abs(picco-livelliSuoni[livello]) > 0.005 {
				t.Errorf("%s/%s ha il picco a %.3f, voluto %.2f", nome, livello, picco, livelliSuoni[livello])
			}
			if picco >= 0.95 {
				t.Errorf("%s/%s è vicino alla saturazione: %.3f", nome, livello, picco)
			}
			if rms < picco/12 {
				t.Errorf("%s/%s è quasi silenzio: rms %.4f, picco %.3f", nome, livello, rms, picco)
			}
			if math.Abs(s[0]) > 0.01 || math.Abs(s[len(s)-1]) > 0.001 {
				t.Errorf("%s/%s non parte o non finisce da zero: %.4f … %.4f (si sentirebbe uno scatto)", nome, livello, s[0], s[len(s)-1])
			}
			for i, x := range s {
				if math.IsNaN(x) || math.IsInf(x, 0) {
					t.Fatalf("%s/%s ha un campione non valido in %d", nome, livello, i)
				}
			}
			if !bytes.Equal(w, sintetizza(nome, livello)) {
				t.Errorf("%s/%s: la stessa richiesta dà byte diversi", nome, livello)
			}
			picchi = append(picchi, picco)
		}
		if picchi[0] >= picchi[1] {
			t.Errorf("%s: «piano» (%.3f) deve essere più basso di «normale» (%.3f)", nome, picchi[0], picchi[1])
		}
	}
	for _, c := range [][2]string{{"avvio", "spento"}, {"avvio", "forte"}, {"altro", "piano"}, {"", ""}} {
		if w := sintetizza(c[0], c[1]); w != nil {
			t.Errorf("sintetizza(%q, %q) deve dare nil", c[0], c[1])
		}
	}
}

// Le note che si sentono sono quelle volute: l'avvio finisce su un sol acuto che sale, la chiusura su un sol più grave che scende.
func TestSuoniNote(t *testing.T) {
	coda := func(nome string) []float64 {
		s := campioni(t, sintetizza(nome, "normale"))
		return s[int(1.0*suoniRate):int(1.5*suoniRate)]
	}
	vicino := func(s []float64, f float64) float64 {
		return math.Max(potenza(s, f), math.Max(potenza(s, f*1.004), potenza(s, f*0.996)))
	}
	a := coda("avvio")
	if vicino(a, 1567.98) < 10*math.Max(potenza(a, 1300), potenza(a, 1850)) {
		t.Errorf("la coda dell'avvio non è sul sol acuto (1568 Hz)")
	}
	c := coda("chiusura")
	if vicino(c, 783.99) < 10*math.Max(potenza(c, 650), potenza(c, 920)) {
		t.Errorf("la coda della chiusura non è sul sol (784 Hz)")
	}
	// l'avvio sale: all'inizio ci sono le note basse, alla fine quelle alte; la chiusura fa il contrario
	prima := func(nome string, da, a float64) []float64 {
		s := campioni(t, sintetizza(nome, "normale"))
		return s[int(da*suoniRate):int(a*suoniRate)]
	}
	av1, av2 := prima("avvio", 0.30, 0.40), prima("avvio", 0.62, 0.72)
	if potenza(av1, 783.99) < 3*potenza(av1, 1567.98) || potenza(av2, 1567.98) < 3*potenza(av2, 783.99) {
		t.Errorf("l'avvio non sale dal sol al sol acuto")
	}
	ch1, ch2 := prima("chiusura", 0.00, 0.10), prima("chiusura", 0.50, 0.60)
	if potenza(ch1, 1567.98) < 3*potenza(ch1, 783.99) || potenza(ch2, 783.99) < 3*potenza(ch2, 1567.98) {
		t.Errorf("la chiusura non scende dal sol acuto al sol")
	}
}

func TestSuoniScelta(t *testing.T) {
	dir := t.TempDir()
	s := ApriSuoni(dir, nil, false)
	if s.Livello() != "piano" {
		t.Errorf("senza scelta fatta vale «piano», non %q", s.Livello())
	}
	for _, l := range []string{"forte", "", "PIANO", "piano "} {
		if err := s.Imposta(l); err == nil {
			t.Errorf("la scelta %q doveva essere rifiutata", l)
		}
	}
	if s.Livello() != "piano" {
		t.Errorf("una scelta rifiutata ha cambiato qualcosa: %q", s.Livello())
	}
	for _, l := range []string{"normale", "spento", "piano"} {
		if err := s.Imposta(l); err != nil {
			t.Fatalf("scelta %q: %v", l, err)
		}
		if got := ApriSuoni(dir, nil, false).Livello(); got != l {
			t.Errorf("dopo la scelta %q il programma, riaperto, ha %q", l, got)
		}
	}
	if runtime.GOOS != "windows" {
		if fi, err := os.Stat(filepath.Join(dir, suoniFile)); err != nil || fi.Mode().Perm() != 0o600 {
			t.Errorf("suoni.json: %v %v", fi, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, suoniFile+".tmp")); err == nil {
		t.Errorf("è rimasto il file temporaneo")
	}
	// un file rovinato, o con una scelta che non esiste, non fa danni: vale «piano»
	for _, contenuto := range []string{"non è json", `{"livello":"fortissimo"}`, `{}`, ""} {
		if err := os.WriteFile(filepath.Join(dir, suoniFile), []byte(contenuto), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := ApriSuoni(dir, nil, false).Livello(); got != "piano" {
			t.Errorf("con il file %q vale %q, non «piano»", contenuto, got)
		}
	}
	var senza *Suoni
	if senza.Livello() != "spento" || senza.Suona("avvio") || senza.Prova() || senza.Imposta("piano") == nil {
		t.Errorf("senza i suoni (nil) non si fa niente")
	}
	senza.Attendi(time.Second) // non deve fermarsi né rompersi
	if senza.Stato()["disponibile"] != false {
		t.Errorf("senza i suoni lo stato dice che si può suonare")
	}
}

// giocatore finge l'audio del sistema: ricorda che cosa ha ricevuto.
type giocatore struct {
	mu     sync.Mutex
	suoni  [][]byte
	errore error
	panico bool
}

func (g *giocatore) suona(w []byte) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.panico {
		panic("audio rotto")
	}
	if g.errore != nil {
		return g.errore
	}
	g.suoni = append(g.suoni, w)
	return nil
}

func (g *giocatore) quanti() int { g.mu.Lock(); defer g.mu.Unlock(); return len(g.suoni) }

// tutti è la copia di quello che ha ricevuto finora (il giocatore può ricevere ancora mentre si guarda).
func (g *giocatore) tutti() [][]byte {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([][]byte(nil), g.suoni...)
}

func (g *giocatore) aspetta(t *testing.T, n int) {
	t.Helper()
	for i := 0; i < 200; i++ {
		if g.quanti() >= n {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("il giocatore ha ricevuto %d suoni, ne servivano %d", g.quanti(), n)
}

func TestSuoniSuona(t *testing.T) {
	g := &giocatore{}
	s := ApriSuoni(t.TempDir(), g.suona, true)
	ora := time.Date(2026, 11, 19, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return ora }

	if s.Suona("sconosciuto") || g.quanti() != 0 || s.Stato()["richieste"].(map[string]int)["sconosciuto"] != 0 {
		t.Errorf("un nome che non esiste non deve suonare né contare")
	}
	if !s.Suona("avvio") || g.quanti() != 1 || !bytes.Equal(g.suoni[0], sintetizza("avvio", "piano")) {
		t.Fatalf("«avvio» a livello piano doveva suonare il suo file (suonati: %d)", g.quanti())
	}
	if s.Suona("avvio") || g.quanti() != 1 {
		t.Errorf("due richieste uguali a distanza di niente sono una sola")
	}
	if !s.Suona("chiusura") || g.quanti() != 2 {
		t.Errorf("un suono diverso parte subito")
	}
	ora = ora.Add(suoniPausa + time.Millisecond)
	if !s.Suona("avvio") || g.quanti() != 3 {
		t.Errorf("passata la pausa il suono riparte")
	}
	if want := ora.Add(durataWAV(g.suoni[2])); !s.fine.Equal(want) {
		t.Errorf("la fine è %v, attesa %v", s.fine, want)
	}
	if r := s.Stato()["richieste"].(map[string]int); r["avvio"] != 3 || r["chiusura"] != 1 {
		t.Errorf("richieste: %v", r)
	}
	// spento: niente suono, ma la richiesta si conta
	if err := s.Imposta("spento"); err != nil {
		t.Fatal(err)
	}
	ora = ora.Add(time.Hour)
	if s.Suona("avvio") || g.quanti() != 3 {
		t.Errorf("con i suoni spenti non si sente niente")
	}
	// normale: un altro file, più forte
	if err := s.Imposta("normale"); err != nil {
		t.Fatal(err)
	}
	if !s.Suona("chiusura") || !bytes.Equal(g.suoni[3], sintetizza("chiusura", "normale")) {
		t.Errorf("a livello normale suona il file normale")
	}
	// l'audio che si rompe non rompe il programma
	ora = ora.Add(time.Hour)
	g.errore = errors.New("nessuna scheda audio")
	if s.Suona("avvio") {
		t.Errorf("un errore dell'audio non è un suono")
	}
	g.errore, g.panico = nil, true
	if s.Suona("avvio") {
		t.Errorf("un panico dell'audio non è un suono")
	}
	g.panico = false
	if !s.Suona("avvio") {
		t.Errorf("dopo un errore l'audio riprova")
	}
	// senza giocatore (altri sistemi)
	s2 := ApriSuoni(t.TempDir(), nil, false)
	if s2.Suona("avvio") || s2.Stato()["disponibile"] != false {
		t.Errorf("senza audio di sistema non suona niente")
	}
}

func TestSuoniAttendi(t *testing.T) {
	g := &giocatore{}
	s := ApriSuoni(t.TempDir(), g.suona, true)
	adesso := time.Now()
	s.now = func() time.Time { return adesso }
	s.Attendi(time.Second) // niente da aspettare
	if !s.Suona("chiusura") {
		t.Fatal("non suona")
	}
	t0 := time.Now()
	s.Attendi(50 * time.Millisecond) // il suono dura più del massimo: si aspetta solo il massimo
	if d := time.Since(t0); d < 100*time.Millisecond || d > 600*time.Millisecond {
		t.Errorf("ha aspettato %v invece del massimo (50 ms) più un margine", d)
	}
	adesso = adesso.Add(5 * time.Second) // il suono è finito
	t0 = time.Now()
	s.Attendi(time.Second)
	if time.Since(t0) > 50*time.Millisecond {
		t.Errorf("aspetta un suono già finito")
	}
}

func TestSuoniProva(t *testing.T) {
	g := &giocatore{}
	s := ApriSuoni(t.TempDir(), g.suona, true)
	var pause []time.Duration
	var mu sync.Mutex
	rilascia := make(chan struct{})
	s.pausa = func(d time.Duration) { mu.Lock(); pause = append(pause, d); mu.Unlock(); <-rilascia }
	if !s.Prova() {
		t.Fatal("la prova non è partita")
	}
	g.aspetta(t, 1)
	if s.Prova() {
		t.Errorf("una seconda prova mentre la prima gira deve essere rifiutata")
	}
	close(rilascia)
	g.aspetta(t, 2)
	ricevuti := g.tutti()
	if !bytes.Equal(ricevuti[0], sintetizza("avvio", "piano")) || !bytes.Equal(ricevuti[1], sintetizza("chiusura", "piano")) {
		t.Errorf("la prova fa sentire prima l'avvio e poi la chiusura")
	}
	mu.Lock()
	if len(pause) != 1 || pause[0] < durataWAV(ricevuti[0]) {
		t.Errorf("fra i due suoni si aspetta almeno la durata del primo: %v", pause)
	}
	mu.Unlock()
	for i := 0; i < 200; i++ { // finita la prova se ne può fare un'altra
		s.mu.Lock()
		fatto := !s.inProva
		s.mu.Unlock()
		if fatto {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.Imposta("spento"); err != nil {
		t.Fatal(err)
	}
	if s.Prova() {
		t.Errorf("con i suoni spenti la prova non suona")
	}
}

func TestSuoniPagina(t *testing.T) {
	srv, h := newTestServer(t)
	// senza i suoni nel programma (come nei test degli altri file): la pagina li vede spenti e non si rompe niente
	r := do(h, call{method: "GET", target: "/api/suoni", token: testToken})
	var st map[string]any
	if r.StatusCode != 200 || json.Unmarshal([]byte(text(r)), &st) != nil || st["livello"] != "spento" || st["disponibile"] != false {
		t.Fatalf("senza suoni: %d %v", r.StatusCode, st)
	}
	if r := do(h, call{method: "POST", target: "/api/suoni", token: testToken, body: `{"suona":"avvio"}`}); r.StatusCode != 200 {
		t.Errorf("suonare senza i suoni deve essere un non-fatto, non un errore: %d", r.StatusCode)
	}

	g := &giocatore{}
	srv.suoni = ApriSuoni(t.TempDir(), g.suona, true)
	post := func(corpo string, c call) *http.Response {
		c.method, c.target, c.token, c.body = "POST", "/api/suoni", testToken, corpo
		return do(h, c)
	}
	if r := do(h, call{method: "GET", target: "/api/suoni"}); r.StatusCode != 401 {
		t.Errorf("senza il gettone: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/api/suoni", token: testToken, remote: true}); r.StatusCode != 403 {
		t.Errorf("dal telefono: %d (i suoni escono dalle casse del computer)", r.StatusCode)
	}
	if r := post(`{"suona":"avvio"}`, call{remote: true}); r.StatusCode != 403 || g.quanti() != 0 {
		t.Errorf("dal telefono non si suona: %d, suonati %d", r.StatusCode, g.quanti())
	}
	if r := post(`{"suona":"avvio"}`, call{origin: "http://altro.example"}); r.StatusCode != 403 || g.quanti() != 0 {
		t.Errorf("da un'altra origine non si suona: %d", r.StatusCode)
	}
	r = post(`{"suona":"avvio"}`, call{})
	if r.StatusCode != 200 || g.quanti() != 1 {
		t.Fatalf("avvio: %d, suonati %d", r.StatusCode, g.quanti())
	}
	if json.Unmarshal([]byte(text(r)), &st) != nil || st["livello"] != "piano" || st["disponibile"] != true {
		t.Errorf("stato dopo l'avvio: %v", st)
	}
	for _, corpo := range []string{`{"suona":"fischio"}`, `{"livello":"fortissimo"}`, `non json`, `{"suona":"avvio","livello":5}`} {
		if r := post(corpo, call{}); r.StatusCode != 400 {
			t.Errorf("%s: %d invece di 400", corpo, r.StatusCode)
		}
	}
	if r := post(`{"livello":"spento"}`, call{}); r.StatusCode != 200 || srv.suoni.Livello() != "spento" {
		t.Errorf("spegnere: %d %q", r.StatusCode, srv.suoni.Livello())
	}
	time.Sleep(suoniPausa + 10*time.Millisecond)
	if post(`{"suona":"chiusura"}`, call{}); g.quanti() != 1 {
		t.Errorf("spenti non suonano")
	}
	post(`{"livello":"normale","suona":"chiusura"}`, call{}) // si cambia e si ascolta in una volta sola
	if g.quanti() != 2 || !bytes.Equal(g.suoni[1], sintetizza("chiusura", "normale")) {
		t.Errorf("cambio e suono insieme: suonati %d", g.quanti())
	}
	srv.suoni.pausa = func(time.Duration) {}
	post(`{"suona":"prova"}`, call{})
	g.aspetta(t, 4)
}

// Chi chiude il programma dal pulsante sente il saluto per intero: il programma non si ferma prima della fine del suono.
func TestChiusuraAspettaIlSaluto(t *testing.T) {
	srv, h := newTestServer(t)
	g := &giocatore{}
	srv.suoni = ApriSuoni(t.TempDir(), g.suona, true)
	if r := do(h, call{method: "POST", target: "/api/suoni", token: testToken, body: `{"suona":"chiusura"}`}); r.StatusCode != 200 {
		t.Fatalf("chiusura: %d", r.StatusCode)
	}
	t0 := time.Now()
	if r := do(h, call{method: "POST", target: "/api/esci-programma", token: testToken}); r.StatusCode != 200 {
		t.Fatalf("esci: %d", r.StatusCode)
	}
	select {
	case <-srv.Done():
		if d, want := time.Since(t0), durataWAV(g.tutti()[0]); d < want-100*time.Millisecond {
			t.Errorf("il programma si è fermato dopo %v, il saluto dura %v", d, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("il programma non si è chiuso")
	}
}

// Chiusa la finestra il programma si ferma da solo, con lo stesso saluto; se una finestra non è mai comparsa non saluta.
func TestChiusuraDellaFinestraSaluta(t *testing.T) {
	for _, vista := range []bool{true, false} {
		srv, _ := newTestServer(t)
		g := &giocatore{}
		srv.suoni = ApriSuoni(t.TempDir(), g.suona, true)
		srv.autoExit = true
		srv.mu.Lock()
		srv.seen = vista
		srv.emptySince = time.Now().Add(-time.Minute) // le finestre sono sparite da un pezzo
		srv.started = time.Now().Add(-time.Hour)
		srv.mu.Unlock()
		t0 := time.Now()
		go srv.Watch()
		select {
		case <-srv.Done():
		case <-time.After(6 * time.Second):
			t.Fatalf("(finestra vista: %v) il programma non si è fermato da solo", vista)
		}
		d := time.Since(t0)
		if vista {
			if g.quanti() != 1 || !bytes.Equal(g.tutti()[0], sintetizza("chiusura", "piano")) {
				t.Errorf("chiusa la finestra il programma doveva salutare (suonati %d)", g.quanti())
			} else if want := durataWAV(g.tutti()[0]); d < want-100*time.Millisecond {
				t.Errorf("il programma si è fermato dopo %v, il saluto dura %v", d, want)
			}
		} else if g.quanti() != 0 {
			t.Errorf("senza una finestra mai comparsa il programma non deve salutare")
		}
	}
}
