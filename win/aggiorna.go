package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Aggiornamenti. Il programma guarda, di norma una volta al giorno, se nel "canale" (un indirizzo https con un piccolo file aggiornamento.json)
// c'è una versione più nuova e lo dice alla persona, che decide. Senza il suo sì non si scarica e non si cambia niente. I dati non si toccano mai.
//
// Come si difende il download: solo https (in prova anche 127.0.0.1) e solo i siti di GitHub; un indirizzo costruito dal programma (mai uno scritto nel file);
// una dimensione massima; il SHA-256 scritto nel file aggiornamento.json deve combaciare; il programma di prima resta accanto, con il nome ".precedente".
// Non c'è una firma digitale: la sicurezza è quella dell'account che pubblica il canale (attiva la verifica in due passaggi su GitHub).
const (
	canalePredefinito   = "https://raw.githubusercontent.com/leonardomarrone1997-del/Asdgym/claude/asdgym-repo-setup-ydzxu4/aggiornamenti/"
	nomeManifesto       = "aggiornamento.json"
	fileImpostazioniAgg = "aggiornamenti.json"
	maxManifesto        = 256 << 10
	minEseguibile       = 1 << 20
	maxEseguibile       = 150 << 20
	ogniControllo       = 12 * time.Hour
	giorniRimando       = 3
	suffissoNuovo       = ".nuovo"
	suffissoPrecedente  = ".precedente"
)

var (
	reVersione = regexp.MustCompile(`^\d{1,3}\.\d{1,3}\.\d{1,3}$`)
	reFileAgg  = regexp.MustCompile(`^GymArtSegreteria-\d{1,3}\.\d{1,3}\.\d{1,3}\.exe$`)
	reSha256   = regexp.MustCompile(`^[0-9a-f]{64}$`)
	reVai      = regexp.MustCompile(`^[a-z0-9/\-]{0,60}$`) // un indirizzo interno del programma (es. "impostazioni/aspetto"), mai altro

	// ErrAggiornamento: un errore che si può dire alla persona così com'è.
	ErrAggiornamento = errors.New("aggiornamento")
)

// Novita è una cosa nuova, con un invito a provarla ("vai" è la pagina del programma da aprire).
type Novita struct {
	Titolo string `json:"titolo"`
	Testo  string `json:"testo"`
	Vai    string `json:"vai,omitempty"`
}

// Manifesto è il file aggiornamento.json del canale: descrive l'ultima versione.
type Manifesto struct {
	Versione   string   `json:"versione"`
	Data       string   `json:"data"`
	Titolo     string   `json:"titolo"`
	Novita     []Novita `json:"novita"`
	Correzioni []string `json:"correzioni"`
	File       string   `json:"file"`
	Sha256     string   `json:"sha256"`
	Dimensione int64    `json:"dimensione"`
}

// ImpostazioniAgg sta nel file aggiornamenti.json della cartella dei dati.
type ImpostazioniAgg struct {
	Canale          string    `json:"canale,omitempty"`      // vuoto: quello predefinito
	Spento          bool      `json:"spento,omitempty"`      // la persona non vuole il controllo automatico
	UltimoControllo time.Time `json:"ultimoControllo"`       //
	Ignorata        string    `json:"ignorata,omitempty"`    // la versione che la persona ha scelto di saltare
	RimandataFino   time.Time `json:"rimandataFino"`         // "più tardi"
	UltimoEsito     string    `json:"ultimoEsito,omitempty"` // l'ultimo controllo andato male, per dirlo
}

// StatoAgg è quello che vede la pagina.
type StatoAgg struct {
	Versione        string     `json:"versione"`
	Canale          string     `json:"canale"`
	CanalePredef    bool       `json:"canalePredefinito"`
	Automatico      bool       `json:"automatico"`
	UltimoControllo string     `json:"ultimoControllo"`
	Controllo       bool       `json:"controllo"`
	Errore          string     `json:"errore"`
	Disponibile     *Manifesto `json:"disponibile"`
	Rimandata       bool       `json:"rimandata"`
	Ignorata        bool       `json:"ignorata"`
	Fase            string     `json:"fase"` // "", "scarico", "pronto", "installo", "errore"
	Scaricati       int64      `json:"scaricati"`
	Totale          int64      `json:"totale"`
	Installabile    bool       `json:"installabile"`
}

// Aggiornamenti controlla, scarica e installa. Le funzioni che toccano il sistema sono campi, così le prove le sostituiscono.
type Aggiornamenti struct {
	mu        sync.Mutex
	dir       string
	versione  string
	prova     bool // prove: ammesso http su 127.0.0.1, e il programma non si riavvia davvero
	noAuto    bool // prove: nessun controllo da solo (le prove non devono andare su internet)
	client    *http.Client
	imp       ImpostazioniAgg
	disp      *Manifesto
	errore    string
	controllo bool
	fase      string
	scaricati int64
	totale    int64
	nuovo     string

	esegui    func() (string, error)                // os.Executable
	riavvia   func(exe string, args []string) error // avvia il programma nuovo
	argomenti func() []string                       // con quali argomenti riparte
	chiudi    func()                                // ferma questo programma quando quello nuovo è partito
	adesso    func() time.Time
}

// OpenAggiornamenti legge le scelte salvate. prova: vedi il campo.
func OpenAggiornamenti(dir, versione string, prova bool) *Aggiornamenti {
	a := &Aggiornamenti{dir: dir, versione: versione, prova: prova, esegui: os.Executable, riavvia: riavviaProgramma, adesso: time.Now}
	a.client = &http.Client{CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("troppi reindirizzamenti")
		}
		if err := a.permesso(req.URL); err != nil {
			return err
		}
		return nil
	}}
	if b, err := os.ReadFile(filepath.Join(dir, fileImpostazioniAgg)); err == nil {
		_ = json.Unmarshal(b, &a.imp)
	}
	return a
}

// hostPermesso: solo i siti di GitHub (e in prova la macchina stessa).
func hostPermesso(host string, prova bool) bool {
	host = strings.ToLower(host)
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	switch host {
	case "raw.githubusercontent.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com":
		return true
	}
	if strings.HasSuffix(host, ".github.io") {
		return true
	}
	return prova && (host == "127.0.0.1" || host == "localhost")
}

func (a *Aggiornamenti) permesso(u *url.URL) error {
	if u.Scheme != "https" && !(a.prova && u.Scheme == "http") {
		return fmt.Errorf("%w: solo indirizzi sicuri (https) sono ammessi", ErrAggiornamento)
	}
	if !hostPermesso(u.Host, a.prova) {
		return fmt.Errorf("%w: il sito %s non è tra quelli ammessi", ErrAggiornamento, u.Hostname())
	}
	return nil
}

// validaCanale controlla un indirizzo scritto dalla persona e lo rende completo (con la barra finale).
func (a *Aggiornamenti) validaCanale(c string) (string, error) {
	c = strings.TrimSpace(c)
	if c == "" {
		return "", nil
	}
	u, err := url.Parse(c)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("%w: l'indirizzo non è valido", ErrAggiornamento)
	}
	if err := a.permesso(u); err != nil {
		return "", err
	}
	if !strings.HasSuffix(u.Path, "/") {
		u.Path += "/"
	}
	return u.String(), nil
}

// canale è l'indirizzo in uso (con la barra finale).
func (a *Aggiornamenti) canale() string {
	if a.imp.Canale != "" {
		return a.imp.Canale
	}
	return canalePredefinito
}

func (a *Aggiornamenti) salvaImpostazioni() {
	b, err := json.MarshalIndent(a.imp, "", "  ")
	if err != nil {
		return
	}
	tmp := filepath.Join(a.dir, fileImpostazioniAgg+".tmp")
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, filepath.Join(a.dir, fileImpostazioniAgg))
	}
}

// confrontaVersioni: -1, 0, 1. Versioni non valide valgono 0.0.0.
func confrontaVersioni(x, y string) int {
	px, py := partiVersione(x), partiVersione(y)
	for i := 0; i < 3; i++ {
		if px[i] != py[i] {
			if px[i] < py[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func partiVersione(v string) [3]int {
	var out [3]int
	if !reVersione.MatchString(v) {
		return out
	}
	for i, p := range strings.Split(v, ".") {
		out[i], _ = strconv.Atoi(p)
	}
	return out
}

// leggiManifesto controlla ogni campo: quello che arriva da internet non si fida mai.
func leggiManifesto(b []byte) (*Manifesto, error) {
	var m Manifesto
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%w: il file dell'aggiornamento non si legge", ErrAggiornamento)
	}
	switch {
	case !reVersione.MatchString(m.Versione):
		return nil, fmt.Errorf("%w: il numero di versione non è valido", ErrAggiornamento)
	case !reFileAgg.MatchString(m.File) || m.File != "GymArtSegreteria-"+m.Versione+".exe":
		return nil, fmt.Errorf("%w: il nome del file non è valido", ErrAggiornamento)
	case !reSha256.MatchString(strings.ToLower(m.Sha256)):
		return nil, fmt.Errorf("%w: manca l'impronta di controllo del file", ErrAggiornamento)
	case m.Dimensione < minEseguibile || m.Dimensione > maxEseguibile:
		return nil, fmt.Errorf("%w: la dimensione del file non è credibile", ErrAggiornamento)
	}
	m.Sha256 = strings.ToLower(m.Sha256)
	// i testi servono solo alla pagina, che li mostra come testo: si limitano comunque
	m.Titolo = taglia(m.Titolo, 120)
	m.Data = taglia(m.Data, 10)
	if len(m.Novita) > 12 {
		m.Novita = m.Novita[:12]
	}
	for i := range m.Novita {
		m.Novita[i].Titolo, m.Novita[i].Testo = taglia(m.Novita[i].Titolo, 120), taglia(m.Novita[i].Testo, 400)
		if !reVai.MatchString(m.Novita[i].Vai) {
			m.Novita[i].Vai = ""
		}
	}
	if len(m.Correzioni) > 20 {
		m.Correzioni = m.Correzioni[:20]
	}
	for i := range m.Correzioni {
		m.Correzioni[i] = taglia(m.Correzioni[i], 300)
	}
	return &m, nil
}

func taglia(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}

func (a *Aggiornamenti) richiesta(ctx context.Context, indirizzo string) (*http.Response, error) {
	u, err := url.Parse(indirizzo)
	if err != nil {
		return nil, err
	}
	if err := a.permesso(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, indirizzo, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "GymArtSegreteria/"+a.versione) // solo il nome del programma: nient'altro lascia il computer
	return a.client.Do(req)
}

// Controlla cerca una versione più nuova. Restituisce il manifesto se c'è, nil se si è già aggiornati.
func (a *Aggiornamenti) Controlla(ctx context.Context) (*Manifesto, error) {
	a.mu.Lock()
	if a.controllo {
		a.mu.Unlock()
		return a.disp, nil
	}
	a.controllo = true
	canale := a.canale()
	a.mu.Unlock()
	finito := func(m *Manifesto, err error) (*Manifesto, error) {
		a.mu.Lock()
		defer a.mu.Unlock()
		a.controllo = false
		if err != nil { // un controllo andato male non conta: si riprova presto
			a.errore = messaggioErrore(err)
			a.imp.UltimoEsito = a.errore
		} else {
			a.imp.UltimoControllo = a.adesso()
			a.errore, a.imp.UltimoEsito = "", ""
			a.disp = m
		}
		a.salvaImpostazioni()
		return m, err
	}
	ctx, annulla := context.WithTimeout(ctx, 25*time.Second)
	defer annulla()
	resp, err := a.richiesta(ctx, canale+nomeManifesto)
	if err != nil {
		return finito(nil, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return finito(nil, fmt.Errorf("%w: il canale non risponde (codice %d)", ErrAggiornamento, resp.StatusCode))
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxManifesto+1))
	if err != nil || len(b) > maxManifesto {
		return finito(nil, fmt.Errorf("%w: la risposta del canale non è valida", ErrAggiornamento))
	}
	m, err := leggiManifesto(b)
	if err != nil {
		return finito(nil, err)
	}
	if confrontaVersioni(m.Versione, a.versione) <= 0 {
		return finito(nil, nil) // già aggiornati
	}
	return finito(m, nil)
}

func messaggioErrore(err error) string {
	if errors.Is(err, ErrAggiornamento) {
		return strings.TrimPrefix(err.Error(), ErrAggiornamento.Error()+": ")
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "Il canale non ha risposto in tempo."
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		return "Non riesco a collegarmi al canale degli aggiornamenti (internet non c'è, o il sito non risponde)."
	}
	return err.Error()
}

// Scarica porta il file nuovo accanto al programma e controlla la sua impronta. Lavora in fondo: lo stato si legge con Stato.
func (a *Aggiornamenti) Scarica(ctx context.Context) error {
	a.mu.Lock()
	m := a.disp
	if m == nil {
		a.mu.Unlock()
		return fmt.Errorf("%w: non c'è un aggiornamento da scaricare", ErrAggiornamento)
	}
	if a.fase == "scarico" || a.fase == "installo" {
		a.mu.Unlock()
		return nil
	}
	canale := a.canale()
	a.fase, a.errore, a.scaricati, a.totale = "scarico", "", 0, m.Dimensione
	a.mu.Unlock()
	fallito := func(err error) error {
		a.mu.Lock()
		a.fase, a.errore = "errore", messaggioErrore(err)
		a.mu.Unlock()
		return err
	}
	exe, err := a.esegui()
	if err != nil {
		return fallito(err)
	}
	dest := exe + suffissoNuovo
	ctx, annulla := context.WithTimeout(ctx, 20*time.Minute)
	defer annulla()
	resp, err := a.richiesta(ctx, canale+m.File)
	if err != nil {
		return fallito(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fallito(fmt.Errorf("%w: il file dell'aggiornamento non c'è (codice %d)", ErrAggiornamento, resp.StatusCode))
	}
	if resp.ContentLength > maxEseguibile {
		return fallito(fmt.Errorf("%w: il file è troppo grande", ErrAggiornamento))
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return fallito(fmt.Errorf("%w: non posso scrivere accanto al programma (%v)", ErrAggiornamento, err))
	}
	h := sha256.New()
	buf := make([]byte, 64<<10)
	var tot int64
	var errLetto error
	for {
		n, e := resp.Body.Read(buf)
		if n > 0 {
			tot += int64(n)
			if tot > maxEseguibile {
				errLetto = fmt.Errorf("%w: il file è troppo grande", ErrAggiornamento)
				break
			}
			h.Write(buf[:n])
			if _, we := f.Write(buf[:n]); we != nil {
				errLetto = we
				break
			}
			a.mu.Lock()
			a.scaricati = tot
			a.mu.Unlock()
		}
		if e != nil {
			if e != io.EOF {
				errLetto = e
			}
			break
		}
	}
	if ce := f.Close(); errLetto == nil {
		errLetto = ce
	}
	if errLetto != nil {
		_ = os.Remove(dest)
		return fallito(errLetto)
	}
	if tot != m.Dimensione || hex.EncodeToString(h.Sum(nil)) != m.Sha256 {
		_ = os.Remove(dest)
		return fallito(fmt.Errorf("%w: il file scaricato non corrisponde a quello pubblicato: non è stato installato", ErrAggiornamento))
	}
	if err := controllaEseguibile(dest); err != nil {
		_ = os.Remove(dest)
		return fallito(fmt.Errorf("%w: %v", ErrAggiornamento, err))
	}
	a.mu.Lock()
	a.fase, a.nuovo = "pronto", dest
	a.mu.Unlock()
	return nil
}

// installaEseguibile mette il file nuovo al posto del programma: il vecchio si rinomina (si può, anche mentre gira) e resta come ".precedente".
func installaEseguibile(attuale, nuovo string) (string, error) {
	prec := attuale + suffissoPrecedente
	_ = os.Remove(prec)
	if err := os.Rename(attuale, prec); err != nil {
		return "", fmt.Errorf("%w: non riesco a mettere da parte il programma attuale (%v)", ErrAggiornamento, err)
	}
	if err := os.Rename(nuovo, attuale); err != nil {
		_ = os.Rename(prec, attuale) // lo rimette com'era
		return "", fmt.Errorf("%w: non riesco a mettere il programma nuovo (%v)", ErrAggiornamento, err)
	}
	return prec, nil
}

// ripristinaEseguibile annulla installaEseguibile: il programma di prima torna al suo posto.
func ripristinaEseguibile(attuale, prec, nuovo string) {
	_ = os.Rename(attuale, nuovo)
	_ = os.Rename(prec, attuale)
}

// Installa sostituisce il programma e fa partire quello nuovo: il programma di prima poi si ferma da solo.
func (a *Aggiornamenti) Installa() error {
	a.mu.Lock()
	if a.fase != "pronto" || a.nuovo == "" {
		a.mu.Unlock()
		return fmt.Errorf("%w: l'aggiornamento non è pronto", ErrAggiornamento)
	}
	nuovo := a.nuovo
	a.fase = "installo"
	a.mu.Unlock()
	ritorna := func(err error) error {
		a.mu.Lock()
		a.fase, a.errore = "errore", messaggioErrore(err)
		a.mu.Unlock()
		return err
	}
	exe, err := a.esegui()
	if err != nil {
		return ritorna(err)
	}
	prec, err := installaEseguibile(exe, nuovo)
	if err != nil {
		return ritorna(err)
	}
	var args []string
	if a.argomenti != nil {
		args = a.argomenti()
	}
	if err := a.riavvia(exe, args); err != nil {
		ripristinaEseguibile(exe, prec, nuovo)
		return ritorna(fmt.Errorf("%w: il programma nuovo non parte (%v): resta quello di prima", ErrAggiornamento, err))
	}
	if a.chiudi != nil {
		a.chiudi()
	}
	return nil
}

// Stato è la fotografia per la pagina.
func (a *Aggiornamenti) Stato() StatoAgg {
	a.mu.Lock()
	defer a.mu.Unlock()
	st := StatoAgg{Versione: a.versione, Canale: a.canale(), CanalePredef: a.imp.Canale == "", Automatico: !a.imp.Spento, Controllo: a.controllo, Errore: a.errore,
		Disponibile: a.disp, Fase: a.fase, Scaricati: a.scaricati, Totale: a.totale, Installabile: installabile() || a.prova}
	if !a.imp.UltimoControllo.IsZero() {
		st.UltimoControllo = a.imp.UltimoControllo.Format(time.RFC3339)
	}
	if a.disp != nil {
		st.Rimandata = a.imp.RimandataFino.After(a.adesso())
		st.Ignorata = a.imp.Ignorata == a.disp.Versione
	}
	return st
}

// Scelte della persona: rimandare, saltare la versione, il controllo automatico, il canale.
func (a *Aggiornamenti) Rimanda() {
	a.mu.Lock()
	a.imp.RimandataFino = a.adesso().Add(giorniRimando * 24 * time.Hour)
	a.salvaImpostazioni()
	a.mu.Unlock()
}

func (a *Aggiornamenti) Ignora(versione string) {
	a.mu.Lock()
	a.imp.Ignorata = versione
	a.salvaImpostazioni()
	a.mu.Unlock()
}

func (a *Aggiornamenti) Imposta(automatico *bool, canale *string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if canale != nil {
		c, err := a.validaCanale(*canale)
		if err != nil {
			return err
		}
		if c != a.imp.Canale {
			a.imp.Canale, a.disp, a.errore, a.fase = c, nil, "", ""
		}
	}
	if automatico != nil {
		a.imp.Spento = !*automatico
	}
	a.salvaImpostazioni()
	return nil
}

// Dovuto: è ora di controllare da soli?
func (a *Aggiornamenti) Dovuto() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return !a.noAuto && !a.imp.Spento && !a.controllo && a.adesso().Sub(a.imp.UltimoControllo) >= ogniControllo
}

// Ciclo controlla da solo all'avvio (dopo un po', per non rallentarlo) e poi ogni tanto, finché il programma gira.
func (a *Aggiornamenti) Ciclo(ferma <-chan struct{}, subito bool) {
	attesa := 20 * time.Second
	if subito {
		attesa = 200 * time.Millisecond
	}
	for {
		select {
		case <-ferma:
			return
		case <-time.After(attesa):
		}
		if a.Dovuto() {
			_, _ = a.Controlla(context.Background())
		}
		attesa = 30 * time.Minute
	}
}

// nuoviArgomenti: gli argomenti con cui ripartire, con la stessa porta (così l'indirizzo e le scelte del browser restano quelli) e il segno di "dopo l'aggiornamento".
func nuoviArgomenti(args []string, porta int) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		t := args[i]
		switch {
		case t == "-porta" || t == "--porta":
			i++ // salta anche il valore
		case strings.HasPrefix(t, "-porta=") || strings.HasPrefix(t, "--porta="):
		case t == "-dopo-aggiornamento" || t == "--dopo-aggiornamento":
		default:
			out = append(out, t)
		}
	}
	return append(out, "-porta", strconv.Itoa(porta), "-dopo-aggiornamento")
}

// riavviaProgramma fa partire il programma nuovo, staccato da questo.
func riavviaProgramma(exe string, args []string) error {
	cmd := exec.Command(exe, args...)
	cmd.Dir = filepath.Dir(exe)
	staccato(cmd)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

/* ---------- le richieste della pagina ---------- */

func (s *Server) handleAggStato(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.agg.Stato())
}

func (s *Server) soloQui(w http.ResponseWriter, r *http.Request) bool {
	if s.local(r) {
		return true
	}
	writeJSON(w, http.StatusForbidden, map[string]any{"errore": "Gli aggiornamenti si fanno solo dal computer su cui gira il programma."})
	return false
}

func (s *Server) handleAggControlla(w http.ResponseWriter, r *http.Request) {
	if !s.soloQui(w, r) {
		return
	}
	go func() { _, _ = s.agg.Controlla(context.Background()) }()
	time.Sleep(50 * time.Millisecond) // il tempo di vedere "controllo"
	writeJSON(w, http.StatusOK, s.agg.Stato())
}

func (s *Server) handleAggScarica(w http.ResponseWriter, r *http.Request) {
	if !s.soloQui(w, r) {
		return
	}
	if st := s.agg.Stato(); st.Disponibile == nil {
		writeJSON(w, http.StatusConflict, map[string]any{"errore": "Non c'è un aggiornamento da scaricare."})
		return
	}
	go func() { _ = s.agg.Scarica(context.Background()) }()
	time.Sleep(50 * time.Millisecond)
	writeJSON(w, http.StatusOK, s.agg.Stato())
}

func (s *Server) handleAggInstalla(w http.ResponseWriter, r *http.Request) {
	if !s.soloQui(w, r) {
		return
	}
	if err := s.agg.Installa(); err != nil {
		writeJSON(w, http.StatusConflict, map[string]any{"errore": messaggioErrore(err)})
		return
	}
	writeJSON(w, http.StatusOK, s.agg.Stato())
}

func (s *Server) handleAggImposta(w http.ResponseWriter, r *http.Request) {
	if !s.soloQui(w, r) {
		return
	}
	var in struct {
		Automatico *bool   `json:"automatico"`
		Canale     *string `json:"canale"`
		Rimanda    bool    `json:"rimanda"`
		Ignora     string  `json:"ignora"`
	}
	if !readJSON(r, &in) {
		badRequest(w)
		return
	}
	if in.Rimanda {
		s.agg.Rimanda()
	}
	if in.Ignora != "" {
		if !reVersione.MatchString(in.Ignora) {
			badRequest(w)
			return
		}
		s.agg.Ignora(in.Ignora)
	}
	if err := s.agg.Imposta(in.Automatico, in.Canale); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": messaggioErrore(err)})
		return
	}
	writeJSON(w, http.StatusOK, s.agg.Stato())
}

// nuoviAggiornamenti crea il gestore. In prova (GYMART_AGGIORNAMENTI_PROVA=1) il canale può essere sulla macchina stessa
// (GYMART_AGGIORNAMENTI_CANALE) e il programma non si riavvia davvero: scrive solo cosa avrebbe fatto in riavvio-prova.json.
func nuoviAggiornamenti(dir, versione string) *Aggiornamenti {
	prova := os.Getenv("GYMART_AGGIORNAMENTI_PROVA") == "1"
	a := OpenAggiornamenti(dir, versione, prova)
	a.noAuto = os.Getenv("GYMART_AGGIORNAMENTI_NO_AUTO") == "1"
	if prova {
		if c := os.Getenv("GYMART_AGGIORNAMENTI_CANALE"); c != "" {
			a.imp.Canale, _ = a.validaCanale(c)
		}
		a.riavvia = func(exe string, args []string) error {
			b, _ := json.Marshal(map[string]any{"exe": exe, "args": args})
			return os.WriteFile(filepath.Join(dir, "riavvio-prova.json"), b, 0o600)
		}
	}
	return a
}
