package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var (
	pngProva = append([]byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}, bytes.Repeat([]byte{7}, 100)...)
	jpgProva = append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{9}, 100)...)
	pdfProva = []byte("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")
)

func caricaDocumento(h http.Handler, body []byte) *http.Response {
	return do(h, call{method: "POST", target: "/api/documento", token: testToken, body: string(body)})
}

func TestDocumentoSiRiconoscePerIlContenutoNonPerIlNome(t *testing.T) {
	srv, h := newTestServer(t)
	for _, c := range []struct {
		corpo []byte
		tipo  string
	}{{pngProva, "png"}, {jpgProva, "jpg"}, {pdfProva, "pdf"}} {
		r := caricaDocumento(h, c.corpo)
		if r.StatusCode != 200 {
			t.Fatalf("%s: %d %s", c.tipo, r.StatusCode, text(r))
		}
		j := jsonBody(t, r)
		nome, _ := j["file"].(string)
		if !reDocumento.MatchString(nome) || j["tipo"] != c.tipo || !strings.HasSuffix(nome, "."+c.tipo) {
			t.Fatalf("risposta: %v", j)
		}
		got, err := os.ReadFile(filepath.Join(srv.cartellaDocumenti(), nome))
		if err != nil || !bytes.Equal(got, c.corpo) {
			t.Fatalf("il file salvato non è quello ricevuto: %v", err)
		}
	}
	// due caricamenti dello stesso file non si sovrascrivono
	a := jsonBody(t, caricaDocumento(h, pngProva))["file"]
	b := jsonBody(t, caricaDocumento(h, pngProva))["file"]
	if a == b {
		t.Fatal("lo stesso nome per due documenti")
	}
}

func TestDocumentoRifiutaCioCheNonSonoPdfOImmagini(t *testing.T) {
	srv, h := newTestServer(t)
	for nome, corpo := range map[string][]byte{
		"testo": []byte("ciao"), "html": []byte("<script>alert(1)</script>"), "exe": []byte("MZ\x90\x00"), "svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
		"gif": []byte("GIF89a......"), "pdf finto con spazio": []byte(" %PDF-1.4"),
	} {
		if r := caricaDocumento(h, corpo); r.StatusCode != http.StatusUnsupportedMediaType {
			t.Errorf("%s: %d", nome, r.StatusCode)
		}
	}
	if r := caricaDocumento(h, nil); r.StatusCode != http.StatusBadRequest {
		t.Errorf("vuoto: %d", r.StatusCode)
	}
	grande := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte{'x'}, maxDocumento)...)
	if r := caricaDocumento(h, grande); r.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("troppo grande: %d", r.StatusCode)
	}
	if e, err := os.ReadDir(srv.cartellaDocumenti()); err == nil && len(e) != 0 {
		t.Errorf("sono rimasti file dopo i rifiuti: %d", len(e))
	}
}

func TestDocumentoSiLeggeConIlTokenNellIndirizzoEDaNessunAltroModo(t *testing.T) {
	_, h := newTestServer(t)
	nome := jsonBody(t, caricaDocumento(h, pdfProva))["file"].(string)
	get := func(target string, c call) *http.Response {
		c.method, c.target = "GET", target
		return do(h, c)
	}
	r := get("/api/documento/"+nome+"?t="+testToken, call{})
	if r.StatusCode != 200 || r.Header.Get("Content-Type") != "application/pdf" || !strings.HasPrefix(r.Header.Get("Content-Disposition"), "inline") || r.Header.Get("X-Content-Type-Options") != "nosniff" || r.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("lettura: %d %v", r.StatusCode, r.Header)
	}
	if body := text(r); body != string(pdfProva) {
		t.Fatalf("contenuto: %q", body)
	}
	if r := get("/api/documento/"+nome, call{}); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("senza token: %d", r.StatusCode)
	}
	if r := get("/api/documento/"+nome+"?t=sbagliato", call{}); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("token sbagliato: %d", r.StatusCode)
	}
	if r := get("/api/documento/"+nome+"?t="+testToken, call{host: "evil.example"}); r.StatusCode != http.StatusForbidden {
		t.Errorf("host estraneo: %d", r.StatusCode)
	}
	// da un altro dispositivo serve anche la sessione
	if r := get("/api/documento/"+nome+"?t="+testToken, call{remote: true}); r.StatusCode == 200 {
		t.Errorf("da rete senza accesso: %d", r.StatusCode)
	}
	// il token nell'indirizzo vale solo per leggere, non per cancellare o caricare
	if r := do(h, call{method: "DELETE", target: "/api/documento/" + nome + "?t=" + testToken}); r.StatusCode != http.StatusUnauthorized {
		t.Errorf("cancellare con il token nell'indirizzo: %d", r.StatusCode)
	}
}

func TestDocumentoNomiStrani(t *testing.T) {
	_, h := newTestServer(t)
	for _, n := range []string{"../archivio.json", "..%2Farchivio.json", "doc-0000000000000000.exe", "doc-xyz.pdf", "doc-0000000000000000.pdf.tmp", "archivio.json", "DOC-0000000000000000.PDF"} {
		r := do(h, call{method: "GET", target: "/api/documento/" + n + "?t=" + testToken})
		if r.StatusCode == 200 {
			t.Errorf("%s: %d", n, r.StatusCode)
		}
		d := do(h, call{method: "DELETE", target: "/api/documento/" + n, token: testToken})
		if d.StatusCode == 200 {
			t.Errorf("DELETE %s: %d", n, d.StatusCode)
		}
	}
	if r := do(h, call{method: "GET", target: "/api/documento/doc-0123456789abcdef.pdf?t=" + testToken}); r.StatusCode != 404 {
		t.Errorf("file che non c'è: %d", r.StatusCode)
	}
}

func TestDocumentoSiCancella(t *testing.T) {
	srv, h := newTestServer(t)
	nome := jsonBody(t, caricaDocumento(h, jpgProva))["file"].(string)
	if r := do(h, call{method: "DELETE", target: "/api/documento/" + nome, token: testToken}); r.StatusCode != 200 {
		t.Fatalf("cancella: %d", r.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(srv.cartellaDocumenti(), nome)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("il file c'è ancora: %v", err)
	}
	if r := do(h, call{method: "DELETE", target: "/api/documento/" + nome, token: testToken}); r.StatusCode != 200 {
		t.Fatalf("cancellare due volte non è un errore: %d", r.StatusCode)
	}
}

func TestDocumentoDaTelefonoSoloConAccessoAttivo(t *testing.T) {
	_, h := newTestServer(t)
	// la rete è spenta: un altro dispositivo non passa nemmeno il controllo dell'indirizzo
	r := do(h, call{method: "POST", target: "/api/documento", token: testToken, body: string(pngProva), remote: true, host: "pc.local"})
	if r.StatusCode != http.StatusForbidden {
		t.Fatalf("da rete spenta: %d", r.StatusCode)
	}
}

func TestScansionaSoloDalComputerConLoScannerFinto(t *testing.T) {
	srv, h := newTestServer(t)
	post := func(c call) *http.Response {
		c.method, c.target, c.token = "POST", "/api/scansiona", testToken
		return do(h, c)
	}
	// senza scanner (Linux, o Windows senza la finestra): messaggio chiaro
	if r := post(call{}); r.StatusCode != http.StatusNotImplemented || !strings.Contains(text(r), "scegli un file") {
		t.Fatalf("senza scanner: %d", r.StatusCode)
	}
	// da un altro dispositivo non si usa lo scanner del computer
	srv.scanImage = func() ([]byte, error) { return jpgProva, nil }
	if r := post(call{remote: true, host: "pc.local"}); r.StatusCode == 200 {
		t.Fatalf("scanner da un altro dispositivo: %d", r.StatusCode)
	}
	st := jsonBody(t, do(h, call{method: "GET", target: "/api/stato", token: testToken}))
	if st["scanner"] != true {
		t.Errorf("lo stato non dice che lo scanner c'è: %v", st["scanner"])
	}
	// una scansione riuscita diventa un documento
	r := post(call{})
	j := jsonBody(t, r)
	nome, _ := j["file"].(string)
	if r.StatusCode != 200 || j["tipo"] != "jpg" || !reDocumento.MatchString(nome) {
		t.Fatalf("scansione: %d %v", r.StatusCode, j)
	}
	if got, _ := os.ReadFile(filepath.Join(srv.cartellaDocumenti(), nome)); !bytes.Equal(got, jpgProva) {
		t.Fatal("il documento salvato non è la scansione")
	}
	// finestra chiusa, nessuno scanner, errore generico, file che non è un'immagine
	srv.scanImage = func() ([]byte, error) { return nil, ErrScansioneAnnullata }
	if r := post(call{}); r.StatusCode != 200 || jsonBody(t, r)["annullata"] != true {
		t.Errorf("annullata: %d", r.StatusCode)
	}
	srv.scanImage = func() ([]byte, error) { return nil, ErrNessunoScanner }
	if r := post(call{}); r.StatusCode != http.StatusServiceUnavailable || !strings.Contains(text(r), "Non trovo nessuno scanner") {
		t.Errorf("nessuno scanner: %d", r.StatusCode)
	}
	srv.scanImage = func() ([]byte, error) { return nil, errors.New("COM exploded") }
	if r := post(call{}); r.StatusCode != http.StatusInternalServerError || strings.Contains(text(r), "COM") {
		t.Errorf("errore generico: %d (il dettaglio tecnico non va mostrato)", r.StatusCode)
	}
	srv.scanImage = func() ([]byte, error) { return []byte("BM....."), nil } // una bitmap: non è ammessa
	if r := post(call{}); r.StatusCode == 200 {
		t.Errorf("formato non ammesso: %d", r.StatusCode)
	}
	files, _ := os.ReadDir(srv.cartellaDocumenti())
	if len(files) != 1 {
		t.Errorf("devono esserci solo i documenti riusciti: %d", len(files))
	}
}

func TestStatoSenzaScannerEFileDocumentiNonSonoNellArchivio(t *testing.T) {
	srv, h := newTestServer(t)
	caricaDocumento(h, pngProva)
	st := jsonBody(t, do(h, call{method: "GET", target: "/api/stato", token: testToken}))
	if st["scanner"] != false {
		t.Errorf("scanner: %v", st["scanner"])
	}
	raw, _ := json.Marshal(st["db"])
	if strings.Contains(string(raw), "doc-") {
		t.Error("i file dei documenti non vanno nell'archivio")
	}
	_ = srv
}

func TestISecondaCartellaCopiaIDocumenti(t *testing.T) {
	srv, h := newTestServer(t)
	srv.mirror = OpenMirror(srv.store.Dir(), srv.store)
	dir := filepath.Join(t.TempDir(), "chiavetta")
	body, _ := json.Marshal(map[string]string{"cartella": dir})
	if r := do(h, call{method: "POST", target: "/api/copie2", token: testToken, body: string(body)}); r.StatusCode != 200 {
		t.Fatalf("set folder: %d %s", r.StatusCode, text(r))
	}
	nome := jsonBody(t, caricaDocumento(h, pdfProva))["file"].(string)
	os.WriteFile(filepath.Join(srv.cartellaDocumenti(), "appunti.txt"), []byte("non è un documento"), 0o600) // non è un documento del programma: non si copia
	do(h, call{method: "POST", target: "/api/salva", token: testToken, body: `{"rev":0,"db":{"allieve":[{"id":"0001","name":"Rossi Maria"}]}}`})
	srv.mirror.Flush()
	got, err := os.ReadFile(filepath.Join(dir, documentiDir, nome))
	if err != nil || !bytes.Equal(got, pdfProva) {
		t.Fatalf("il documento non è nella seconda cartella: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, documentiDir, "appunti.txt")); err == nil {
		t.Error("è stato copiato un file che non è un documento")
	}
	// non si riscrive quello che c'è già, e un documento tolto dal computer non sparisce dalla copia
	info1, _ := os.Stat(filepath.Join(dir, documentiDir, nome))
	if err := srv.mirror.CopyNow(); err != nil {
		t.Fatal(err)
	}
	info2, _ := os.Stat(filepath.Join(dir, documentiDir, nome))
	if !info1.ModTime().Equal(info2.ModTime()) {
		t.Error("il documento è stato riscritto senza motivo")
	}
	os.Remove(filepath.Join(srv.cartellaDocumenti(), nome))
	srv.mirror.CopyNow()
	if _, err := os.Stat(filepath.Join(dir, documentiDir, nome)); err != nil {
		t.Errorf("la copia ha perso un documento: %v", err)
	}
}
