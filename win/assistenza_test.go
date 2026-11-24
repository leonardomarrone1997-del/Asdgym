package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Dati inventati: nessuna persona vera. Servono a controllare che il file per l'assistenza non li riporti.
const archivioFinto = `{"impostazioni":{"stagione":"2026/2027","legale":"Verdi Giuseppe"},
 "allieve":[
  {"id":"0001","name":"Rossi Maria","cf":"RSSMRA10A41A515X","telefono":"3331234567","genitore":"Rossi Paolo","email":"paolo.rossi@example.com","indirizzo":"Via dei Gladioli 12","note":"allergia alle noccioline"},
  {"id":"0002","name":"Bianchi Luca","cf":"BNCLCU12C15A515Q","telefono":"3479876543","genitore":"Bianchi Anna","email":"anna.bianchi@example.org","indirizzo":"Corso Garibaldi 3","note":"IBAN IT60X0542811101000000123456"}],
 "iscrizioni":[{"id":"0001","allieva":"0001","corso":"Base","quota":123.45},{"id":"0002","allieva":"0002","corso":"Base","quota":99}],
 "pagamenti":[{"id":"0001","iscrizione":"0001","importo":1234.56,"metodo":"Bonifico","nota":"saldo di Rossi Maria"}],
 "note":[{"id":"0001","testo":"chiamare la mamma di Luca Bianchi"}]}`

var datiPersonali = []string{"Rossi", "Bianchi", "Maria", "Luca", "Paolo", "Anna", "Verdi", "Giuseppe", "RSSMRA10A41A515X", "BNCLCU12C15A515Q", "3331234567", "3479876543",
	"example.com", "example.org", "Gladioli", "Garibaldi", "noccioline", "IT60X05", "1234,56", "1234.56", "123,45", "mamma", "saldo di"}

func TestAssistenzaNonRiportaDatiDelleAllieve(t *testing.T) {
	d, ora := diarioProva(t)
	*ora = time.Now() // il file per l'assistenza conta «le ultime 24 ore» con l'orologio vero: il diario di prova lo segue (con una data fissa la prova smetteva di passare il giorno dopo)
	srv, h := newTestServer(t)
	if _, _, err := srv.store.Save(0, json.RawMessage(archivioFinto), nil, true); err != nil {
		t.Fatal(err)
	}
	// anche quello che un errore porta con sé passa dal diario ripulito (i nomi no: non si riconoscono, per questo il programma non li scrive mai)
	logErrore("copie", "non riesco a leggere l'archivio %s", "RSSMRA10A41A515X 3331234567 paolo.rossi@example.com")
	d.casa = `C:\Users\Mario Rossi`
	logAvviso("seconda-copia", `la cartella C:\Users\Mario Rossi\Desktop\Copie non risponde`)

	r := do(h, call{method: "POST", target: "/api/assistenza", token: testToken})
	if r.StatusCode != 200 {
		t.Fatalf("POST /api/assistenza: %d %s", r.StatusCode, text(r))
	}
	var out struct {
		File     string `json:"file"`
		Byte     int    `json:"byte"`
		Cartella string `json:"cartella"`
		Testo    string `json:"testo"`
	}
	if err := json.Unmarshal([]byte(text(r)), &out); err != nil {
		t.Fatal(err)
	}
	if !reAssistenza.MatchString(out.File) || out.Byte == 0 || out.Byte != len(strings.ReplaceAll(out.Testo, "\n", "\r\n")) {
		t.Errorf("risposta: %+v", out)
	}
	for _, voglio := range []string{"FILE PER L'ASSISTENZA", "Che cosa NON contiene", "== PROGRAMMA ==", "Versione: prova", "== ARCHIVIO ==", "Allieve: 2", "Iscrizioni: 2", "Pagamenti: 1",
		"Salvataggi fatti: 1", "== COPIE DI SICUREZZA ==", "Seconda copia: non impostata", "== ACCESSO DAL TELEFONO ==", "== AGGIORNAMENTI ==", "Versione installata: prova", "== SUONI ==", "== DIARIO TECNICO ==",
		"1 errore, 1 avviso", "[codice fiscale]", "[e-mail]", "[numero]", `~\Desktop\Copie`} {
		if !strings.Contains(out.Testo, voglio) {
			t.Errorf("nel file manca %q", voglio)
		}
	}
	for _, no := range datiPersonali {
		if strings.Contains(out.Testo, no) {
			t.Errorf("nel file per l'assistenza c'è un dato personale: %q", no)
		}
	}
	if strings.Contains(out.Testo, "Mario") {
		t.Error("nel file c'è il nome dell'utente di Windows")
	}

	// il file è sul disco, uguale, con gli «a capo» di Windows
	b, err := os.ReadFile(filepath.Join(srv.store.Dir(), assistenzaDir, out.File))
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != strings.ReplaceAll(out.Testo, "\n", "\r\n") || strings.Count(string(b), "\r\n") != strings.Count(out.Testo, "\n") {
		t.Error("il file sul disco non corrisponde al testo")
	}
	// e si scarica, solo con il gettone nell'indirizzo e solo dal computer
	g := do(h, call{method: "GET", target: "/api/assistenza/" + out.File + "?t=" + testToken})
	if g.StatusCode != 200 || !strings.HasPrefix(g.Header.Get("Content-Disposition"), "attachment") || !strings.HasPrefix(g.Header.Get("Content-Type"), "text/plain") || text(g) != string(b) {
		t.Errorf("download: %d %q", g.StatusCode, g.Header.Get("Content-Disposition"))
	}
	if g := do(h, call{method: "GET", target: "/api/assistenza/" + out.File}); g.StatusCode != 401 {
		t.Errorf("download senza gettone: %d", g.StatusCode)
	}
	if g := do(h, call{method: "GET", target: "/api/assistenza/" + out.File + "?t=" + testToken, remote: true}); g.StatusCode == 200 {
		t.Errorf("download da un altro dispositivo: %d", g.StatusCode)
	}
	for _, nome := range []string{"..%2fregistro.jsonl", "archivio.json", "assistenza-2026-11-20-1030.txt", "assistenza-2026-11-20-1030.txt%00", "%2e%2e%2farchivio.json", "assistenza-9999.txt"} {
		if g := do(h, call{method: "GET", target: "/api/assistenza/" + nome + "?t=" + testToken}); g.StatusCode != 404 {
			t.Errorf("GET /api/assistenza/%s: %d", nome, g.StatusCode)
		}
	}
}

func TestAssistenzaSoloDalComputer(t *testing.T) {
	_, h := newTestServer(t)
	if r := do(h, call{method: "POST", target: "/api/assistenza", token: testToken, remote: true}); r.StatusCode == 200 {
		t.Errorf("da un altro dispositivo: %d", r.StatusCode)
	}
	if r := do(h, call{method: "POST", target: "/api/assistenza"}); r.StatusCode != 401 {
		t.Errorf("senza gettone: %d", r.StatusCode)
	}
}

func TestAssistenzaTieneGliUltimiCinque(t *testing.T) {
	dir := t.TempDir()
	for i := 1; i <= 8; i++ {
		os.WriteFile(filepath.Join(dir, fmt.Sprintf("assistenza-2026-11-%02d-100000.txt", i)), []byte("x"), 0o600)
	}
	os.WriteFile(filepath.Join(dir, "altro.txt"), []byte("non è nostro"), 0o600)
	togliVecchiAssistenza(dir, assistenzaTieni)
	voci, _ := os.ReadDir(dir)
	var nomi []string
	for _, v := range voci {
		nomi = append(nomi, v.Name())
	}
	if got := strings.Join(nomi, " "); got != "altro.txt assistenza-2026-11-04-100000.txt assistenza-2026-11-05-100000.txt assistenza-2026-11-06-100000.txt assistenza-2026-11-07-100000.txt assistenza-2026-11-08-100000.txt" {
		t.Errorf("rimasti: %s", got)
	}
}

func TestAssistenzaApreLaCartella(t *testing.T) {
	srv, h := newTestServer(t)
	var aperta string
	srv.openFolder = func(dir string) error { aperta = dir; return nil }
	do(h, call{method: "POST", target: "/api/apri-cartella", token: testToken})
	if aperta != srv.store.Dir() {
		t.Errorf("senza indicazioni si apre la cartella dei dati: %q", aperta)
	}
	do(h, call{method: "POST", target: "/api/apri-cartella", token: testToken, body: `{"sotto":"assistenza"}`})
	if aperta != filepath.Join(srv.store.Dir(), assistenzaDir) {
		t.Errorf("sotto=assistenza: %q", aperta)
	}
	do(h, call{method: "POST", target: "/api/apri-cartella", token: testToken, body: `{"sotto":"../.."}`})
	if aperta != srv.store.Dir() {
		t.Errorf("una cartella a piacere non si apre: %q", aperta)
	}
}

func TestAssistenzaIlCanaleSenzaNomi(t *testing.T) {
	srv, _ := newTestServer(t)
	if t1 := srv.rapportoAssistenza(); !strings.Contains(t1, "Canale: quello predefinito") || strings.Contains(t1, "githubusercontent") || strings.Contains(t1, canalePredefinito) {
		t.Errorf("canale predefinito:\n%s", t1)
	}
	if err := srv.agg.Imposta(nil, ptrStringa("https://raw.githubusercontent.com/mario-rossi/aggiornamenti/")); err != nil {
		t.Fatal(err)
	}
	if t2 := srv.rapportoAssistenza(); !strings.Contains(t2, "Canale: scelto a mano, sul sito raw.githubusercontent.com") || strings.Contains(t2, "mario-rossi") {
		t.Errorf("canale scelto a mano:\n%s", t2)
	}
}

func ptrStringa(s string) *string { return &s }

func TestMisureEDurate(t *testing.T) {
	for n, v := range map[int64]string{0: "0 byte", 812: "812 byte", 1536: "1,5 KB", 2516582: "2,4 MB", 5 << 30: "5,0 GB"} {
		if got := dimensioneTesto(n); got != v {
			t.Errorf("dimensioneTesto(%d) = %q, voluto %q", n, got, v)
		}
	}
	for d, v := range map[time.Duration]string{10 * time.Second: "meno di un minuto", 125 * time.Minute: "2 ore 5 minuti", time.Minute: "1 minuto", 49*time.Hour + 3*time.Minute: "2 giorni 1 ora 3 minuti"} {
		if got := durataTesto(d); got != v {
			t.Errorf("durataTesto(%v) = %q, voluto %q", d, got, v)
		}
	}
}
