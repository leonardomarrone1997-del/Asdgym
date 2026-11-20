package main

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// diarioProva dà un diario in una cartella nuova, con un orologio che si muove solo quando lo si muove, e lo rende il diario del programma.
func diarioProva(t *testing.T) (*Diario, *time.Time) {
	t.Helper()
	d := ApriDiario(t.TempDir())
	ora := time.Date(2026, 11, 20, 10, 0, 0, 0, time.Local)
	d.adesso = func() time.Time { return ora }
	prima := ImpostaDiario(d)
	t.Cleanup(func() { ImpostaDiario(prima) })
	return d, &ora
}

func TestRipulisciTesto(t *testing.T) {
	casi := []struct{ in, vuole, nonVuole string }{
		{"Codice RSSMRA10A41A515X e basta", "[codice fiscale]", "RSSMRA10A41A515X"},
		{"codice minuscolo rssmra10a41a515x qui", "[codice fiscale]", "rssmra10a41a515x"},
		{"omocodia RSSMRA10A41A51LX ok", "[codice fiscale]", "A51LX"},
		{"scrivi a paolo.rossi+gym@example.co.uk subito", "[e-mail]", "paolo.rossi"},
		{"conto IT60X0542811101000000123456 intestato", "[IBAN]", "0542811101"},
		{"conto IT60 X054 2811 1010 0000 0123 456 intestato", "[IBAN]", "2811"},
		{"telefono 3331234567 poi", "[numero]", "3331234567"},
		{"telefono +39 333 1234567 poi", "[numero]", "1234567"},
		{`apri C:\Users\Mario Rossi\Documents\Gym Art Segreteria\archivio.json: negato`, `C:\Users\<utente>\Documents`, "Mario"},
		{"apri /home/mario/dati/archivio.json: negato", "/home/<utente>/dati", "mario"},
		{"GET /api/logo?t=0123456789abcdef0123456789abcdef: no", "?t=[…]", "0123456789abcdef"},
		{"a\nb\r\nc\td", "a b c d", "\n"},
		{"fine\n2026-11-20 10:00:00 | ERRORE | falso | finta voce", "fine 2026-11-20 10:00:00 | ERRORE | falso | finta voce", "\n"},
		{"inver\u202Esa e\u200Bnascosto \u2028 riga", "inver sa e nascosto riga", "\u202E"},
		{"byte \xff\xfe rotti", "byte ? rotti", "\xff"},
		{"data 2026-11-20 e 20/11/2026 restano", "2026-11-20 e 20/11/2026", "[numero]"},
		{"porta 47815 e rev 12345678", "47815 e rev 12345678", "[numero]"},
	}
	for _, c := range casi {
		got := ripulisciTesto(c.in, 700)
		if !strings.Contains(got, c.vuole) {
			t.Errorf("%q → %q: manca %q", c.in, got, c.vuole)
		}
		if c.nonVuole != "" && strings.Contains(got, c.nonVuole) {
			t.Errorf("%q → %q: c'è ancora %q", c.in, got, c.nonVuole)
		}
		if strings.ContainsAny(got, "\r\n\t") {
			t.Errorf("%q → %q: ha ancora un a capo", c.in, got)
		}
	}
	if got := ripulisciTesto(strings.Repeat("è", 2000), 50); len([]rune(got)) != 50 || !strings.HasSuffix(got, "…") {
		t.Errorf("troncamento: %d caratteri (%q)", len([]rune(got)), got[len(got)-6:])
	}
}

func TestDiarioScriveERilegge(t *testing.T) {
	d, ora := diarioProva(t)
	logInfo("avvio", "versione %s", "1.22.0")
	*ora = ora.Add(5 * time.Second)
	logAvviso("copie", "una cosa strana")
	*ora = ora.Add(5 * time.Second)
	logErrore("Salvataggio Dati!", "non riesco a scrivere %s", "il file")

	voci := d.Voci(10)
	if len(voci) != 3 {
		t.Fatalf("voci: %d (%v)", len(voci), voci)
	}
	// dalla più recente
	if voci[0].Livello != "ERRORE" || voci[0].Dove != "salvataggiodati" || voci[0].Testo != "non riesco a scrivere il file" || voci[0].Quando != "2026-11-20 10:00:10" {
		t.Errorf("ultima voce: %+v", voci[0])
	}
	if voci[2].Livello != "INFO" || voci[2].Dove != "avvio" {
		t.Errorf("prima voce: %+v", voci[2])
	}
	raw, _ := os.ReadFile(d.path)
	if got := strings.Count(string(raw), "\n"); got != 3 {
		t.Errorf("righe nel file: %d\n%s", got, raw)
	}
	e, a := d.Conteggio(ora.Add(-time.Hour))
	if e != 1 || a != 1 {
		t.Errorf("conteggio: %d errori, %d avvisi", e, a)
	}
	if e, a = d.Conteggio(ora.Add(time.Hour)); e != 0 || a != 0 {
		t.Errorf("conteggio nel futuro: %d, %d", e, a)
	}
	if got := d.Testo(2); strings.Count(got, "\n") != 1 || !strings.Contains(got, "salvataggiodati") {
		t.Errorf("Testo(2): %q", got)
	}
}

// Una voce ostile non può fingersi due voci, né nascondere il resto, né portare dati delle persone.
func TestDiarioVoceOstile(t *testing.T) {
	d, _ := diarioProva(t)
	logErrore("pagina", "falla\n2026-11-20 10:00:00 | ERRORE | finto | scritto da un altro\r\n\x00\x1b[31mrosso paolo@example.com RSSMRA10A41A515X 3331234567")
	voci := d.Voci(10)
	if len(voci) != 1 {
		t.Fatalf("una voce ostile ne ha fatte %d: %+v", len(voci), voci)
	}
	for _, v := range voci {
		for _, no := range []string{"paolo@example.com", "RSSMRA10A41A515X", "3331234567", "\x1b", "\x00"} {
			if strings.Contains(v.Testo, no) {
				t.Errorf("la voce contiene %q: %q", no, v.Testo)
			}
		}
	}
	raw, _ := os.ReadFile(d.path)
	if strings.Count(string(raw), "\n") != 1 {
		t.Errorf("il file ha più di una riga: %q", raw)
	}
}

func TestDiarioPercorsi(t *testing.T) {
	d, _ := diarioProva(t)
	d.casa = `C:\Users\Mario Rossi`
	d.dir = `C:\Users\Mario Rossi\Documents\Gym Art Segreteria`
	logErrore("copie", `non riesco a scrivere %s\archivio.json e %s\Desktop\x.txt`, d.dir, d.casa)
	v := d.Voci(1)[0]
	if strings.Contains(v.Testo, "Mario") || !strings.Contains(v.Testo, `<dati>\archivio.json`) || !strings.Contains(v.Testo, `~\Desktop\x.txt`) {
		t.Errorf("percorsi: %q", v.Testo)
	}
	if got := d.percorso(d.dir); got != `~\Documents\Gym Art Segreteria` {
		t.Errorf("percorso(): %q", got)
	}
}

func TestDiarioRotazione(t *testing.T) {
	d, ora := diarioProva(t)
	d.max = 2000
	for i := 0; i < 60; i++ {
		*ora = ora.Add(time.Second)
		logInfo("prova", "voce numero %d con un po' di testo per fare peso", i)
	}
	for _, p := range []string{d.path, d.vecchio()} {
		fi, err := os.Stat(p)
		if err != nil {
			t.Fatalf("manca %s: %v", filepath.Base(p), err)
		}
		if fi.Size() > 2000 {
			t.Errorf("%s è grande %d: oltre il limite", filepath.Base(p), fi.Size())
		}
	}
	voci := d.Voci(1000)
	if len(voci) < 20 || voci[0].Testo != "voce numero 59 con un po' di testo per fare peso" {
		t.Errorf("voci lette: %d, la più recente %q", len(voci), voci[0].Testo)
	}
	// l'ordine non si rompe passando da un file all'altro
	for i := 1; i < len(voci); i++ {
		if voci[i].Quando > voci[i-1].Quando {
			t.Fatalf("voci fuori ordine: %q dopo %q", voci[i].Quando, voci[i-1].Quando)
		}
	}
	if _, err := os.Stat(filepath.Join(d.dir, "diario-tecnico.2.log")); err == nil {
		t.Error("c'è un terzo file")
	}
}

func TestDiarioVociUgualiDiFila(t *testing.T) {
	d, ora := diarioProva(t)
	for i := 0; i < 10; i++ {
		*ora = ora.Add(time.Minute)
		logAvviso("seconda-copia", "la cartella non risponde")
	}
	if n := len(d.Voci(100)); n != 1 {
		t.Fatalf("dieci voci uguali ne hanno scritte %d", n)
	}
	logInfo("seconda-copia", "di nuovo a posto")
	voci := d.Voci(100)
	if len(voci) != 3 || !strings.Contains(voci[1].Testo, "ripetuta altre 9 volte") || voci[1].Livello != "AVVISO" {
		t.Fatalf("dopo un'altra voce: %+v", voci)
	}
	// una voce che torna dopo un'ora si riscrive, con il conto
	for i := 0; i < 3; i++ {
		*ora = ora.Add(time.Minute)
		logAvviso("rete", "porta occupata")
	}
	*ora = ora.Add(2 * time.Hour)
	logAvviso("rete", "porta occupata")
	v := d.Voci(1)[0]
	if v.Testo != "porta occupata (ripetuta altre 3 volte)" {
		t.Errorf("voce dopo un'ora: %q", v.Testo)
	}
	// Chiudi scrive il conto in sospeso
	logAvviso("rete", "porta occupata")
	logAvviso("rete", "porta occupata")
	d.Chiudi()
	if v := d.Voci(1)[0]; !strings.Contains(v.Testo, "ripetuta altre 2 volte") {
		t.Errorf("dopo Chiudi: %q", v.Testo)
	}
}

func TestDiarioLimiteAlMinuto(t *testing.T) {
	d, ora := diarioProva(t)
	for i := 0; i < 500; i++ {
		logInfo("pagina", "voce diversa %d", i)
	}
	if n := len(d.Voci(1000)); n != diarioAlMinuto {
		t.Fatalf("in un minuto si sono scritte %d voci (il limite è %d)", n, diarioAlMinuto)
	}
	*ora = ora.Add(2 * time.Minute)
	logInfo("avvio", "dopo il minuto")
	voci := d.Voci(1000)
	if len(voci) != diarioAlMinuto+2 || !strings.Contains(voci[1].Testo, "380 voci non scritte") {
		t.Fatalf("voci: %d, penultima %+v", len(voci), voci[1])
	}
}

func TestDiarioNonRompeMai(t *testing.T) {
	var nullo *Diario
	nullo.scrivi("INFO", "x", "y")
	nullo.Chiudi()
	if nullo.Voci(5) == nil || len(nullo.Voci(5)) != 0 || nullo.Testo(5) != "" {
		t.Error("il diario nullo deve rispondere a vuoto")
	}
	ImpostaDiario(nil)
	logErrore("avvio", "senza diario: niente succede")

	// la cartella è un file: non si può scrivere, e non si insiste a ogni voce
	dir := t.TempDir()
	file := filepath.Join(dir, "file")
	os.WriteFile(file, []byte("x"), 0o600)
	d := ApriDiario(filepath.Join(file, "sotto"))
	ora := time.Now()
	d.adesso = func() time.Time { return ora }
	d.scrivi("ERRORE", "x", "non si scrive")
	if !d.riprovaDa.After(ora) {
		t.Error("dopo un errore di scrittura il diario deve aspettare prima di riprovare")
	}
	if len(d.Voci(5)) != 0 {
		t.Error("niente da leggere")
	}
}

func TestDiarioConcorrente(t *testing.T) {
	d, ora := diarioProva(t)
	var wg sync.WaitGroup
	for g := 0; g < 12; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 8; i++ {
				logErrore("lavoro", "gruppo %d voce %d", g, i)
				d.Voci(5)
			}
		}(g)
	}
	wg.Wait()
	_ = ora
	if n := len(d.Voci(1000)); n != 96 {
		t.Errorf("voci scritte: %d, attese 96", n)
	}
}

func mappaNulla() map[string]int { return nil }

func TestRecuperaPanic(t *testing.T) {
	d, _ := diarioProva(t)
	func() {
		defer recuperaPanic("lavoro")
		m := mappaNulla()
		m["x"] = 1 // panico: scrittura in una mappa nulla
	}()
	v := d.Voci(1)
	if len(v) != 1 || v[0].Livello != "ERRORE" || v[0].Dove != "lavoro" || !strings.Contains(v[0].Testo, "errore imprevisto") || !strings.Contains(v[0].Testo, "nil map") {
		t.Fatalf("voce del panico: %+v", v)
	}
	if !strings.Contains(v[0].Testo, "diario_test.go:") || !strings.Contains(v[0].Testo, "TestRecuperaPanic") {
		t.Errorf("la voce dovrebbe dire da dove viene: %q", v[0].Testo)
	}
}

func TestDettaglioPS(t *testing.T) {
	b64 := base64.StdEncoding.EncodeToString([]byte("Eccezione dall'HRESULT: 0x80210015 [0x80210015]"))
	casi := map[string]string{
		"":                           "nessun dettaglio",
		"  \n ":                      "nessun dettaglio",
		b64:                          "Eccezione dall'HRESULT: 0x80210015 [0x80210015]",
		"rumore\n" + b64 + "\n":      "Eccezione dall'HRESULT: 0x80210015 [0x80210015]",
		"non è base64!":              "non è base64!",
		"vecchio\nultima riga vera ": "ultima riga vera",
	}
	for in, vuole := range casi {
		if got := dettaglioPS(in); got != vuole {
			t.Errorf("dettaglioPS(%q) = %q, voluto %q", in, got, vuole)
		}
	}
}

/* ---------- le richieste ---------- */

func TestDiarioDelleRichieste(t *testing.T) {
	d, _ := diarioProva(t)
	srv, _ := newTestServer(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/rotta/panico", func(w http.ResponseWriter, r *http.Request) { var p *Server; _ = p.version })
	mux.HandleFunc("/rotta/cinquecento", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "non riesco a scrivere il file"})
	})
	mux.HandleFunc("/rotta/conflitto", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusConflict, map[string]any{"errore": "modificato da un'altra finestra"})
	})
	mux.HandleFunc("/rotta/bene", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ok": true}) })
	mux.HandleFunc("/rotta/non-autorizzato", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "no", http.StatusUnauthorized) })
	h := srv.conDiario(mux)
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec
	}
	if r := get("/rotta/panico?t=0123456789abcdef0123456789abcdef"); r.Code != 500 || !strings.Contains(r.Body.String(), "diario tecnico") {
		t.Errorf("panico: %d %s", r.Code, r.Body.String())
	}
	if r := get("/rotta/cinquecento"); r.Code != 500 {
		t.Errorf("500: %d", r.Code)
	}
	get("/rotta/conflitto")
	get("/rotta/bene")
	get("/rotta/non-autorizzato")
	voci := d.Voci(10)
	if len(voci) != 3 {
		t.Fatalf("voci: %d %+v", len(voci), voci)
	}
	if v := voci[2]; v.Livello != "ERRORE" || !strings.Contains(v.Testo, "errore imprevisto in GET /rotta/panico") || strings.Contains(v.Testo, "0123456789abcdef") {
		t.Errorf("voce del panico: %+v", v)
	}
	if v := voci[1]; v.Livello != "ERRORE" || v.Testo != "GET /rotta/cinquecento: risposta 500: non riesco a scrivere il file" {
		t.Errorf("voce del 500: %+v", v)
	}
	if v := voci[0]; v.Livello != "AVVISO" || !strings.Contains(v.Testo, "risposta 409") {
		t.Errorf("voce del 409: %+v", v)
	}
}

func TestPaginaSegnalaErrori(t *testing.T) {
	d, _ := diarioProva(t)
	_, h := newTestServer(t)
	post := func(corpo string, remote bool) *http.Response {
		return do(h, call{method: "POST", target: "/api/diario", body: corpo, token: testToken, remote: remote})
	}
	corpo := `{"tipo":"errore","messaggio":"Cannot read properties of undefined (reading 'nome') RSSMRA10A41A515X","pila":["salvaX (logic.js:812:15)","vai (app.js:99:3)"],"pagina":"allieva"}`
	// dal computer
	if r := post(corpo, false); r.StatusCode != 204 {
		t.Fatalf("POST dal computer: %d", r.StatusCode)
	}
	v := d.Voci(1)[0]
	if v.Livello != "ERRORE" || v.Dove != "pagina" || !strings.Contains(v.Testo, "reading 'nome'") || !strings.Contains(v.Testo, "pagina «allieva»") || !strings.Contains(v.Testo, "salvaX (logic.js:812:15) < vai (app.js:99:3)") {
		t.Errorf("voce dal computer: %+v", v)
	}
	if strings.Contains(v.Testo, "RSSMRA10A41A515X") {
		t.Errorf("il codice fiscale è arrivato nel diario: %q", v.Testo)
	}
	// da un telefono: serve l'accesso: senza, la rete non è accesa e il guardiano la ferma prima
	if r := post(corpo, true); r.StatusCode != 403 {
		t.Errorf("POST da rete spenta: %d", r.StatusCode)
	}
	// un errore di lettura di un file non si porta dietro il pezzo di testo
	post(`{"tipo":"promessa","messaggio":"Unexpected token 'M', \"Mario Rossi, 3331\" is not valid JSON","pila":[],"pagina":"impostazioni"}`, false)
	if v := d.Voci(1)[0]; strings.Contains(v.Testo, "Mario") || !strings.Contains(v.Testo, "JSON non valido (testo omesso)") || !strings.Contains(v.Testo, "errore non gestito") {
		t.Errorf("errore JSON: %q", v.Testo)
	}
	// corpi sbagliati
	for _, c := range []string{"", "x", "[]", `{"messaggio":5}`, strings.Repeat("a", 20000)} {
		if r := post(c, false); r.StatusCode != 400 && r.StatusCode != 204 && r.StatusCode != 413 {
			t.Errorf("corpo %.20q: %d", c, r.StatusCode)
		}
	}
	// una pagina che si rompe in ciclo non riempie il diario
	n0 := len(d.Voci(1000))
	for i := 0; i < 200; i++ {
		post(fmt.Sprintf(`{"messaggio":"errore %d","pila":[],"pagina":"x"}`, i), false)
	}
	if n := len(d.Voci(1000)) - n0; n > paginaAlMinuto {
		t.Errorf("dopo 200 segnalazioni ci sono %d voci nuove (limite %d)", n, paginaAlMinuto)
	}
}

func TestDiarioGetSoloDalComputer(t *testing.T) {
	_, h := newTestServer(t)
	logAvviso("prova", "una voce")
	if r := do(h, call{method: "GET", target: "/api/diario", token: testToken}); r.StatusCode != 200 {
		t.Errorf("dal computer: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/api/diario", token: testToken, remote: true}); r.StatusCode == 200 {
		t.Errorf("da un altro dispositivo il diario non si deve leggere: %d", r.StatusCode)
	}
	if r := do(h, call{method: "GET", target: "/api/diario"}); r.StatusCode != 401 {
		t.Errorf("senza gettone: %d", r.StatusCode)
	}
}
