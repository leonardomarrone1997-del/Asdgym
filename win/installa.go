package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Installazione sul computer (1.29.0, alla domanda «migliorerebbe se il programma si appoggiasse con un suo installer?»).
//
// Sul computer vero il programma girava da una cartella «… - Copia» sul Desktop, e più copie in posti diversi facevano aprire quella
// vecchia. L'installazione la fa il programma stesso, sempre e solo dopo il sì della persona: si copia in una cartella fissa
// (%LOCALAPPDATA%\Programs\Gym Art Segreteria, per l'utente, senza amministratore), mette l'icona sul Desktop e nel menu Start, compare
// in Impostazioni di Windows › App (dove si disinstalla), e riparte da lì. Aprire un file più nuovo, scaricato da qualunque parte,
// chiede se aggiornare quello installato; aprire una copia uguale o più vecchia apre quello installato. I dati non si spostano mai:
// restano in Documenti\Gym Art Segreteria (con una cartella «dati» accanto al programma, programma «portatile», non si propone niente).

const (
	cartellaProgramma = "Gym Art Segreteria"
	nomeEseguibile    = "GymArtSegreteria.exe"
	fileInstallazione = "installazione.json"
	fileSceltaInst    = "installazione-scelta.json"
)

// Gli stati dell'installazione, come la pagina li riceve.
const (
	instNonDisponibile = "non-disponibile" // non su Windows (prove)
	instInstallato     = "installato"      // gira proprio quello installato
	instPortatile      = "portatile"       // i dati sono accanto al programma (o scelti con -dati): niente da proporre
	instDaInstallare   = "da-installare"
	instDaAggiornare   = "da-aggiornare"  // questo è più nuovo di quello installato
	instGiaInstallato  = "gia-installato" // stessa versione: si apre quello installato
	instPiuVecchia     = "piu-vecchia"    // quello installato è più nuovo: si apre quello
)

// InfoInstallazione sta accanto al programma installato: la versione si legge senza avviarlo.
type InfoInstallazione struct {
	Versione   string `json:"versione"`
	Installata string `json:"installata"`
}

// StatoInstallazione: che cosa la pagina mostra (Impostazioni › Questo computer) e propone all'avvio.
type StatoInstallazione struct {
	Stato              string `json:"stato"`
	Cartella           string `json:"cartella,omitempty"`
	VersioneInstallata string `json:"versioneInstallata,omitempty"`
	Versione           string `json:"versione"`
	Questo             string `json:"questo,omitempty"`
	Rifiutata          bool   `json:"rifiutata"` // «Non ora» per questo file e questa versione
}

// decidiInstallazione: lo stato, da dove gira il programma e che cosa c'è nella cartella d'installazione.
func decidiInstallazione(questo, installato string, portatile, esiste bool, versInstallata, versione string) string {
	switch {
	case installato == "":
		return instNonDisponibile
	case stessoFile(questo, installato):
		return instInstallato
	case portatile:
		return instPortatile
	case !esiste:
		return instDaInstallare
	case versInstallata == "" || confrontaVersioni(versInstallata, versione) < 0:
		return instDaAggiornare
	case confrontaVersioni(versInstallata, versione) == 0:
		return instGiaInstallato
	default:
		return instPiuVecchia
	}
}

// stessoFile: lo stesso programma (su Windows i percorsi non distinguono maiuscole e minuscole, e un nome corto 8.3 è lo stesso file).
func stessoFile(a, b string) bool {
	if a == "" || b == "" {
		return false
	}
	if strings.EqualFold(filepath.Clean(a), filepath.Clean(b)) {
		return true
	}
	fa, ea := os.Stat(a)
	fb, eb := os.Stat(b)
	return ea == nil && eb == nil && os.SameFile(fa, fb)
}

// Installatore fa e dice l'installazione. Le parti che toccano Windows (collegamenti, registro, avvio con Windows, ripartenza)
// sono funzioni: nelle prove si sostituiscono.
type Installatore struct {
	mu        sync.Mutex
	exe       string // il programma che gira
	versione  string
	cartella  string // dove si installa ("" fuori da Windows)
	portatile bool
	locale    string // %LOCALAPPDATA%\GymArtSegreteria: la scelta «Non ora»

	collegamenti func(exe string) error                     // Desktop e menu Start
	registra     func(exe, cartella, versione string) error // Impostazioni di Windows › App
	avvio        func(exe string) error                     // se il programma parte con Windows, da qui in poi parte quello installato
	riavvia      func(exe string, args []string) error      // fa partire quello installato
	argomenti    func() []string                            // con che argomenti (la stessa porta: stesso indirizzo, stesse scelte della pagina)
	adesso       func() time.Time
}

func (in *Installatore) eseguibileInstallato() string {
	if in.cartella == "" {
		return ""
	}
	return filepath.Join(in.cartella, nomeEseguibile)
}

func (in *Installatore) leggiInfo() (InfoInstallazione, bool) {
	var info InfoInstallazione
	dest := in.eseguibileInstallato()
	if dest == "" {
		return info, false
	}
	if _, err := os.Stat(dest); err != nil {
		return info, false
	}
	if b, err := os.ReadFile(filepath.Join(in.cartella, fileInstallazione)); err == nil {
		_ = json.Unmarshal(b, &info)
	}
	return info, true
}

// Stato: lo stato di adesso (legge il disco ogni volta: un altro programma può aver installato nel frattempo).
func (in *Installatore) Stato() StatoInstallazione {
	if in == nil {
		return StatoInstallazione{Stato: instNonDisponibile}
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.stato()
}

func (in *Installatore) stato() StatoInstallazione {
	info, esiste := in.leggiInfo()
	st := StatoInstallazione{Versione: in.versione, Questo: in.exe, Cartella: in.cartella, VersioneInstallata: info.Versione,
		Stato: decidiInstallazione(in.exe, in.eseguibileInstallato(), in.portatile, esiste, info.Versione, in.versione)}
	if st.Stato == instNonDisponibile {
		st.Cartella = ""
	}
	st.Rifiutata = in.rifiutata()
	return st
}

type sceltaInst struct {
	Exe      string `json:"exe"`
	Versione string `json:"versione"`
}

func (in *Installatore) rifiutata() bool {
	if in.locale == "" {
		return false
	}
	b, err := os.ReadFile(filepath.Join(in.locale, fileSceltaInst))
	if err != nil {
		return false
	}
	var s sceltaInst
	return json.Unmarshal(b, &s) == nil && stessoFile(s.Exe, in.exe) && s.Versione == in.versione
}

// NonOra: la persona ha detto «Non ora»: per questo file e questa versione non lo si chiede più all'avvio (resta in Impostazioni).
func (in *Installatore) NonOra() error {
	if in == nil || in.locale == "" {
		return nil
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	if err := os.MkdirAll(in.locale, 0o700); err != nil {
		return err
	}
	b, _ := json.Marshal(sceltaInst{Exe: in.exe, Versione: in.versione})
	return writeAtomic(filepath.Join(in.locale, fileSceltaInst), b)
}

var errInstallazione = errors.New("installazione")

// Installa copia questo programma nella cartella fissa (al posto di quello di prima, che resta come «.precedente»), scrive la
// versione, fa i collegamenti e la voce in App, e fa partire quello installato. Chi chiama poi chiude questo programma.
func (in *Installatore) Installa() error {
	in.mu.Lock()
	defer in.mu.Unlock()
	st := in.stato()
	if st.Stato != instDaInstallare && st.Stato != instDaAggiornare {
		return fmt.Errorf("%w: niente da installare (%s)", errInstallazione, st.Stato)
	}
	dest := in.eseguibileInstallato()
	if err := os.MkdirAll(in.cartella, 0o755); err != nil {
		return fmt.Errorf("%w: non riesco a creare la cartella del programma (%v)", errInstallazione, err)
	}
	nuovo := dest + ".nuovo"
	if err := copiaFile(in.exe, nuovo); err != nil {
		os.Remove(nuovo)
		return fmt.Errorf("%w: non riesco a copiare il programma (%v)", errInstallazione, err)
	}
	if err := controllaEseguibile(nuovo); err != nil {
		os.Remove(nuovo)
		return fmt.Errorf("%w: la copia non è un programma valido (%v)", errInstallazione, err)
	}
	if _, err := os.Stat(dest); err == nil {
		if _, err := installaEseguibile(dest, nuovo); err != nil {
			os.Remove(nuovo)
			return fmt.Errorf("%w: %v", errInstallazione, err)
		}
	} else if err := os.Rename(nuovo, dest); err != nil {
		os.Remove(nuovo)
		return fmt.Errorf("%w: non riesco a mettere il programma nella sua cartella (%v)", errInstallazione, err)
	}
	b, _ := json.MarshalIndent(InfoInstallazione{Versione: in.versione, Installata: in.adesso().Format(time.RFC3339)}, "", "  ")
	if err := writeAtomic(filepath.Join(in.cartella, fileInstallazione), b); err != nil {
		return fmt.Errorf("%w: non riesco a scrivere la versione installata (%v)", errInstallazione, err)
	}
	if in.collegamenti != nil {
		if err := in.collegamenti(dest); err != nil { // senza l'icona la persona non lo ritroverebbe: si resta qui e lo si dice
			return fmt.Errorf("%w: il programma è nella sua cartella, ma l'icona sul Desktop non si è creata (%v)", errInstallazione, err)
		}
	}
	if in.registra != nil {
		if err := in.registra(dest, in.cartella, in.versione); err != nil {
			logAvviso("installazione", "voce in App di Windows non scritta: %v", err)
		}
	}
	if in.avvio != nil {
		if err := in.avvio(dest); err != nil {
			logAvviso("installazione", "avvio con Windows non spostato sul programma installato: %v", err)
		}
	}
	logInfo("installazione", "installata la versione %s (%s)", in.versione, map[string]string{instDaInstallare: "prima volta", instDaAggiornare: "aggiornata da " + st.VersioneInstallata}[st.Stato])
	return in.parti(dest)
}

// ApriInstallato fa partire quello installato (uguale o più nuovo di questo): chi chiama poi chiude questo programma.
func (in *Installatore) ApriInstallato() error {
	in.mu.Lock()
	defer in.mu.Unlock()
	st := in.stato()
	if st.Stato != instGiaInstallato && st.Stato != instPiuVecchia {
		return fmt.Errorf("%w: non c'è un programma installato da aprire al posto di questo (%s)", errInstallazione, st.Stato)
	}
	return in.parti(in.eseguibileInstallato())
}

// Collegamenti rifà l'icona sul Desktop e nel menu Start (se la persona l'ha cancellata): solo per quello installato.
func (in *Installatore) Collegamenti() error {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.stato().Stato != instInstallato || in.collegamenti == nil {
		return fmt.Errorf("%w: solo il programma installato rifà i suoi collegamenti", errInstallazione)
	}
	return in.collegamenti(in.eseguibileInstallato())
}

func (in *Installatore) parti(exe string) error {
	if in.riavvia == nil {
		return nil
	}
	var args []string
	if in.argomenti != nil {
		args = in.argomenti()
	}
	if err := in.riavvia(exe, args); err != nil {
		return fmt.Errorf("%w: il programma installato non parte (%v)", errInstallazione, err)
	}
	return nil
}

// copiaFile copia src in dst e lo scrive davvero sul disco prima di dire che ha finito.
func copiaFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err = io.Copy(out, in); err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return err
}

/* ---------- le richieste della pagina (solo dal computer) ---------- */

func (s *Server) handleInstallazioneGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.inst.Stato())
}

// handleInstallazionePost: { fai: "installa" | "apri" | "non-ora" | "collegamenti" }.
func (s *Server) handleInstallazionePost(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Fai string `json:"fai"`
	}
	if !readJSON(r, &in) {
		badRequest(w)
		return
	}
	if s.inst == nil || s.inst.cartella == "" {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"errore": "L'installazione c'è solo su Windows."})
		return
	}
	var err error
	riparte := false
	switch in.Fai {
	case "installa":
		err, riparte = s.inst.Installa(), true
	case "apri":
		err, riparte = s.inst.ApriInstallato(), true
	case "non-ora":
		err = s.inst.NonOra()
	case "collegamenti":
		err = s.inst.Collegamenti()
	default:
		badRequest(w)
		return
	}
	if err != nil {
		logErrore("installazione", "%s: %s", in.Fai, messaggioErrore(err))
		writeJSON(w, http.StatusConflict, map[string]any{"errore": messaggioErrore(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "riparte": riparte, "stato": s.inst.Stato()})
	if riparte && s.inst.riavvia != nil { // quello installato sta partendo: questo se ne va, dopo che la risposta è arrivata alla pagina
		go func() {
			defer recuperaPanic("installazione")
			time.Sleep(900 * time.Millisecond)
			s.ferma("riparte dalla cartella del programma installato")
		}()
	}
}
