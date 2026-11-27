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
	Stato              string  `json:"stato"`
	Cartella           string  `json:"cartella,omitempty"`
	VersioneInstallata string  `json:"versioneInstallata,omitempty"`
	Versione           string  `json:"versione"`
	Questo             string  `json:"questo,omitempty"`
	Rifiutata          bool    `json:"rifiutata"` // «Non ora» per questo file e questa versione
	AltreCopie         []Copia `json:"altreCopie,omitempty"`
}

// Copia: un altro GymArtSegreteria*.exe sul computer (Desktop, Download), che il programma installato propone di spostare nel Cestino.
type Copia struct {
	Percorso string `json:"percorso"`
	Data     string `json:"data"` // ultima modifica, AAAA-MM-GG
}

// cercaAltreCopie: i file GymArtSegreteria*.exe nelle cartelle date e nelle loro sottocartelle (un livello, come «Desktop\Gym Art -
// Copia»), tranne il programma installato e le copie «portatili» (con una cartella «dati» accanto: i loro dati non si toccano).
// Con versioneDi (la versione scritta nel file) restano fuori anche le copie più nuove di quella installata, e quelle di cui la
// versione non si legge: una versione nuova appena scaricata non finisce nel Cestino.
func cercaAltreCopie(cartelle []string, installato, versioneInstallata string, versioneDi func(string) string) []Copia {
	out, visti := []Copia{}, map[string]bool{}
	guarda := func(dir string) {
		voci, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		if fi, err := os.Stat(filepath.Join(dir, "dati")); err == nil && fi.IsDir() {
			return
		}
		for _, v := range voci {
			n := strings.ToLower(v.Name())
			if v.IsDir() || !strings.HasPrefix(n, "gymartsegreteria") || !strings.HasSuffix(n, ".exe") {
				continue
			}
			p := filepath.Join(dir, v.Name())
			if visti[strings.ToLower(p)] || stessoFile(p, installato) {
				continue
			}
			visti[strings.ToLower(p)] = true
			if versioneDi != nil {
				if vc := versioneDi(p); vc == "" || versioneInstallata == "" || confrontaVersioni(vc, versioneInstallata) > 0 {
					continue
				}
			}
			c := Copia{Percorso: p}
			if fi, err := v.Info(); err == nil {
				c.Data = fi.ModTime().Format("2006-01-02")
			}
			out = append(out, c)
		}
	}
	for _, d := range cartelle {
		if d == "" {
			continue
		}
		guarda(d)
		if voci, err := os.ReadDir(d); err == nil {
			for _, v := range voci {
				if v.IsDir() && !strings.HasPrefix(v.Name(), ".") {
					guarda(filepath.Join(d, v.Name()))
				}
			}
		}
	}
	return out
}

// Cestina sposta nel Cestino una delle altre copie trovate (solo quelle: un percorso qualsiasi viene rifiutato).
func (in *Installatore) Cestina(percorso string) error {
	in.mu.Lock()
	st := in.stato(true)
	in.mu.Unlock() // Windows moves the file without holding the program: the page can still ask how things are
	if st.Stato != instInstallato || in.cestina == nil || in.dove == nil {
		return fmt.Errorf("%w: le altre copie le toglie solo il programma installato", errInstallazione)
	}
	for _, c := range st.AltreCopie {
		if c.Percorso == percorso {
			if err := in.cestina(percorso); err != nil {
				return fmt.Errorf("%w: non riesco a spostarla nel Cestino (%v)", errInstallazione, err)
			}
			logInfo("installazione", "una copia vecchia del programma è nel Cestino")
			return nil
		}
	}
	return fmt.Errorf("%w: questa copia non c'è più, o non è una copia del programma", errInstallazione)
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
	dove         func() []string             // dove cercare le altre copie (Desktop, Download)
	cestina      func(percorso string) error // sposta un file nel Cestino
	versioneDi   func(exe string) string     // la versione scritta in un GymArtSegreteria.exe ("" se non si legge)
	scollega     func(exe string) error      // toglie i collegamenti che portano a exe (se l'installazione non va in fondo)
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

// Stato: lo stato di adesso (legge il disco ogni volta: un altro programma può aver installato nel frattempo). Senza le altre copie:
// è quello che il programma guarda a ogni avvio, e deve essere svelto.
func (in *Installatore) Stato() StatoInstallazione {
	if in == nil {
		return StatoInstallazione{Stato: instNonDisponibile}
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.stato(false)
}

// StatoCompleto: lo stato con le altre copie del programma sul computer (per la pagina).
func (in *Installatore) StatoCompleto() StatoInstallazione {
	if in == nil {
		return StatoInstallazione{Stato: instNonDisponibile}
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	return in.stato(true)
}

func (in *Installatore) stato(conCopie bool) StatoInstallazione {
	info, esiste := in.leggiInfo()
	st := StatoInstallazione{Versione: in.versione, Questo: in.exe, Cartella: in.cartella, VersioneInstallata: info.Versione,
		Stato: decidiInstallazione(in.exe, in.eseguibileInstallato(), in.portatile, esiste, info.Versione, in.versione)}
	if st.Stato == instNonDisponibile {
		st.Cartella = ""
	}
	st.Rifiutata = in.rifiutata()
	if conCopie && st.Stato == instInstallato && in.dove != nil {
		st.AltreCopie = cercaAltreCopie(in.dove(), in.eseguibileInstallato(), in.versione, in.versioneDi)
	}
	return st
}

// Allinea: il programma installato che parte con una versione diversa da quella scritta accanto (si è aggiornato dal canale, o
// qualcuno ha messo a mano un file nuovo nella cartella) la riscrive, con la voce in App: un'altra copia non deve poi credere di
// essere più nuova e proporre di «aggiornarlo» con una versione vecchia.
func (in *Installatore) Allinea() {
	if in == nil {
		return
	}
	in.mu.Lock()
	defer in.mu.Unlock()
	info, _ := in.leggiInfo()
	if in.stato(false).Stato != instInstallato || info.Versione == in.versione {
		return
	}
	b, _ := json.MarshalIndent(InfoInstallazione{Versione: in.versione, Installata: in.adesso().Format(time.RFC3339)}, "", "  ")
	if err := writeAtomic(filepath.Join(in.cartella, fileInstallazione), b); err != nil {
		logAvviso("installazione", "versione installata non riscritta: %v", err)
		return
	}
	if in.registra != nil {
		if err := in.registra(in.eseguibileInstallato(), in.cartella, in.versione); err != nil {
			logAvviso("installazione", "voce in App non aggiornata: %v", err)
		}
	}
	logInfo("installazione", "il programma installato ora è la versione %s (prima era scritta %s)", in.versione, map[bool]string{true: "nessuna", false: info.Versione}[info.Versione == ""])
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
	st := in.stato(false)
	if st.Stato != instDaInstallare && st.Stato != instDaAggiornare {
		return fmt.Errorf("%w: niente da installare (%s)", errInstallazione, st.Stato)
	}
	primaVolta := st.Stato == instDaInstallare
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
			return fmt.Errorf("%w: %s", errInstallazione, messaggioErrore(err))
		}
	} else if err := os.Rename(nuovo, dest); err != nil {
		os.Remove(nuovo)
		return fmt.Errorf("%w: non riesco a mettere il programma nella sua cartella (%v)", errInstallazione, err)
	}
	// the first time, an installation that does not go to the end is taken back: no program hidden in a folder without its icon,
	// that this file would then open by itself at every start. An update keeps the icons it already had (they lead to the same file).
	annulla := func() {
		if in.scollega != nil {
			_ = in.scollega(dest)
		}
		_ = os.Remove(dest)
		_ = os.Remove(filepath.Join(in.cartella, fileInstallazione))
		_ = os.Remove(in.cartella) // only if empty
	}
	b, _ := json.MarshalIndent(InfoInstallazione{Versione: in.versione, Installata: in.adesso().Format(time.RFC3339)}, "", "  ")
	if err := writeAtomic(filepath.Join(in.cartella, fileInstallazione), b); err != nil {
		if primaVolta {
			annulla()
			return fmt.Errorf("%w: non riesco a scrivere nella cartella del programma (%v): il programma resta questo file", errInstallazione, err)
		}
		logAvviso("installazione", "versione installata non scritta: %v (la riscrive il programma installato quando parte)", err)
	}
	if in.collegamenti != nil {
		if err := in.collegamenti(dest); err != nil {
			if primaVolta { // without the icon the person would not find it again
				annulla()
				return fmt.Errorf("%w: l'icona sul Desktop non si è creata (%v): il programma resta questo file", errInstallazione, err)
			}
			logAvviso("installazione", "icone non rifatte: %v (restano quelle di prima, che portano allo stesso programma)", err)
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
	st := in.stato(false)
	if st.Stato != instGiaInstallato && st.Stato != instPiuVecchia {
		return fmt.Errorf("%w: non c'è un programma installato da aprire al posto di questo (%s)", errInstallazione, st.Stato)
	}
	return in.parti(in.eseguibileInstallato())
}

// Collegamenti rifà l'icona sul Desktop e nel menu Start (se la persona l'ha cancellata): solo per quello installato.
func (in *Installatore) Collegamenti() error {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.stato(false).Stato != instInstallato || in.collegamenti == nil {
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

// exeDiAvvio: il programma che la voce «avvio con Windows» fa partire, dalla risposta di «reg query … /v GymArtSegreteria»
// (la riga «GymArtSegreteria    REG_SZ    "C:\…\GymArtSegreteria.exe" -senza-finestra»). "" se la voce non c'è.
func exeDiAvvio(regQuery string) string {
	for _, riga := range strings.Split(regQuery, "\n") {
		_, dato, ok := strings.Cut(riga, "REG_SZ")
		if !ok {
			continue
		}
		dato = strings.TrimSpace(dato)
		if strings.HasPrefix(dato, `"`) {
			if fine := strings.Index(dato[1:], `"`); fine >= 0 {
				return dato[1 : 1+fine]
			}
			return ""
		}
		if exe, _, _ := strings.Cut(dato, " -"); exe != "" {
			return strings.TrimSpace(exe)
		}
	}
	return ""
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
	writeJSON(w, http.StatusOK, s.inst.StatoCompleto())
}

// handleInstallazionePost: { fai: "installa" | "apri" | "non-ora" | "collegamenti" | "cestina", percorso (per "cestina") }.
func (s *Server) handleInstallazionePost(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Fai      string `json:"fai"`
		Percorso string `json:"percorso"`
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
	case "cestina":
		err = s.inst.Cestina(in.Percorso)
	default:
		badRequest(w)
		return
	}
	if err != nil {
		logErrore("installazione", "%s: %s", in.Fai, messaggioErrore(err))
		writeJSON(w, http.StatusConflict, map[string]any{"errore": messaggioErrore(err)})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "riparte": riparte, "stato": s.inst.StatoCompleto()})
	if riparte && s.inst.riavvia != nil { // quello installato sta partendo: questo se ne va, dopo che la pagina ha salutato
		go func() {
			defer recuperaPanic("installazione")
			time.Sleep(1500 * time.Millisecond)
			s.chiudiLeFinestre() // the page cannot close its own window (Edge refuses after the first page): the program does, before the installed one opens its own
			s.ferma("riparte dalla cartella del programma installato")
		}()
	}
}
