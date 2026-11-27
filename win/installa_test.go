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

// The installed program finds the other copies of itself (Desktop, Downloads, one folder down as «Gym Art - Copia») and moves to the
// Recycle Bin only one of those, after a yes; a «portable» copy (a «dati» folder next to it) is never proposed.
func TestAltreCopieNelCestino(t *testing.T) {
	dir := t.TempDir()
	scrivi := func(rel string) string {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("MZ"), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	desktop, download := filepath.Join(dir, "Desktop"), filepath.Join(dir, "Download")
	a := scrivi("Desktop/GymArtSegreteria.exe")
	b := scrivi("Desktop/Gym Art - Copia/GymArtSegreteria.exe")
	c := scrivi("Download/GymArtSegreteria-1.27.0.exe")
	scrivi("Desktop/Portatile/GymArtSegreteria.exe")
	os.MkdirAll(filepath.Join(desktop, "Portatile", "dati"), 0o755)
	scrivi("Desktop/Altro/programma.exe")
	scrivi("Desktop/GymArtSegreteria.txt")
	scrivi("Desktop/Molto/In/Fondo/GymArtSegreteria.exe") // two folders down: not looked at
	installato := scrivi("Programs/Gym Art Segreteria/GymArtSegreteria.exe")
	trovate := cercaAltreCopie([]string{desktop, download, "", filepath.Join(dir, "non-esiste")}, installato, "1.29.0", nil)
	var percorsi []string
	for _, x := range trovate {
		percorsi = append(percorsi, x.Percorso)
		if len(x.Data) != 10 {
			t.Errorf("data: %q", x.Data)
		}
	}
	if strings.Join(percorsi, "|") != strings.Join([]string{a, b, c}, "|") {
		t.Fatalf("copie trovate: %v", percorsi)
	}

	var cestinate []string
	in := &Installatore{exe: installato, versione: "1.29.0", cartella: filepath.Dir(installato),
		dove: func() []string { return []string{desktop, download} }, cestina: func(p string) error { cestinate = append(cestinate, p); return os.Remove(p) }}
	if st := in.Stato(); st.Stato != instInstallato || st.AltreCopie != nil {
		t.Fatalf("lo stato di ogni avvio non cerca le copie (deve essere svelto): %+v", st)
	}
	st := in.StatoCompleto()
	if st.Stato != instInstallato || len(st.AltreCopie) != 3 {
		t.Fatalf("stato: %+v", st)
	}
	if err := in.Cestina(b); err != nil || len(cestinate) != 1 || cestinate[0] != b {
		t.Fatalf("cestina: %v %v", err, cestinate)
	}
	if len(in.StatoCompleto().AltreCopie) != 2 {
		t.Fatal("dopo: due copie")
	}
	for _, p := range []string{b, filepath.Join(dir, "Desktop/Altro/programma.exe"), installato, filepath.Join(dir, "Desktop/Portatile/GymArtSegreteria.exe"), "../GymArtSegreteria.exe"} {
		if err := in.Cestina(p); err == nil {
			t.Errorf("%s: solo le copie trovate si spostano nel Cestino", p)
		}
	}
	if len(cestinate) != 1 {
		t.Fatalf("niente altro nel Cestino: %v", cestinate)
	}
	// a copy that is not installed does not move the others
	altro := &Installatore{exe: a, versione: "1.29.0", cartella: filepath.Dir(installato), dove: in.dove, cestina: in.cestina}
	if err := altro.Cestina(c); err == nil {
		t.Fatal("solo il programma installato toglie le altre copie")
	}
}

// 1.29.0 (review): a newer version just downloaded is not an «old copy»: it is not proposed for the Recycle Bin, and neither is a file
// whose version cannot be read. The same version and the older ones are.
func TestAltreCopieSoloVecchie(t *testing.T) {
	dir := t.TempDir()
	versioni := map[string]string{}
	scrivi := func(nome, v string) string {
		p := filepath.Join(dir, "Download", nome)
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, []byte("MZ"), 0o755)
		versioni[p] = v
		return p
	}
	vecchia, uguale := scrivi("GymArtSegreteria-1.28.0.exe", "1.28.0"), scrivi("GymArtSegreteria (1).exe", "1.29.0")
	scrivi("GymArtSegreteria-1.30.0.exe", "1.30.0")
	scrivi("GymArtSegreteria-rotto.exe", "")
	installato := filepath.Join(dir, "Programs", cartellaProgramma, nomeEseguibile)
	os.MkdirAll(filepath.Dir(installato), 0o755)
	os.WriteFile(installato, []byte("MZ"), 0o755)
	in := &Installatore{exe: installato, versione: "1.29.0", cartella: filepath.Dir(installato), dove: func() []string { return []string{filepath.Join(dir, "Download")} },
		versioneDi: func(p string) string { return versioni[p] }, cestina: func(string) error { return nil }}
	var trovate []string
	for _, c := range in.StatoCompleto().AltreCopie {
		trovate = append(trovate, c.Percorso)
	}
	if strings.Join(trovate, "|") != strings.Join([]string{uguale, vecchia}, "|") {
		t.Fatalf("copie proposte: %v", trovate)
	}
	if err := in.Cestina(filepath.Join(dir, "Download", "GymArtSegreteria-1.30.0.exe")); err == nil {
		t.Fatal("la versione nuova non si sposta nel Cestino")
	}
}

// 1.29.0 (review): the first installation that cannot make the icons is taken back, so the file does not jump to a hidden program at every
// start; an update keeps going (the icons of before lead to the same file).
func TestInstallazioneNonFinitaSiAnnulla(t *testing.T) {
	dir := t.TempDir()
	p := &provaInst{errCollegamenti: errors.New("PowerShell bloccato")}
	in := installatoreDiProva(t, dir, "1.29.0", "uno", p)
	var scollegati []string
	in.scollega = func(exe string) error { scollegati = append(scollegati, exe); return nil }
	err := in.Installa()
	if err == nil || !strings.Contains(messaggioErrore(err), "il programma resta questo file") || strings.HasPrefix(messaggioErrore(err), "installazione:") {
		t.Fatalf("errore: %v / %q", err, messaggioErrore(err))
	}
	if _, err := os.Stat(in.cartella); !os.IsNotExist(err) {
		t.Fatal("la cartella del programma è rimasta")
	}
	if len(scollegati) != 1 || len(p.registrati) != 0 || len(p.ripartenze) != 0 {
		t.Fatalf("scollegati %v, registrati %v, ripartenze %v", scollegati, p.registrati, p.ripartenze)
	}
	if st := in.Stato(); st.Stato != instDaInstallare {
		t.Fatalf("dopo: %+v", st)
	}
	// installed, then a newer file whose icons cannot be made again: the update goes on
	p.errCollegamenti = nil
	if err := in.Installa(); err != nil {
		t.Fatal(err)
	}
	p.errCollegamenti = errors.New("PowerShell bloccato")
	nuovo := installatoreDiProva(t, dir, "1.30.0", "due", p)
	if err := nuovo.Installa(); err != nil {
		t.Fatalf("aggiornamento: %v", err)
	}
	if b, _ := os.ReadFile(nuovo.eseguibileInstallato()); string(b) != "MZdue" || p.registrati[len(p.registrati)-1] != "1.30.0" {
		t.Fatalf("aggiornato: %q %v", b, p.registrati)
	}
}

// 1.29.0 (review): the installed program that starts with another version than the one written next to it (updated from the channel, or a
// file put in the folder by hand) writes it again, with the entry in Apps: another copy must not believe it is newer.
func TestAllineaVersioneInstallata(t *testing.T) {
	dir := t.TempDir()
	p := &provaInst{}
	vecchio := installatoreDiProva(t, dir, "1.29.0", "uno", p)
	if err := vecchio.Installa(); err != nil {
		t.Fatal(err)
	}
	quello := &Installatore{exe: vecchio.eseguibileInstallato(), versione: "1.30.0", cartella: vecchio.cartella, adesso: vecchio.adesso, registra: vecchio.registra}
	quello.Allinea()
	if info, _ := quello.leggiInfo(); info.Versione != "1.30.0" || p.registrati[len(p.registrati)-1] != "1.30.0" {
		t.Fatalf("versione scritta %q, voce in App %v", info.Versione, p.registrati)
	}
	n := len(p.registrati)
	quello.Allinea() // nothing to do now
	(&Installatore{exe: filepath.Join(dir, "altrove.exe"), versione: "1.31.0", cartella: vecchio.cartella, adesso: vecchio.adesso, registra: vecchio.registra}).Allinea()
	if len(p.registrati) != n {
		t.Fatal("solo il programma installato riscrive la sua versione, e solo se è diversa")
	}
	if st := installatoreDiProva(t, dir, "1.29.5", "tre", p).Stato(); st.Stato != instPiuVecchia {
		t.Fatalf("una copia 1.29.5 davanti alla 1.30.0 installata: %+v", st)
	}
}

// 1.29.0 (review): the start with Windows is found by its file, written long or short (8.3), with or without quotes.
func TestExeDiAvvio(t *testing.T) {
	for _, c := range []struct{ in, vuole string }{
		{"\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    GymArtSegreteria    REG_SZ    \"C:\\Users\\Mario Rossi\\AppData\\Local\\Programs\\Gym Art Segreteria\\GymArtSegreteria.exe\" -senza-finestra\r\n\r\n", `C:\Users\Mario Rossi\AppData\Local\Programs\Gym Art Segreteria\GymArtSegreteria.exe`},
		{"    GymArtSegreteria    REG_SZ    C:\\PROGRA~1\\GymArt.exe -senza-finestra", `C:\PROGRA~1\GymArt.exe`},
		{"ERRORE: impossibile trovare la chiave", ""},
		{"    GymArtSegreteria    REG_SZ    \"senza fine", ""},
	} {
		if got := exeDiAvvio(c.in); got != c.vuole {
			t.Errorf("%q: %q", c.in, got)
		}
	}
}
