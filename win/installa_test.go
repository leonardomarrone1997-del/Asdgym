package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDecidiInstallazione(t *testing.T) {
	inst := filepath.Join("C:", "Users", "x", "AppData", "Local", "Programs", "Gym Art Segreteria", nomeEseguibile)
	altro := filepath.Join("C:", "Users", "x", "Desktop", "Gym Art - Copia", nomeEseguibile)
	casi := []struct {
		nome, questo, installato string
		portatile, esiste        bool
		versInst, vers, vuole    string
	}{
		{"fuori da Windows", altro, "", false, false, "", "1.29.0", instNonDisponibile},
		{"gira quello installato", inst, inst, false, true, "1.29.0", "1.29.0", instInstallato},
		{"stesso file, maiuscole diverse", strings.ToUpper(inst), inst, false, true, "1.29.0", "1.29.0", instInstallato},
		{"dati accanto al programma", altro, inst, true, false, "", "1.29.0", instPortatile},
		{"prima volta", altro, inst, false, false, "", "1.29.0", instDaInstallare},
		{"più nuovo di quello installato", altro, inst, false, true, "1.29.0", "1.30.0", instDaAggiornare},
		{"installato senza versione scritta", altro, inst, false, true, "", "1.29.0", instDaAggiornare},
		{"la stessa versione", altro, inst, false, true, "1.29.0", "1.29.0", instGiaInstallato},
		{"più vecchio di quello installato", altro, inst, false, true, "1.30.0", "1.28.0", instPiuVecchia},
	}
	for _, c := range casi {
		if got := decidiInstallazione(c.questo, c.installato, c.portatile, c.esiste, c.versInst, c.vers); got != c.vuole {
			t.Errorf("%s: %s, voluto %s", c.nome, got, c.vuole)
		}
	}
}

type provaInst struct {
	collegamenti, registrati, avvii []string
	ripartenze                      [][]string
	errCollegamenti                 error
}

// installatoreDiProva: an installer on temporary folders, with the parts that touch Windows replaced by notes.
func installatoreDiProva(t *testing.T, dir, versione, contenuto string, p *provaInst) *Installatore {
	t.Helper()
	sorgente := filepath.Join(dir, "scaricato-"+versione, nomeEseguibile)
	if err := os.MkdirAll(filepath.Dir(sorgente), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sorgente, []byte("MZ"+contenuto), 0o755); err != nil {
		t.Fatal(err)
	}
	return &Installatore{exe: sorgente, versione: versione, cartella: filepath.Join(dir, "Programs", cartellaProgramma), locale: filepath.Join(dir, "GymArtSegreteria"),
		adesso:       func() time.Time { return time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC) },
		collegamenti: func(exe string) error { p.collegamenti = append(p.collegamenti, exe); return p.errCollegamenti },
		registra:     func(exe, cartella, v string) error { p.registrati = append(p.registrati, v); return nil },
		avvio:        func(exe string) error { p.avvii = append(p.avvii, exe); return nil },
		riavvia: func(exe string, args []string) error {
			p.ripartenze = append(p.ripartenze, append([]string{exe}, args...))
			return nil
		},
		argomenti: func() []string { return []string{"-porta", "47815", "-dopo-aggiornamento"} }}
}

func TestInstallaAggiornaApri(t *testing.T) {
	dir, p := t.TempDir(), &provaInst{}
	in := installatoreDiProva(t, dir, "1.29.0", "versione 1.29.0", p)
	if st := in.Stato(); st.Stato != instDaInstallare || st.Rifiutata || st.Questo != in.exe {
		t.Fatalf("prima: %+v", st)
	}
	if err := in.ApriInstallato(); err == nil {
		t.Fatal("niente da aprire prima dell'installazione")
	}
	if err := in.Installa(); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(in.cartella, nomeEseguibile)
	if b, err := os.ReadFile(dest); err != nil || string(b) != "MZversione 1.29.0" {
		t.Fatalf("copia: %q %v", b, err)
	}
	var info InfoInstallazione
	if b, err := os.ReadFile(filepath.Join(in.cartella, fileInstallazione)); err != nil || json.Unmarshal(b, &info) != nil || info.Versione != "1.29.0" || info.Installata != "2026-11-27T10:00:00Z" {
		t.Fatalf("info: %+v %v", info, err)
	}
	if len(p.collegamenti) != 1 || p.collegamenti[0] != dest || len(p.registrati) != 1 || len(p.avvii) != 1 || p.avvii[0] != dest {
		t.Fatalf("collegamenti, voce in App, avvio con Windows: %+v", p)
	}
	if len(p.ripartenze) != 1 || strings.Join(p.ripartenze[0], " ") != dest+" -porta 47815 -dopo-aggiornamento" {
		t.Fatalf("riparte da quello installato, sulla stessa porta: %v", p.ripartenze)
	}
	if _, err := os.Stat(dest + ".nuovo"); !os.IsNotExist(err) {
		t.Fatal("nessun file a metà")
	}
	// the same file opened again: the same version is installed, it opens that one
	if st := in.Stato(); st.Stato != instGiaInstallato || st.VersioneInstallata != "1.29.0" {
		t.Fatalf("dopo: %+v", st)
	}
	if err := in.Installa(); err == nil {
		t.Fatal("niente da installare: è già installata")
	}
	// the installed one knows it is itself
	quello := &Installatore{exe: dest, versione: "1.29.0", cartella: in.cartella}
	if st := quello.Stato(); st.Stato != instInstallato {
		t.Fatalf("quello installato: %+v", st)
	}
	// a newer file, downloaded somewhere else: it updates the installed one; the old one stays as «.precedente»
	nuovo := installatoreDiProva(t, dir, "1.30.0", "versione 1.30.0", p)
	if st := nuovo.Stato(); st.Stato != instDaAggiornare || st.VersioneInstallata != "1.29.0" {
		t.Fatalf("più nuovo: %+v", st)
	}
	if err := nuovo.Installa(); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dest); string(b) != "MZversione 1.30.0" {
		t.Fatalf("aggiornato: %q", b)
	}
	if b, _ := os.ReadFile(dest + suffissoPrecedente); string(b) != "MZversione 1.29.0" {
		t.Fatalf("quello di prima resta da parte: %q", b)
	}
	// an older file: it opens the newer installed one
	vecchio := installatoreDiProva(t, dir, "1.28.5", "versione 1.28.5", p)
	if st := vecchio.Stato(); st.Stato != instPiuVecchia || st.VersioneInstallata != "1.30.0" {
		t.Fatalf("più vecchio: %+v", st)
	}
	if err := vecchio.Installa(); err == nil {
		t.Fatal("un programma più vecchio non prende il posto di quello installato")
	}
	n := len(p.ripartenze)
	if err := vecchio.ApriInstallato(); err != nil || len(p.ripartenze) != n+1 || p.ripartenze[n][0] != dest {
		t.Fatalf("apre quello installato: %v %v", err, p.ripartenze)
	}
}

func TestInstallaPortatileNonOraEErrori(t *testing.T) {
	dir, p := t.TempDir(), &provaInst{}
	in := installatoreDiProva(t, dir, "1.29.0", "x", p)
	in.portatile = true
	if st := in.Stato(); st.Stato != instPortatile {
		t.Fatalf("portatile: %+v", st)
	}
	if err := in.Installa(); err == nil {
		t.Fatal("un programma portatile non si installa: i dati resterebbero accanto al file")
	}
	in.portatile = false
	// «Non ora»: not asked again at the start for this file and this version (it stays in Settings)
	if err := in.NonOra(); err != nil {
		t.Fatal(err)
	}
	if !in.Stato().Rifiutata {
		t.Fatal("rifiutata")
	}
	if altro := installatoreDiProva(t, dir, "1.30.0", "y", p); altro.Stato().Rifiutata {
		t.Fatal("un'altra versione si propone di nuovo")
	}
	// without the icon on the Desktop the person would not find it: the program stays where it is, and says why
	p.errCollegamenti = errors.New("PowerShell non risponde")
	if err := in.Installa(); err == nil || !strings.Contains(err.Error(), "icona sul Desktop") {
		t.Fatalf("errore dei collegamenti: %v", err)
	}
	if len(p.ripartenze) != 0 {
		t.Fatal("non riparte da quello installato se l'icona non c'è")
	}
	// outside Windows: nothing to install
	if st := (&Installatore{exe: in.exe, versione: "1.29.0"}).Stato(); st.Stato != instNonDisponibile || st.Cartella != "" {
		t.Fatalf("fuori da Windows: %+v", st)
	}
	var nessuno *Installatore
	if nessuno.Stato().Stato != instNonDisponibile || nessuno.NonOra() != nil {
		t.Fatal("senza installatore")
	}
}

func TestInstallazioneDallaPagina(t *testing.T) {
	srv, h := newTestServer(t)
	// without an installer (the tests, or not Windows): the state says so, the actions are refused
	r := do(h, call{method: "GET", target: "/api/installazione", token: testToken})
	if st := jsonBody(t, r); r.StatusCode != 200 || st["stato"] != instNonDisponibile {
		t.Fatalf("stato: %d %v", r.StatusCode, st)
	}
	if r := do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"installa"}`}); r.StatusCode != http.StatusNotImplemented {
		t.Fatalf("senza installatore: %d", r.StatusCode)
	}
	// from a phone: never
	if r := do(h, call{method: "GET", target: "/api/installazione", token: testToken, remote: true}); r.StatusCode != http.StatusForbidden {
		t.Fatalf("dal telefono: %d", r.StatusCode)
	}
	p := &provaInst{}
	srv.inst = installatoreDiProva(t, t.TempDir(), "1.29.0", "z", p)
	srv.inst.riavvia = nil // in the tests nothing restarts and the server does not stop
	if r := do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"rompi"}`}); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("azione sconosciuta: %d", r.StatusCode)
	}
	if r := do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"non-ora"}`}); r.StatusCode != 200 || !srv.inst.Stato().Rifiutata {
		t.Fatalf("non ora: %d", r.StatusCode)
	}
	r = do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"installa"}`})
	if j := jsonBody(t, r); r.StatusCode != 200 || j["riparte"] != true || j["stato"].(map[string]any)["stato"] != instGiaInstallato {
		t.Fatalf("installa: %d %v", r.StatusCode, j)
	}
	if r := do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"installa"}`}); r.StatusCode != http.StatusConflict || !strings.Contains(text(r), "niente da installare") {
		t.Fatalf("di nuovo: %d", r.StatusCode)
	}
	if r := do(h, call{method: "POST", target: "/api/installazione", token: testToken, body: `{"fai":"collegamenti"}`}); r.StatusCode != http.StatusConflict {
		t.Fatalf("i collegamenti li rifà solo quello installato: %d", r.StatusCode)
	}
}
