package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// un "programma nuovo" finto, della dimensione minima ammessa
func programmaFinto(seme int64) []byte {
	b := make([]byte, minEseguibile+1234)
	rand.New(rand.NewSource(seme)).Read(b)
	copy(b, "MZ")
	return b
}

func manifestoDi(versione string, exe []byte) Manifesto {
	h := sha256.Sum256(exe)
	return Manifesto{Versione: versione, Data: "2026-11-20", Titolo: "Prova", File: "GymArtSegreteria-" + versione + ".exe", Sha256: hex.EncodeToString(h[:]), Dimensione: int64(len(exe)),
		Novita: []Novita{{Titolo: "Una cosa", Testo: "Si può fare questo.", Vai: "impostazioni/aspetto"}}, Correzioni: []string{"Corretto un errore."}}
}

// canaleFinto serve aggiornamento.json e il programma; contatore dei download.
func canaleFinto(t *testing.T, m Manifesto, exe []byte) (*httptest.Server, *int32) {
	t.Helper()
	var scarichi int32
	mux := http.NewServeMux()
	mux.HandleFunc("/aggiornamento.json", func(w http.ResponseWriter, r *http.Request) {
		if ua := r.Header.Get("User-Agent"); !strings.HasPrefix(ua, "GymArtSegreteria/") || strings.Contains(ua, "@") {
			t.Errorf("l'intestazione dice troppo o troppo poco: %q", ua)
		}
		json.NewEncoder(w).Encode(m)
	})
	mux.HandleFunc("/"+m.File, func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&scarichi, 1)
		w.Write(exe)
	})
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s, &scarichi
}

func nuovoAgg(t *testing.T, canale string) (*Aggiornamenti, string) {
	t.Helper()
	dir := t.TempDir()
	a := OpenAggiornamenti(dir, "1.0.0", true)
	a.imp.Canale = canale
	exe := filepath.Join(dir, "GymArtSegreteria.exe")
	if err := os.WriteFile(exe, []byte("programma di prima"), 0o755); err != nil {
		t.Fatal(err)
	}
	a.esegui = func() (string, error) { return exe, nil }
	return a, exe
}

func TestConfrontaVersioni(t *testing.T) {
	for _, c := range []struct {
		a, b string
		r    int
	}{{"1.2.3", "1.2.3", 0}, {"1.10.0", "1.9.9", 1}, {"1.2.3", "1.3.0", -1}, {"2.0.0", "1.99.99", 1}, {"x", "0.0.0", 0}, {"1.0.1", "1.0.0", 1}} {
		if got := confrontaVersioni(c.a, c.b); got != c.r {
			t.Errorf("%s ? %s: %d", c.a, c.b, got)
		}
	}
}

func TestManifestoRifiutaCioCheNonQuadra(t *testing.T) {
	exe := programmaFinto(1)
	buono := manifestoDi("1.5.0", exe)
	if _, err := leggiManifesto(mustJSON(buono)); err != nil {
		t.Fatalf("il manifesto buono non passa: %v", err)
	}
	casi := map[string]func(m *Manifesto){
		"versione":                 func(m *Manifesto) { m.Versione = "1.5" },
		"versione testo":           func(m *Manifesto) { m.Versione = "1.5.0; rm -rf" },
		"file con percorso":        func(m *Manifesto) { m.File = "../GymArtSegreteria-1.5.0.exe" },
		"file altro nome":          func(m *Manifesto) { m.File = "virus.exe" },
		"file di altra versione":   func(m *Manifesto) { m.File = "GymArtSegreteria-1.6.0.exe" },
		"impronta corta":           func(m *Manifesto) { m.Sha256 = "abc" },
		"impronta non esadecimale": func(m *Manifesto) { m.Sha256 = strings.Repeat("z", 64) },
		"troppo piccolo":           func(m *Manifesto) { m.Dimensione = 100 },
		"troppo grande":            func(m *Manifesto) { m.Dimensione = maxEseguibile + 1 },
	}
	for nome, f := range casi {
		m := buono
		f(&m)
		if _, err := leggiManifesto(mustJSON(m)); err == nil {
			t.Errorf("%s: non rifiutato", nome)
		}
	}
	if _, err := leggiManifesto([]byte("non è json")); err == nil {
		t.Error("json rotto accettato")
	}
	// i testi vengono limitati, un indirizzo interno strano viene tolto
	m := buono
	m.Novita = []Novita{{Titolo: strings.Repeat("a", 500), Testo: strings.Repeat("b", 900), Vai: "javascript:alert(1)"}}
	got, err := leggiManifesto(mustJSON(m))
	if err != nil || len([]rune(got.Novita[0].Titolo)) != 120 || len([]rune(got.Novita[0].Testo)) != 400 || got.Novita[0].Vai != "" {
		t.Errorf("limiti: %v %+v", err, got)
	}
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

func TestSoloISitiAmmessi(t *testing.T) {
	a := OpenAggiornamenti(t.TempDir(), "1.0.0", false)
	for _, ok := range []string{"https://raw.githubusercontent.com/x/y/main/a/", "https://github.com/x/y/releases/download/v1/", "https://gymart.github.io/aggiornamenti/"} {
		if c, err := a.validaCanale(ok); err != nil || !strings.HasSuffix(c, "/") {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, no := range []string{"http://raw.githubusercontent.com/x/", "https://example.com/aggiornamenti/", "https://127.0.0.1:8000/", "ftp://github.com/x", "https://user:pw@github.com/x/", "https://github.com/x?y=1", "https://github.com.evil.com/x/", "non un indirizzo"} {
		if _, err := a.validaCanale(no); err == nil {
			t.Errorf("%s: accettato", no)
		}
	}
	// in prova la macchina stessa va bene, in produzione no
	p := OpenAggiornamenti(t.TempDir(), "1.0.0", true)
	if _, err := p.validaCanale("http://127.0.0.1:9999/"); err != nil {
		t.Errorf("prova: %v", err)
	}
	if c, _ := a.validaCanale(""); c != "" {
		t.Errorf("vuoto: %q", c)
	}
}

func TestControllaTrovaSoloLeVersioniPiuNuove(t *testing.T) {
	exe := programmaFinto(2)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	a, _ := nuovoAgg(t, canale.URL+"/")
	got, err := a.Controlla(t.Context())
	if err != nil || got == nil || got.Versione != "1.5.0" {
		t.Fatalf("%v %v", got, err)
	}
	st := a.Stato()
	if st.Disponibile == nil || st.UltimoControllo == "" || st.Errore != "" || st.Fase != "" {
		t.Errorf("stato: %+v", st)
	}
	// già aggiornati: si ha la stessa versione, o una più nuova
	for _, v := range []string{"1.5.0", "2.0.0"} {
		a.versione = v
		if got, err := a.Controlla(t.Context()); err != nil || got != nil {
			t.Errorf("versione installata %s: %v %v", v, got, err)
		}
		if a.Stato().Disponibile != nil {
			t.Error("l'aggiornamento è rimasto in elenco")
		}
	}
}

func TestControllaDiceCosaNonVa(t *testing.T) {
	a, _ := nuovoAgg(t, "http://127.0.0.1:1/") // niente in ascolto
	if _, err := a.Controlla(t.Context()); err == nil {
		t.Fatal("nessun errore")
	}
	st := a.Stato()
	if st.Errore == "" || !strings.Contains(st.Errore, "collegarmi") || st.UltimoControllo != "" {
		t.Errorf("un controllo fallito non conta come fatto: %+v", st)
	}
	if !a.Dovuto() {
		t.Error("dopo un errore si deve riprovare")
	}
	// una risposta che non è un manifesto
	brutto := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>pagina di errore</html>")) }))
	defer brutto.Close()
	a.imp.Canale = brutto.URL + "/"
	if _, err := a.Controlla(t.Context()); err == nil || !strings.Contains(a.Stato().Errore, "non si legge") {
		t.Errorf("html: %v %q", err, a.Stato().Errore)
	}
	// un 404: il canale è ancora vuoto, non un guasto (il controllo conta come fatto e la pagina lo dice)
	vuoto := httptest.NewServer(http.NotFoundHandler())
	defer vuoto.Close()
	a.imp.Canale = vuoto.URL + "/"
	if got, err := a.Controlla(t.Context()); err != nil || got != nil {
		t.Errorf("404: %v %v", got, err)
	}
	if st := a.Stato(); !st.CanaleVuoto || st.Errore != "" || st.UltimoControllo == "" || st.Disponibile != nil {
		t.Errorf("404: %+v", st)
	}
	// e un controllo dopo, con il canale che risponde, toglie la nota
	a.imp.Canale = brutto.URL + "/"
	_, _ = a.Controlla(t.Context())
	if a.Stato().CanaleVuoto {
		t.Error("la nota del canale vuoto è rimasta")
	}
	// una risposta enorme
	enorme := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(strings.Repeat("a", maxManifesto+10))) }))
	defer enorme.Close()
	a.imp.Canale = enorme.URL + "/"
	if _, err := a.Controlla(t.Context()); err == nil {
		t.Error("risposta enorme accettata")
	}
}

func TestScaricaControllaLImpronta(t *testing.T) {
	exe := programmaFinto(3)
	m := manifestoDi("1.5.0", exe)
	canale, scarichi := canaleFinto(t, m, exe)
	a, prog := nuovoAgg(t, canale.URL+"/")
	if err := a.Scarica(t.Context()); err == nil {
		t.Fatal("scaricato senza aver controllato")
	}
	if _, err := a.Controlla(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := a.Scarica(t.Context()); err != nil {
		t.Fatalf("scarica: %v", err)
	}
	st := a.Stato()
	got, err := os.ReadFile(prog + suffissoNuovo)
	if err != nil || len(got) != len(exe) || st.Fase != "pronto" || st.Scaricati != int64(len(exe)) || *scarichi != 1 {
		t.Fatalf("stato %+v, errore %v, scarichi %d", st, err, *scarichi)
	}
	if b, _ := os.ReadFile(prog); string(b) != "programma di prima" {
		t.Fatal("il programma in uso è stato toccato dal download")
	}

	// un file diverso da quello pubblicato (stessa dimensione, altro contenuto): rifiutato e tolto
	cattivo := programmaFinto(99)
	c2, _ := canaleFinto(t, m, cattivo)
	a2, prog2 := nuovoAgg(t, c2.URL+"/")
	a2.Controlla(t.Context())
	if err := a2.Scarica(t.Context()); err == nil || !strings.Contains(a2.Stato().Errore, "non corrisponde") {
		t.Fatalf("impronta diversa accettata: %v", err)
	}
	if _, err := os.Stat(prog2 + suffissoNuovo); err == nil {
		t.Error("il file sbagliato è rimasto sul disco")
	}
	if a2.Stato().Fase != "errore" {
		t.Errorf("fase: %s", a2.Stato().Fase)
	}
	if err := a2.Installa(); err == nil {
		t.Error("installato un file non verificato")
	}
	if b, _ := os.ReadFile(prog2); string(b) != "programma di prima" {
		t.Error("il programma è stato cambiato")
	}
}

func TestScaricaNonSegueReindirizzamentiAdAltriSiti(t *testing.T) {
	exe := programmaFinto(4)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	mux := http.NewServeMux()
	mux.HandleFunc("/aggiornamento.json", func(w http.ResponseWriter, r *http.Request) { json.NewEncoder(w).Encode(m) })
	mux.HandleFunc("/"+m.File, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "http://sito-estraneo.example/virus.exe", http.StatusFound)
	})
	rid := httptest.NewServer(mux)
	defer rid.Close()
	_ = canale
	a, prog := nuovoAgg(t, rid.URL+"/")
	a.Controlla(t.Context())
	err := a.Scarica(t.Context())
	if err == nil || !strings.Contains(a.Stato().Errore, "non è tra quelli ammessi") {
		t.Fatalf("reindirizzamento accettato: %v %q", err, a.Stato().Errore)
	}
	if _, e := os.Stat(prog + suffissoNuovo); e == nil {
		t.Error("file rimasto")
	}
}

func TestInstallaMetteDaParteIlVecchioERiparte(t *testing.T) {
	exe := programmaFinto(5)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	a, prog := nuovoAgg(t, canale.URL+"/")
	var args []string
	var chiuso bool
	a.riavvia = func(e string, ar []string) error {
		if e != prog {
			t.Errorf("riparte un altro file: %s", e)
		}
		if b, _ := os.ReadFile(e); len(b) != len(exe) {
			t.Error("al momento del riavvio il file al suo posto non è quello nuovo")
		}
		args = ar
		return nil
	}
	a.argomenti = func() []string {
		return nuoviArgomenti([]string{"-dati", `C:\Dati Gym`, "-porta", "9", "-senza-finestra"}, 47815, segnoDopoAggiornamento)
	}
	a.chiudi = func() { chiuso = true }
	if err := a.Installa(); err == nil {
		t.Fatal("installa senza download")
	}
	a.Controlla(t.Context())
	if err := a.Scarica(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := a.Installa(); err != nil {
		t.Fatalf("installa: %v", err)
	}
	if b, _ := os.ReadFile(prog + suffissoPrecedente); string(b) != "programma di prima" {
		t.Errorf("il programma di prima non è stato conservato: %q", b)
	}
	if b, _ := os.ReadFile(prog); len(b) != len(exe) {
		t.Error("il programma nuovo non è al suo posto")
	}
	if _, err := os.Stat(prog + suffissoNuovo); err == nil {
		t.Error("il file di appoggio è rimasto")
	}
	if !chiuso || strings.Join(args, " ") != `-dati C:\Dati Gym -senza-finestra -porta 47815 -dopo-aggiornamento` {
		t.Errorf("riavvio: chiuso=%v args=%q", chiuso, args)
	}
}

func TestSeIlProgrammaNuovoNonPartePartitoRestaQuelloDiPrima(t *testing.T) {
	exe := programmaFinto(6)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	a, prog := nuovoAgg(t, canale.URL+"/")
	a.riavvia = func(string, []string) error { return fmt.Errorf("blocco dell'antivirus") }
	var chiuso bool
	a.chiudi = func() { chiuso = true }
	a.Controlla(t.Context())
	a.Scarica(t.Context())
	err := a.Installa()
	if err == nil || !strings.Contains(a.Stato().Errore, "resta quello di prima") {
		t.Fatalf("errore: %v %q", err, a.Stato().Errore)
	}
	if b, _ := os.ReadFile(prog); string(b) != "programma di prima" {
		t.Errorf("il programma di prima non è tornato al suo posto: %d byte", len(b))
	}
	if _, e := os.Stat(prog + suffissoPrecedente); e == nil {
		t.Error("è rimasto un .precedente")
	}
	if chiuso {
		t.Error("il programma si è chiuso senza che quello nuovo fosse partito")
	}
}

func TestNuoviArgomenti(t *testing.T) {
	for _, c := range []struct {
		in   []string
		want string
	}{
		{nil, "-porta 47815 -dopo-aggiornamento"},
		{[]string{"-senza-finestra"}, "-senza-finestra -porta 47815 -dopo-aggiornamento"},
		{[]string{"-porta=0", "-dati", "x"}, "-dati x -porta 47815 -dopo-aggiornamento"},
		{[]string{"--porta", "0", "-dopo-aggiornamento", "-senza-finestra"}, "-senza-finestra -porta 47815 -dopo-aggiornamento"},
		{[]string{"-dopo-installazione", "-dati", "x"}, "-dati x -porta 47815 -dopo-aggiornamento"},
	} {
		if got := strings.Join(nuoviArgomenti(c.in, 47815, segnoDopoAggiornamento), " "); got != c.want {
			t.Errorf("%v: %q", c.in, got)
		}
	}
	// 1.29.0: after an installation the diary must not say «after an update»
	if got := strings.Join(nuoviArgomenti([]string{"-dopo-aggiornamento", "-senza-finestra"}, 47815, segnoDopoInstallazione), " "); got != "-senza-finestra -porta 47815 -dopo-installazione" {
		t.Errorf("installazione: %q", got)
	}
}

func TestLeScelteDellaPersonaSiRicordano(t *testing.T) {
	exe := programmaFinto(7)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	a, _ := nuovoAgg(t, canale.URL+"/")
	ora := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	a.adesso = func() time.Time { return ora }
	if !a.Dovuto() {
		t.Error("mai controllato: è ora")
	}
	a.Controlla(t.Context())
	if a.Dovuto() {
		t.Error("appena controllato")
	}
	ora = ora.Add(13 * time.Hour)
	if !a.Dovuto() {
		t.Error("dopo 13 ore è ora")
	}
	a.Rimanda()
	a.Ignora("1.4.0")
	no := false
	if err := a.Imposta(&no, nil); err != nil {
		t.Fatal(err)
	}
	if a.Dovuto() {
		t.Error("il controllo automatico è spento")
	}
	st := a.Stato()
	if !st.Rimandata || st.Ignorata || st.Automatico {
		t.Errorf("stato: %+v", st)
	}
	a.Ignora("1.5.0")
	if !a.Stato().Ignorata {
		t.Error("la versione saltata non risulta")
	}
	ora = ora.Add(4 * 24 * time.Hour)
	if a.Stato().Rimandata {
		t.Error("dopo 4 giorni il rimando è finito")
	}
	// la riapertura del programma ritrova tutto
	b := OpenAggiornamenti(a.dir, "1.0.0", true)
	b.disp = a.disp
	b.adesso = func() time.Time { return ora }
	if st := b.Stato(); st.Automatico || !st.Ignorata || st.Canale != canale.URL+"/" {
		t.Errorf("dopo la riapertura: %+v", st)
	}
	// un canale non ammesso è rifiutato e non cambia niente
	sbagliato := "https://example.com/x/"
	if err := a.Imposta(nil, &sbagliato); err == nil {
		t.Error("canale estraneo accettato")
	}
	vuoto := ""
	if err := a.Imposta(nil, &vuoto); err != nil || !a.Stato().CanalePredef || a.Stato().Canale != canalePredefinito {
		t.Errorf("ritorno al canale predefinito: %v %+v", err, a.Stato())
	}
}

func TestAggiornamentiOverHTTP(t *testing.T) {
	t.Setenv("GYMART_AGGIORNAMENTI_PROVA", "1")
	exe := programmaFinto(8)
	m := manifestoDi("1.5.0", exe)
	canale, _ := canaleFinto(t, m, exe)
	t.Setenv("GYMART_AGGIORNAMENTI_CANALE", canale.URL+"/")
	srv, h := newTestServer(t)
	dirProg := t.TempDir()
	prog := filepath.Join(dirProg, "GymArtSegreteria.exe")
	os.WriteFile(prog, []byte("vecchio"), 0o755)
	srv.agg.esegui = func() (string, error) { return prog, nil }
	srv.agg.versione = "1.0.0"
	post := func(path, body string, remote bool) *http.Response {
		return do(h, call{method: "POST", target: path, token: testToken, body: body, remote: remote})
	}
	stato := func() StatoAgg {
		var st StatoAgg
		r := do(h, call{method: "GET", target: "/api/aggiornamenti", token: testToken})
		if err := json.Unmarshal([]byte(text(r)), &st); err != nil {
			t.Fatal(err)
		}
		return st
	}
	aspetta := func(cond func(StatoAgg) bool, cosa string) StatoAgg {
		for i := 0; i < 100; i++ {
			if st := stato(); cond(st) {
				return st
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatalf("non è successo: %s (%+v)", cosa, stato())
		return StatoAgg{}
	}
	// dal telefono non si fa niente
	for _, p := range []string{"/api/aggiornamenti/controlla", "/api/aggiornamenti/scarica", "/api/aggiornamenti/installa", "/api/aggiornamenti/impostazioni", "/api/esci-programma"} {
		if r := post(p, "{}", true); r.StatusCode != http.StatusForbidden {
			t.Errorf("%s dal telefono: %d", p, r.StatusCode)
		}
	}
	if r := post("/api/aggiornamenti/scarica", "{}", false); r.StatusCode != http.StatusConflict {
		t.Errorf("scarica senza novità: %d", r.StatusCode)
	}
	post("/api/aggiornamenti/controlla", "{}", false)
	st := aspetta(func(s StatoAgg) bool { return s.Disponibile != nil }, "trovare 1.5.0")
	if st.Disponibile.Versione != "1.5.0" || st.Installabile != true || len(st.Disponibile.Novita) != 1 {
		t.Errorf("stato: %+v", st)
	}
	post("/api/aggiornamenti/scarica", "{}", false)
	aspetta(func(s StatoAgg) bool { return s.Fase == "pronto" }, "scaricare")
	if r := post("/api/aggiornamenti/installa", "{}", false); r.StatusCode != 200 {
		t.Fatalf("installa: %d %s", r.StatusCode, text(r))
	}
	b, _ := os.ReadFile(prog)
	if len(b) != len(exe) {
		t.Error("il programma non è stato sostituito")
	}
	// in prova non parte niente davvero: il sistema scrive cosa avrebbe fatto
	var riavvio struct {
		Exe  string   `json:"exe"`
		Args []string `json:"args"`
	}
	raw, err := os.ReadFile(filepath.Join(srv.store.Dir(), "riavvio-prova.json"))
	if err != nil || json.Unmarshal(raw, &riavvio) != nil || riavvio.Exe != prog {
		t.Errorf("riavvio di prova: %v %s", err, raw)
	}
	// le scelte: rimandare, saltare, spegnere
	if r := post("/api/aggiornamenti/impostazioni", `{"rimanda":true}`, false); r.StatusCode != 200 {
		t.Errorf("rimanda: %d", r.StatusCode)
	}
	if !stato().Rimandata {
		t.Error("non risulta rimandato")
	}
	if r := post("/api/aggiornamenti/impostazioni", `{"ignora":"non una versione"}`, false); r.StatusCode != http.StatusBadRequest {
		t.Errorf("ignora strano: %d", r.StatusCode)
	}
	if r := post("/api/aggiornamenti/impostazioni", `{"canale":"https://example.com/"}`, false); r.StatusCode != http.StatusBadRequest {
		t.Errorf("canale estraneo: %d", r.StatusCode)
	}
	if r := post("/api/aggiornamenti/impostazioni", `{"automatico":false}`, false); r.StatusCode != 200 || stato().Automatico {
		t.Errorf("spegni: %d", r.StatusCode)
	}
}

func TestPaginaEIconeNuove(t *testing.T) {
	// la schermata di avvio e il pulsante di chiusura fanno parte della pagina
	idx, err := os.ReadFile("web/index.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, voce := range []string{`id="avvio"`, `id="chiudi"`, `src="logo.js"`, `id="aiuto"`} {
		if !strings.Contains(string(idx), voce) {
			t.Errorf("index.html non ha %s", voce)
		}
	}
}

func TestEsciProgrammaChiudeSoloDalComputer(t *testing.T) {
	srv, h := newTestServer(t)
	if r := do(h, call{method: "POST", target: "/api/esci-programma", token: testToken, remote: true}); r.StatusCode != http.StatusForbidden {
		t.Errorf("dal telefono: %d", r.StatusCode)
	}
	select {
	case <-srv.Done():
		t.Fatal("il programma si è chiuso su richiesta di un telefono")
	default:
	}
	if r := do(h, call{method: "POST", target: "/api/esci-programma", token: testToken}); r.StatusCode != 200 {
		t.Fatalf("dal computer: %d", r.StatusCode)
	}
	select {
	case <-srv.Done():
	case <-time.After(3 * time.Second):
		t.Fatal("il programma non si è chiuso")
	}
}
