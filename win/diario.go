package main

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"
)

// Il diario tecnico è un file di testo accanto all'archivio dove il programma annota che cosa gli succede: avvio e chiusura, copie,
// aggiornamenti, e soprattutto gli errori. Serve a chi cura il programma per capire un guasto in palestra senza essere lì.
// Regole, tutte provate nei test:
//   - niente dati delle persone: ogni voce passa da ripulisciTesto, che toglie codici fiscali, e-mail, IBAN, numeri lunghi, il nome
//     dell'utente di Windows e tutto ciò che farebbe andare a capo (una voce non può fingere di essere due);
//   - non blocca e non rompe mai niente: se il file non si può scrivere il programma va avanti come se il diario non ci fosse;
//   - non cresce senza limite: oltre 256 KB il file passa a «.1» (quello di prima si perde), le voci uguali di fila si scrivono una volta
//     sola, e una pagina impazzita non riempie il disco (al massimo 120 voci al minuto);
//   - si legge con il Blocco note: una voce per riga, «data | livello | dove | testo».
const (
	diarioNome     = "diario-tecnico.log"
	diarioVecchio  = "diario-tecnico.1.log"
	diarioMax      = 256 << 10
	diarioMaxVoce  = 700 // caratteri di una voce
	diarioAlMinuto = 120
	diarioRipeti   = time.Hour // una voce uguale alla precedente si riscrive (con il conto) solo dopo tanto tempo
	diarioRiprova  = time.Minute
)

// Voce è una riga del diario, come la legge la pagina.
type Voce struct {
	Quando  string `json:"quando"`  // "2026-11-20 10:15:03", ora del computer
	Livello string `json:"livello"` // INFO | AVVISO | ERRORE
	Dove    string `json:"dove"`
	Testo   string `json:"testo"`
}

// Diario scrive e rilegge le voci. Un *Diario nil è valido: non fa niente (le prove e i programmi senza cartella dei dati).
type Diario struct {
	mu     sync.Mutex
	dir    string // la cartella dei dati: nelle voci diventa <dati>
	casa   string // la cartella dell'utente: nelle voci diventa ~
	path   string
	max    int64 // misura oltre cui il file passa a «.1» (nelle prove è piccola)
	adesso func() time.Time

	ultima     string    // chiave dell'ultima voce scritta
	ultimaOra  time.Time // quando
	ripetute   int       // quante volte è tornata uguale senza essere riscritta
	ultimaVoce Voce
	minuto     time.Time
	nelMinuto  int
	saltate    int
	riprovaDa  time.Time // dopo un errore di scrittura non si insiste a ogni voce
}

var diarioAttivo atomic.Pointer[Diario]

// ApriDiario prepara il diario nella cartella dei dati. Non fallisce mai: se la cartella non si può usare, le voci si perdono e basta.
func ApriDiario(dir string) *Diario {
	d := &Diario{dir: dir, path: filepath.Join(dir, diarioNome), max: diarioMax, adesso: time.Now}
	d.casa, _ = os.UserHomeDir()
	if len(d.casa) < 4 { // «/» o «C:\» non sono la cartella di una persona: sostituirli rovinerebbe ogni percorso
		d.casa = ""
	}
	os.MkdirAll(dir, 0o700)
	return d
}

// ImpostaDiario fa del diario dato quello di tutto il programma (nil lo spegne). Restituisce quello di prima.
func ImpostaDiario(d *Diario) *Diario { return diarioAttivo.Swap(d) }

func logInfo(dove, formato string, a ...any) {
	diarioAttivo.Load().scrivi("INFO", dove, fmt.Sprintf(formato, a...))
}
func logAvviso(dove, formato string, a ...any) {
	diarioAttivo.Load().scrivi("AVVISO", dove, fmt.Sprintf(formato, a...))
}
func logErrore(dove, formato string, a ...any) {
	diarioAttivo.Load().scrivi("ERRORE", dove, fmt.Sprintf(formato, a...))
}

var (
	reUtenteWin = regexp.MustCompile(`(?i)([A-Z]:\\Users\\)[^\\/:*?"<>|]+`)
	reUtenteNix = regexp.MustCompile(`(/home/|/Users/)[^/\s]+`)
	reCF        = regexp.MustCompile(`(?i)\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b`)
	reMail      = regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+`)
	reIBAN      = regexp.MustCompile(`(?i)\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b`)
	reNumeri    = regexp.MustCompile(`\+?\d(?: ?\d){8,}`)
	reGettone   = regexp.MustCompile(`([?&]t=)[0-9A-Fa-f]{12,}`)
)

// ripulisciTesto è l'unico passaggio per cui ogni voce deve passare: una riga sola, senza caratteri strani, senza dati delle persone,
// al massimo max caratteri. Toglie anche quello che un testo ostile userebbe per nascondersi o per fingere un'altra voce.
func ripulisciTesto(s string, max int) string {
	s = strings.ToValidUTF8(s, "?")
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) || r == '\u2028' || r == '\u2029' {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	s = reUtenteWin.ReplaceAllString(s, `${1}<utente>`)
	s = reUtenteNix.ReplaceAllString(s, `${1}<utente>`)
	s = reGettone.ReplaceAllString(s, `${1}[…]`)
	s = reMail.ReplaceAllString(s, "[e-mail]")
	s = reIBAN.ReplaceAllString(s, "[IBAN]")
	s = reCF.ReplaceAllString(s, "[codice fiscale]")
	s = reNumeri.ReplaceAllString(s, "[numero]")
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max-1]) + "…"
	}
	return s
}

// ripulisci toglie anche i percorsi: la cartella dei dati e quella dell'utente non vanno scritte per intero.
func (d *Diario) ripulisci(s string) string {
	if len(d.dir) >= 4 { // «.» o «/» non sono un percorso da riconoscere: sostituirli rovinerebbe ogni voce
		s = strings.ReplaceAll(s, d.dir, "<dati>")
	}
	if d.casa != "" {
		s = strings.ReplaceAll(s, d.casa, "~")
	}
	return ripulisciTesto(s, diarioMaxVoce)
}

// pulisciDove: il nome del posto da cui viene la voce è corto e fatto di lettere minuscole, cifre e trattini.
func pulisciDove(s string) string {
	s = strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			return r
		}
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return -1
	}, s)
	if len(s) > 24 {
		s = s[:24]
	}
	if s == "" {
		return "altro"
	}
	return s
}

func (d *Diario) vecchio() string { return filepath.Join(d.dir, diarioVecchio) }

// scrive una voce (il livello è uno di INFO, AVVISO, ERRORE).
func (d *Diario) scrivi(livello, dove, testo string) {
	if d == nil {
		return
	}
	dove = pulisciDove(dove)
	testo = d.ripulisci(testo)
	d.mu.Lock()
	defer d.mu.Unlock()
	t := d.adesso()
	chiave := livello + "|" + dove + "|" + testo
	if chiave == d.ultima {
		d.ripetute++
		if t.Sub(d.ultimaOra) < diarioRipeti {
			return
		}
		testo = fmt.Sprintf("%s (ripetuta altre %d volte)", testo, d.ripetute)
		d.ripetute = 0
	} else {
		d.chiudiRipetute(t)
	}
	if t.Sub(d.minuto) >= time.Minute || t.Before(d.minuto) {
		if d.saltate > 0 {
			d.riga(t, "AVVISO", "diario", fmt.Sprintf("%d voci non scritte: ne sono arrivate troppe in un minuto", d.saltate))
		}
		d.minuto, d.nelMinuto, d.saltate = t, 0, 0
	}
	if d.nelMinuto >= diarioAlMinuto {
		d.saltate++
		return
	}
	d.nelMinuto++
	d.riga(t, livello, dove, testo)
	d.ultima, d.ultimaOra, d.ultimaVoce = chiave, t, Voce{Livello: livello, Dove: dove, Testo: testo}
}

// chiudiRipetute scrive quante volte la voce di prima è tornata uguale senza essere riscritta.
func (d *Diario) chiudiRipetute(t time.Time) {
	if d.ripetute > 0 {
		d.riga(t, d.ultimaVoce.Livello, d.ultimaVoce.Dove, fmt.Sprintf("(la voce di prima si è ripetuta altre %d volte)", d.ripetute))
	}
	d.ripetute, d.ultima = 0, ""
}

// Chiudi scrive il conto delle voci rimaste in sospeso: da chiamare quando il programma si ferma.
func (d *Diario) Chiudi() {
	if d == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.chiudiRipetute(d.adesso())
}

// riga aggiunge una riga al file (con il blocco preso). Il passaggio al file «.1» avviene prima di superare la misura.
func (d *Diario) riga(t time.Time, livello, dove, testo string) {
	if t.Before(d.riprovaDa) {
		return
	}
	linea := t.Format("2006-01-02 15:04:05") + " | " + livello + " | " + dove + " | " + testo + "\n"
	if fi, err := os.Stat(d.path); err == nil && fi.Size()+int64(len(linea)) > d.max {
		os.Remove(d.vecchio()) // su Windows rinominare sopra un file che c'è non si può
		os.Rename(d.path, d.vecchio())
	}
	f, err := os.OpenFile(d.path, os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600)
	if err != nil {
		d.riprovaDa = t.Add(diarioRiprova)
		return
	}
	if _, err := f.WriteString(linea); err != nil {
		d.riprovaDa = t.Add(diarioRiprova)
	}
	f.Close()
}

// righe dà le righe del file vecchio e di quello attuale, dalla più vecchia alla più recente.
func (d *Diario) righe() []string {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for _, p := range []string{d.vecchio(), d.path} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, r := range strings.Split(string(b), "\n") {
			if r = strings.TrimRight(r, "\r"); r != "" {
				out = append(out, r)
			}
		}
	}
	return out
}

// leggiVoce capisce una riga del diario; falso se non è una riga scritta da noi.
func leggiVoce(riga string) (Voce, bool) {
	p := strings.SplitN(riga, " | ", 4)
	if len(p) != 4 || len(p[0]) != 19 {
		return Voce{}, false
	}
	if _, err := time.Parse("2006-01-02 15:04:05", p[0]); err != nil {
		return Voce{}, false
	}
	return Voce{Quando: p[0], Livello: p[1], Dove: p[2], Testo: p[3]}, true
}

// Voci dà le ultime n voci, dalla più recente.
func (d *Diario) Voci(n int) []Voce {
	righe := d.righe()
	out := []Voce{}
	for i := len(righe) - 1; i >= 0 && len(out) < n; i-- {
		if v, ok := leggiVoce(righe[i]); ok {
			out = append(out, v)
		}
	}
	return out
}

// Conteggio dà quante voci di errore e di avviso ci sono dall'ora data in poi.
func (d *Diario) Conteggio(da time.Time) (errori, avvisi int) {
	for _, r := range d.righe() {
		v, ok := leggiVoce(r)
		if !ok {
			continue
		}
		t, err := time.ParseInLocation("2006-01-02 15:04:05", v.Quando, time.Local)
		if err != nil || t.Before(da) {
			continue
		}
		switch v.Livello {
		case "ERRORE":
			errori++
		case "AVVISO":
			avvisi++
		}
	}
	return
}

// Testo dà le ultime n righe così come sono nel file.
func (d *Diario) Testo(n int) string {
	righe := d.righe()
	if len(righe) > n {
		righe = righe[len(righe)-n:]
	}
	return strings.Join(righe, "\n")
}

/* ---------- gli errori imprevisti ---------- */

// pila descrive in una riga da dove si è arrivati: «store.go:314 (*Store).Save < server.go:376 (*Server).handleSave». Solo le funzioni
// del programma, al massimo max.
func pila(max int) string {
	pcs := make([]uintptr, 40)
	n := runtime.Callers(1, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	prefisso := ""
	var out []string
	for {
		f, altri := frames.Next()
		if prefisso == "" { // il primo passo è questa funzione stessa: dice in che pacchetto vive il programma («main», o il suo percorso nelle prove)
			prefisso = strings.TrimSuffix(f.Function, "pila")
		} else if nome, ok := strings.CutPrefix(f.Function, prefisso); ok && !strings.HasPrefix(nome, "recuperaPanic") {
			out = append(out, fmt.Sprintf("%s:%d %s", filepath.Base(f.File), f.Line, nome))
			if len(out) >= max {
				break
			}
		}
		if !altri {
			break
		}
	}
	return strings.Join(out, " < ")
}

// recuperaPanic va in «defer» in cima a un lavoro in sottofondo: un errore imprevisto finisce nel diario invece di fermare il programma
// senza dire niente (non c'è una finestra nera in cui leggerlo). Il lavoro che l'ha causato è finito; il programma va avanti.
func recuperaPanic(dove string) {
	if p := recover(); p != nil {
		logErrore(dove, "errore imprevisto: %v | %s", p, pila(8))
	}
}

// dettaglioPS legge il motivo di un errore che PowerShell ha scritto su stderr: l'ultima riga non vuota, in Base64 (così non conta la lingua
// o la tabella dei caratteri della console) oppure, se non lo è, com'è. Senza niente da leggere dice «nessun dettaglio».
func dettaglioPS(s string) string {
	righe := strings.Split(strings.TrimSpace(s), "\n")
	ultima := strings.TrimSpace(righe[len(righe)-1])
	if ultima == "" {
		return "nessun dettaglio"
	}
	if b, err := base64.StdEncoding.DecodeString(ultima); err == nil && utf8.Valid(b) {
		return string(b)
	}
	return ultima
}

// statoRisposta ricorda come è andata una richiesta, per scriverlo nel diario se è andata male.
type statoRisposta struct {
	http.ResponseWriter
	stato int
	corpo []byte
}

func (w *statoRisposta) WriteHeader(code int) {
	if w.stato == 0 {
		w.stato = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statoRisposta) Write(b []byte) (int, error) {
	if w.stato == 0 {
		w.stato = http.StatusOK
	}
	if w.stato >= 400 && len(w.corpo) < 400 {
		w.corpo = append(w.corpo, b[:min(len(b), 400-len(w.corpo))]...)
	}
	return w.ResponseWriter.Write(b)
}

func (w *statoRisposta) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// messaggioRisposta tira fuori il testo dell'errore dalla risposta {"errore": "..."} (o dal testo semplice).
func messaggioRisposta(corpo []byte) string {
	s := strings.TrimSpace(string(corpo))
	if i := strings.Index(s, `"errore":"`); i >= 0 {
		s = s[i+len(`"errore":"`):]
		if j := strings.Index(s, `"`); j >= 0 {
			s = s[:j]
		}
	}
	return s
}

// conDiario sta intorno a tutte le richieste: se una richiesta si rompe (errore imprevisto) il programma risponde con un errore
// e va avanti, e lo scrive nel diario; scrive anche le risposte di errore del programma. Mai l'indirizzo con i parametri: ci può essere il gettone.
func (s *Server) conDiario(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statoRisposta{ResponseWriter: w}
		defer func() {
			if p := recover(); p != nil {
				if p == http.ErrAbortHandler {
					panic(p)
				}
				logErrore("http", "errore imprevisto in %s %s: %v | %s", r.Method, r.URL.Path, p, pila(8))
				if rec.stato == 0 {
					writeJSON(rec, http.StatusInternalServerError, map[string]any{"errore": "Errore imprevisto del programma. È stato scritto nel diario tecnico (Impostazioni, Assistenza)."})
				}
				return
			}
			switch {
			case rec.stato >= 500:
				logErrore("http", "%s %s: risposta %d: %s", r.Method, r.URL.Path, rec.stato, messaggioRisposta(rec.corpo))
			case rec.stato == http.StatusConflict, rec.stato == http.StatusUnprocessableEntity, rec.stato == http.StatusBadRequest, rec.stato == http.StatusRequestEntityTooLarge, rec.stato == http.StatusUnsupportedMediaType:
				logAvviso("http", "%s %s: risposta %d: %s", r.Method, r.URL.Path, rec.stato, messaggioRisposta(rec.corpo))
			}
		}()
		next.ServeHTTP(rec, r)
	})
}
