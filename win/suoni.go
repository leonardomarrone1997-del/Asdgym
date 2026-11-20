package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Piccoli suoni del programma: uno all'avvio e uno alla chiusura.
//
// Non ci sono file audio: i suoni si sintetizzano qui (qualche nota di campana e un soffio) e li suona il computer
// (Windows: winmm, vedi suono_windows.go). Così si sentono anche quando la finestra è un browser che blocca l'audio delle pagine,
// non serve la rete e il suono parte proprio quando la pagina lo chiede. La scelta (spenti, piano, normale) sta in suoni.json,
// accanto all'archivio: vale per questo computer. Un errore dell'audio non ferma mai il programma.

const (
	suoniFile  = "suoni.json"
	suoniRate  = 44100
	suoniPausa = 700 * time.Millisecond // due richieste dello stesso suono più vicine di così sono una sola
	suoniBase  = "piano"
)

// livelliSuoni: il picco del suono rispetto al massimo possibile (1,0). «piano» è discreto, «normale» si sente bene.
var livelliSuoni = map[string]float64{"piano": 0.22, "normale": 0.5}

// suonoValido: i nomi che la pagina può chiedere.
func suonoValido(nome string) bool { return nome == "avvio" || nome == "chiusura" }

func livelloValido(l string) bool {
	_, ok := livelliSuoni[l]
	return ok || l == "spento"
}

/* ---------- sintesi ---------- */

// miscela è un buffer di campioni a cui si sommano note e soffi.
type miscela struct{ s []float64 }

type parziale struct{ rapporto, ampiezza, caduta float64 }

// Una campana: la nota, le armoniche (che si spengono prima) e una parziale appena stonata che dà il luccichio.
var campanaParziali = []parziale{{1, 1, 1}, {2, 0.42, 1.7}, {3, 0.17, 2.6}, {4.17, 0.09, 3.6}}

// campana suona una nota che parte morbida (4 ms) e si spegne da sola: a fine durata resta circa l'1% della forza.
func (b *miscela) campana(t0, freq, durata, ampiezza float64) {
	inizio, n := int(t0*suoniRate), int(durata*suoniRate)
	for _, p := range campanaParziali {
		f := freq * p.rapporto
		if f > suoniRate/2.5 {
			continue
		}
		tau := durata / 4.6 / p.caduta
		for i := 0; i < n && inizio+i < len(b.s); i++ {
			t := float64(i) / suoniRate
			env := (1 - math.Exp(-t/0.004)) * math.Exp(-t/tau)
			v := math.Sin(2 * math.Pi * f * t)
			if p.rapporto == 1 {
				v += 0.45 * math.Sin(2*math.Pi*f*1.004*t) // un secondo oscillatore appena stonato: la nota è più calda
			}
			b.s[inizio+i] += ampiezza * p.ampiezza * env * v
		}
	}
}

// soffio è un rumore filtrato la cui altezza va da da a a (Hz): sale o scende, con una finestra a campana. Due filtri passa-banda
// uno dopo l'altro lo tengono stretto attorno all'altezza (senza sibilo). Il rumore è sempre lo stesso.
func (b *miscela) soffio(t0, durata, da, a, ampiezza float64) {
	inizio, n := int(t0*suoniRate), int(durata*suoniRate)
	var basso1, banda1, basso2, banda2 float64
	seme := uint32(2463534242)
	for i := 0; i < n && inizio+i < len(b.s); i++ {
		x := float64(i) / float64(n)
		fc := da * math.Pow(a/da, x)
		f := 2 * math.Sin(math.Pi*fc/suoniRate)
		seme ^= seme << 13
		seme ^= seme >> 17
		seme ^= seme << 5
		rumore := float64(int32(seme)) / 2147483648.0
		basso1 += f * banda1
		banda1 += f * (rumore - basso1 - 0.7*banda1)
		basso2 += f * banda2
		banda2 += f * (banda1 - basso2 - 0.7*banda2)
		env := math.Sin(math.Pi * x)
		b.s[inizio+i] += ampiezza * env * env * banda2
	}
}

// comporre scrive il suono: nome "avvio" (un soffio che sale e quattro note che salgono) o "chiusura" (quattro note che scendono e un soffio che si spegne).
func comporre(nome string) []float64 {
	const sol4, sol5, si5, re6, sol6 = 392.00, 783.99, 987.77, 1174.66, 1567.98
	switch nome {
	case "avvio":
		b := &miscela{s: make([]float64, int(1.6*suoniRate))}
		b.soffio(0.00, 0.50, 380, 3200, 1.40)
		b.campana(0.30, sol4, 0.85, 0.35)
		b.campana(0.28, sol5, 0.85, 0.55)
		b.campana(0.38, si5, 0.82, 0.60)
		b.campana(0.48, re6, 0.80, 0.62)
		b.campana(0.62, sol6, 0.95, 0.85)
		return b.s
	case "chiusura":
		b := &miscela{s: make([]float64, int(1.5*suoniRate))}
		b.soffio(0.10, 0.45, 2600, 320, 1.00)
		b.campana(0.00, sol6, 0.60, 0.70)
		b.campana(0.14, re6, 0.65, 0.65)
		b.campana(0.28, si5, 0.75, 0.65)
		b.campana(0.44, sol5, 1.00, 0.85)
		b.campana(0.44, sol4, 1.00, 0.45)
		return b.s
	}
	return nil
}

// sintetizza restituisce il suono come file WAV (16 bit, mono, 44,1 kHz) con il picco del livello scelto; nil se nome o livello non esistono.
// La stessa richiesta dà sempre gli stessi byte.
func sintetizza(nome, livello string) []byte {
	picco, ok := livelliSuoni[livello]
	s := comporre(nome)
	if !ok || len(s) == 0 {
		return nil
	}
	fine := int(0.06 * suoniRate) // gli ultimi 60 ms scendono a zero: niente scatto alla fine
	for i := 0; i < fine && i < len(s); i++ {
		s[len(s)-1-i] *= float64(i) / float64(fine)
	}
	max := 0.0
	for _, v := range s {
		if a := math.Abs(v); a > max {
			max = a
		}
	}
	if max == 0 {
		return nil
	}
	k := picco / max
	dati := 2 * len(s)
	w := make([]byte, 44+dati)
	copy(w[0:], "RIFF")
	binary.LittleEndian.PutUint32(w[4:], uint32(36+dati))
	copy(w[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(w[16:], 16)
	binary.LittleEndian.PutUint16(w[20:], 1) // PCM
	binary.LittleEndian.PutUint16(w[22:], 1) // mono
	binary.LittleEndian.PutUint32(w[24:], suoniRate)
	binary.LittleEndian.PutUint32(w[28:], suoniRate*2)
	binary.LittleEndian.PutUint16(w[32:], 2)
	binary.LittleEndian.PutUint16(w[34:], 16)
	copy(w[36:], "data")
	binary.LittleEndian.PutUint32(w[40:], uint32(dati))
	for i, v := range s {
		binary.LittleEndian.PutUint16(w[44+2*i:], uint16(int16(math.Round(v*k*32767))))
	}
	return w
}

func durataWAV(w []byte) time.Duration {
	if len(w) <= 44 {
		return 0
	}
	return time.Duration(float64(len(w)-44) / 2 / suoniRate * float64(time.Second))
}

/* ---------- scelta e riproduzione ---------- */

// Suoni tiene la scelta e suona. suona è la funzione del sistema (nil se non c'è): riceve un file WAV e torna subito.
type Suoni struct {
	mu          sync.Mutex
	path        string
	livello     string
	suona       func(wav []byte) error
	disponibile bool // il sistema sa suonare (Windows)
	cache       map[string][]byte
	ultimo      map[string]time.Time
	fine        time.Time // quando finisce il suono in corso
	richieste   map[string]int
	inProva     bool
	now         func() time.Time
	pausa       func(time.Duration) // tra i due suoni della prova
}

// ApriSuoni legge la scelta fatta (se manca o è illeggibile vale «piano»).
func ApriSuoni(dir string, suona func([]byte) error, disponibile bool) *Suoni {
	s := &Suoni{
		path: filepath.Join(dir, suoniFile), livello: suoniBase, suona: suona, disponibile: disponibile,
		cache: map[string][]byte{}, ultimo: map[string]time.Time{}, richieste: map[string]int{}, now: time.Now, pausa: time.Sleep,
	}
	if raw, err := os.ReadFile(s.path); err == nil {
		var c struct {
			Livello string `json:"livello"`
		}
		if json.Unmarshal(raw, &c) == nil && livelloValido(c.Livello) {
			s.livello = c.Livello
		}
	}
	return s
}

// Livello dice com'è impostato: "spento", "piano" o "normale".
func (s *Suoni) Livello() string {
	if s == nil {
		return "spento"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.livello
}

// Imposta cambia la scelta e la scrive in suoni.json.
func (s *Suoni) Imposta(livello string) error {
	if s == nil {
		return errors.New("i suoni non sono disponibili")
	}
	if !livelloValido(livello) {
		return errors.New("scelta non valida: spenti, piano o normale")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.MarshalIndent(map[string]string{"livello": livello}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		os.Remove(tmp)
		return err
	}
	s.livello = livello // la scelta vale solo se si è potuta scrivere: altrimenti la pagina e il file direbbero cose diverse
	return nil
}

func (s *Suoni) wav(nome, livello string) []byte {
	k := nome + "/" + livello
	if w, ok := s.cache[k]; ok {
		return w
	}
	w := sintetizza(nome, livello)
	s.cache[k] = w // resta in memoria: il sistema lo legge mentre suona
	return w
}

// suonaOra suona (con il blocco preso). Vero se il suono è partito.
func (s *Suoni) suonaOra(nome string, limita bool) (partito bool) {
	if !suonoValido(nome) {
		return false
	}
	s.richieste[nome]++
	if s.livello == "spento" || s.suona == nil {
		return false
	}
	t := s.now()
	if limita && t.Sub(s.ultimo[nome]) < suoniPausa {
		return false
	}
	w := s.wav(nome, s.livello)
	if len(w) == 0 {
		return false
	}
	var err error
	func() {
		defer func() {
			if recover() != nil {
				err = errors.New("audio non riuscito")
			}
		}()
		err = s.suona(w)
	}()
	if err != nil {
		logAvviso("suoni", "non riesco a suonare «%s»: %v", nome, err)
		return false
	}
	s.ultimo[nome] = t
	s.fine = t.Add(durataWAV(w))
	return true
}

// Suona fa partire "avvio" o "chiusura" con la scelta fatta. Vero se si sente qualcosa.
func (s *Suoni) Suona(nome string) bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suonaOra(nome, true)
}

// Prova fa sentire i due suoni uno dopo l'altro (si preme «Prova i suoni»). Falso se sono spenti o una prova è già in corso.
func (s *Suoni) Prova() bool {
	if s == nil {
		return false
	}
	s.mu.Lock()
	s.richieste["prova"]++
	if s.livello == "spento" || s.suona == nil || s.inProva {
		s.mu.Unlock()
		return false
	}
	s.inProva = true
	s.mu.Unlock()
	go func() {
		s.mu.Lock()
		s.suonaOra("avvio", false)
		attesa := s.fine.Sub(s.now()) + 300*time.Millisecond
		s.mu.Unlock()
		s.pausa(attesa)
		s.mu.Lock()
		s.suonaOra("chiusura", false)
		s.inProva = false
		s.mu.Unlock()
	}()
	return true
}

// Attendi aspetta (al massimo max) che finisca il suono in corso: il programma non si chiude prima di averlo fatto sentire.
func (s *Suoni) Attendi(max time.Duration) {
	if s == nil {
		return
	}
	s.mu.Lock()
	resto := s.fine.Sub(s.now())
	s.mu.Unlock()
	if resto <= 0 {
		return
	}
	if resto > max {
		resto = max
	}
	time.Sleep(resto + 100*time.Millisecond)
}

// Stato è quello che vede la pagina.
func (s *Suoni) Stato() map[string]any {
	if s == nil {
		return map[string]any{"livello": "spento", "disponibile": false, "richieste": map[string]int{}}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	r := map[string]int{}
	for k, v := range s.richieste {
		r[k] = v
	}
	return map[string]any{"livello": s.livello, "disponibile": s.disponibile, "richieste": r}
}

/* ---------- richieste della pagina (solo dal computer del programma) ---------- */

// handleSuoni: GET dice la scelta; POST { livello?, suona? } la cambia e/o fa partire "avvio", "chiusura" o "prova".
func (s *Server) handleSuoni(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, s.suoni.Stato())
		return
	}
	var in struct {
		Livello *string `json:"livello"`
		Suona   string  `json:"suona"`
	}
	if !readJSON(r, &in) {
		badRequest(w)
		return
	}
	if in.Suona != "" && in.Suona != "prova" && !suonoValido(in.Suona) {
		badRequest(w)
		return
	}
	if in.Livello != nil {
		if err := s.suoni.Imposta(*in.Livello); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"errore": messaggioErrore(err)})
			return
		}
	}
	switch in.Suona {
	case "":
	case "prova":
		s.suoni.Prova()
	default:
		s.suoni.Suona(in.Suona)
	}
	writeJSON(w, http.StatusOK, s.suoni.Stato())
}

// suonoChiusura fa sentire il suono di chiusura e aspetta che finisca, prima che il programma si fermi.
func (s *Server) suonoChiusura() {
	s.suoni.Suona("chiusura")
	s.suoni.Attendi(2 * time.Second)
}
