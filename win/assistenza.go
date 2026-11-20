package main

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Il file per l'assistenza: un solo file di testo che la segreteria crea con un pulsante e manda a chi cura il programma.
// Dice com'è fatto il programma e il computer, quanti dati ci sono (solo i numeri), come vanno le copie e gli aggiornamenti, e gli ultimi
// errori del diario tecnico. Non ha mai nomi, codici fiscali, telefoni, indirizzi, importi, note, documenti o password: si può aprire con il
// Blocco note e leggere prima di mandarlo (la pagina lo mostra per intero).
const (
	assistenzaDir   = "assistenza"
	assistenzaTieni = 5   // quanti file tenere: i più vecchi si tolgono
	assistenzaVoci  = 150 // quante righe del diario ci vanno
)

var reAssistenza = regexp.MustCompile(`^assistenza-\d{4}-\d{2}-\d{2}-\d{4,6}\.txt$`)

var processoAvviato = time.Now()

// dimensioneTesto scrive una misura in byte come la si dice a voce: «812 byte», «2,4 MB».
func dimensioneTesto(n int64) string {
	f := func(v float64, u string) string {
		return strings.Replace(strconv.FormatFloat(v, 'f', 1, 64), ".", ",", 1) + " " + u
	}
	switch {
	case n < 1<<10:
		return strconv.FormatInt(n, 10) + " byte"
	case n < 1<<20:
		return f(float64(n)/(1<<10), "KB")
	case n < 1<<30:
		return f(float64(n)/(1<<20), "MB")
	}
	return f(float64(n)/(1<<30), "GB")
}

// durataTesto: «2 ore 5 minuti».
func durataTesto(d time.Duration) string {
	if d < time.Minute {
		return "meno di un minuto"
	}
	m := int(d.Minutes())
	var out []string
	if g := m / 1440; g > 0 {
		out = append(out, plurale(g, "giorno", "giorni"))
		m -= g * 1440
	}
	if h := m / 60; h > 0 {
		out = append(out, plurale(h, "ora", "ore"))
		m -= h * 60
	}
	if m > 0 {
		out = append(out, plurale(m, "minuto", "minuti"))
	}
	return strings.Join(out, " ")
}

func plurale(n int, uno, molti string) string {
	if n == 1 {
		return "1 " + uno
	}
	return strconv.Itoa(n) + " " + molti
}

// quandoTesto rende una data RFC 3339 come «20/11/2026 10:15». Se non si capisce la ripulisce e la lascia com'è.
func quandoTesto(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Local().Format("02/01/2006 15:04")
	}
	return ripulisciTesto(iso, 40)
}

// pulito è un testo del programma (un errore, un percorso) pronto per il file: senza il nome dell'utente e senza a capo.
func (d *Diario) pulito(s string) string {
	if d != nil {
		if len(d.dir) >= 4 {
			s = strings.ReplaceAll(s, d.dir, "<dati>")
		}
		if d.casa != "" {
			s = strings.ReplaceAll(s, d.casa, "~")
		}
	}
	return ripulisciTesto(s, 300)
}

// percorso è un percorso da mostrare: con «~» al posto della cartella dell'utente.
func (d *Diario) percorso(p string) string {
	if d != nil && d.casa != "" {
		p = strings.ReplaceAll(p, d.casa, "~")
	}
	return ripulisciTesto(p, 300)
}

type rapporto struct {
	b strings.Builder
	d *Diario
}

func (r *rapporto) titolo(t string)        { r.b.WriteString("\n== " + t + " ==\n") }
func (r *rapporto) riga(e, v string)       { r.b.WriteString(e + ": " + v + "\n") }
func (r *rapporto) testo(t string)         { r.b.WriteString(t + "\n") }
func (r *rapporto) sino(e string, v bool)  { r.riga(e, map[bool]string{true: "sì", false: "no"}[v]) }
func (r *rapporto) errore(e, msg string)   { r.riga(e, r.d.pulito(msg)) }
func (r *rapporto) numeri(e string, n int) { r.riga(e, strconv.Itoa(n)) }

// rapportoAssistenza compone il testo del file. Tutto quello che entra è un numero, uno stato o un errore del programma già ripulito.
func (s *Server) rapportoAssistenza() string {
	d := diarioAttivo.Load()
	r := &rapporto{d: d}
	adesso := time.Now()
	nome, scarto := adesso.Zone()
	r.testo("GYM ART SEGRETERIA - FILE PER L'ASSISTENZA")
	r.testo("Creato il " + adesso.Format("02/01/2006 15:04") + " (ora del computer)")
	r.testo("")
	r.testo("Che cosa contiene: informazioni tecniche sul programma e sul computer, quanti dati ci sono nell'archivio (solo i numeri), come vanno le copie")
	r.testo("e gli aggiornamenti, e gli ultimi errori annotati dal programma.")
	r.testo("Che cosa NON contiene: nomi, codici fiscali, telefoni, indirizzi, importi, note, certificati, documenti, password.")
	r.testo("Si può aprire con il Blocco note e leggere prima di mandarlo.")

	r.titolo("PROGRAMMA")
	r.riga("Versione", s.version)
	r.riga("Aperto da", durataTesto(time.Since(processoAvviato)))
	r.riga("Sistema", versioneSistema()+", "+runtime.GOARCH)
	r.riga("Compilatore", runtime.Version())
	r.numeri("Processori", runtime.NumCPU())
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	r.riga("Memoria usata dal programma", dimensioneTesto(int64(ms.Sys)))
	r.riga("Fuso orario", fmt.Sprintf("%s (%+03d:%02d)", nome, scarto/3600, (scarto%3600)/60))
	if exe, err := os.Executable(); err == nil {
		r.riga("Programma in", d.percorso(filepath.Dir(exe)))
		r.sino("La sua cartella è scrivibile (serve per gli aggiornamenti)", cartellaScrivibile(filepath.Dir(exe)))
	}
	if leggiAvvio != nil {
		r.sino("Parte con Windows", leggiAvvio())
	}

	r.titolo("ARCHIVIO")
	dir := s.store.Dir()
	r.riga("Cartella dei dati", d.percorso(dir))
	r.sino("La cartella è scrivibile", cartellaScrivibile(dir))
	if liberi, totali, ok := spazioLibero(dir); ok {
		r.riga("Spazio libero sul disco dei dati", dimensioneTesto(liberi)+" su "+dimensioneTesto(totali))
	}
	if fi, err := os.Stat(filepath.Join(dir, archiveName)); err == nil {
		r.riga("Archivio", "presente, "+dimensioneTesto(fi.Size()))
	} else {
		r.riga("Archivio", "non c'è ancora (o non si legge)")
	}
	r.sino("Protetto da password", s.store.Protected())
	if s.store.Locked() {
		r.riga("Numero dei dati", "non leggibile: l'archivio aspetta la password")
	} else {
		rev, db, salvato := s.store.State()
		if db != nil {
			c := countDB(db)
			r.riga("Allieve", strconv.Itoa(c.Allieve))
			r.riga("Iscrizioni", strconv.Itoa(c.Iscrizioni))
			r.riga("Pagamenti", strconv.Itoa(c.Pagamenti))
			r.riga("Salvataggi fatti", strconv.FormatInt(rev, 10))
			if salvato != "" {
				r.riga("Ultimo salvataggio", quandoTesto(salvato))
			}
		}
	}
	sic := s.store.Safety()
	r.riga("Registro delle modifiche", plurale(sic.RegistroRighe, "riga", "righe")+", "+dimensioneTesto(sic.RegistroByte))
	if voci, err := os.ReadDir(filepath.Join(dir, documentiDir)); err == nil {
		var n int
		var tot int64
		for _, v := range voci {
			if fi, err := v.Info(); err == nil && !v.IsDir() && reDocumento.MatchString(v.Name()) {
				n++
				tot += fi.Size()
			}
		}
		r.riga("Documenti scansionati", plurale(n, "file", "file")+", "+dimensioneTesto(tot))
	} else {
		r.riga("Documenti scansionati", "nessuno")
	}

	r.titolo("COPIE DI SICUREZZA")
	r.numeri("Copie recenti (cartella copie)", sic.Recenti)
	if sic.Giornaliere > 0 {
		r.riga("Copie giornaliere", fmt.Sprintf("%d, dal %s al %s", sic.Giornaliere, sic.Prima, sic.UltimaGiorno))
		if sic.Ultima != "" {
			r.riga("L'ultima è stata fatta il", quandoTesto(sic.Ultima))
		}
	} else {
		r.riga("Copie giornaliere", "nessuna")
	}
	if sic.Errore != "" {
		r.errore("Ultimo errore delle copie giornaliere", sic.Errore)
	} else {
		r.riga("Ultimo errore delle copie giornaliere", "nessuno")
	}
	if rc := sic.Recupero; rc != nil {
		r.riga("Recupero automatico all'avvio", fmt.Sprintf("avvenuto il %s: l'archivio era %s, rimesso da «%s» (salvato il %s)", quandoTesto(rc.Quando), d.pulito(rc.Motivo), d.pulito(rc.Da), quandoTesto(rc.Salvato)))
	} else {
		r.riga("Recupero automatico all'avvio", "nessuno da leggere")
	}
	m := s.mirrorStatus()
	if m.Cartella == "" {
		r.riga("Seconda copia", "non impostata")
	} else {
		r.riga("Seconda copia", "impostata su "+d.percorso(m.Cartella))
		if m.Ultima != "" {
			r.riga("  ultima riuscita il", quandoTesto(m.Ultima))
		} else {
			r.riga("  ultima riuscita il", "mai")
		}
		if m.Errore != "" {
			r.errore("  errore", m.Errore)
		}
		if m.Avviso != "" {
			r.errore("  avviso", m.Avviso)
		}
		r.numeri("  copie giornaliere lì", m.Giornaliere)
	}

	r.titolo("ACCESSO DAL TELEFONO")
	st := s.rete.Stato()
	r.sino("Acceso", st.Attiva)
	r.sino("Password impostata", st.HaPassword)
	if st.Attiva {
		r.sino("In ascolto", st.InAscolto)
		r.numeri("Porta", st.Porta)
		if st.Certificato != "" {
			r.riga("Certificato", st.Certificato)
		}
		r.numeri("Dispositivi con l'accesso aperto", st.Sessioni)
	}
	if st.Errore != "" {
		r.errore("Errore", st.Errore)
	}

	r.titolo("AGGIORNAMENTI")
	ag := s.agg.Stato()
	r.riga("Versione installata", ag.Versione)
	r.sino("Controllo automatico", ag.Automatico)
	if ag.CanalePredef {
		r.riga("Canale", "quello predefinito")
	} else {
		r.riga("Canale", "scelto a mano, sul sito "+d.pulito(sitoDi(ag.Canale))) // solo il sito: il resto dell'indirizzo può portare il nome di chi pubblica
	}
	if ag.UltimoControllo != "" {
		r.riga("Ultimo controllo", quandoTesto(ag.UltimoControllo))
	} else {
		r.riga("Ultimo controllo", "mai")
	}
	if ag.Errore != "" {
		r.errore("Ultimo errore", ag.Errore)
	}
	if ag.Disponibile != nil {
		r.riga("Versione disponibile", d.pulito(ag.Disponibile.Versione))
	} else if ag.CanaleVuoto {
		r.riga("Versione disponibile", "il canale è ancora vuoto")
	} else {
		r.riga("Versione disponibile", "nessuna più nuova")
	}
	r.sino("Questo computer può installare da solo", ag.Installabile)

	r.titolo("SUONI")
	su := s.suoni.Stato()
	r.riga("Scelta", fmt.Sprint(su["livello"]))
	r.riga("Il sistema sa suonare", map[bool]string{true: "sì", false: "no"}[su["disponibile"] == true])

	r.titolo("DIARIO TECNICO")
	e, a := d.Conteggio(adesso.Add(-24 * time.Hour))
	r.riga("Nelle ultime 24 ore", plurale(e, "errore", "errori")+", "+plurale(a, "avviso", "avvisi"))
	if t := d.Testo(assistenzaVoci); t != "" {
		r.testo("Ultime voci, dalla più vecchia alla più recente (data | livello | dove | testo):")
		r.testo(t)
	} else {
		r.testo("Il diario è vuoto.")
	}
	return r.b.String()
}

// sitoDi dà il solo nome del sito di un indirizzo («raw.githubusercontent.com»).
func sitoDi(indirizzo string) string {
	u, err := url.Parse(indirizzo)
	if err != nil || u.Host == "" {
		return "(indirizzo non valido)"
	}
	return u.Host
}

// cartellaScrivibile prova a creare e togliere un file nella cartella.
func cartellaScrivibile(dir string) bool {
	f, err := os.CreateTemp(dir, ".prova-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// POST /api/assistenza (solo dal computer): crea il file e dice come si chiama. La pagina ne mostra il testo.
func (s *Server) handleAssistenzaPost(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"errore": "Il file per l'assistenza si crea solo dal computer della segreteria."})
		return
	}
	testo := s.rapportoAssistenza()
	dir := filepath.Join(s.store.Dir(), assistenzaDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		logErrore("assistenza", "non riesco a preparare la cartella: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a preparare la cartella del file: " + err.Error()})
		return
	}
	nome := "assistenza-" + time.Now().Format("2006-01-02-150405") + ".txt"
	contenuto := strings.ReplaceAll(testo, "\n", "\r\n") // il Blocco note di Windows più vecchio vuole gli «a capo» completi
	if err := writeAtomic(filepath.Join(dir, nome), []byte(contenuto)); err != nil {
		logErrore("assistenza", "non riesco a scrivere il file: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a salvare il file: " + err.Error()})
		return
	}
	togliVecchiAssistenza(dir, assistenzaTieni)
	logInfo("assistenza", "creato il file %s (%d byte)", nome, len(contenuto))
	writeJSON(w, http.StatusOK, map[string]any{"file": nome, "byte": len(contenuto), "cartella": diarioAttivo.Load().percorso(dir), "testo": testo})
}

// togliVecchiAssistenza lascia gli ultimi n file e toglie gli altri (i nomi si ordinano per data).
func togliVecchiAssistenza(dir string, n int) {
	voci, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var nomi []string
	for _, v := range voci {
		if !v.IsDir() && reAssistenza.MatchString(v.Name()) {
			nomi = append(nomi, v.Name())
		}
	}
	sort.Strings(nomi)
	for i := 0; i < len(nomi)-n; i++ {
		os.Remove(filepath.Join(dir, nomi[i]))
	}
}

// GET /api/assistenza/{file} (solo dal computer): il file da scaricare. Il gettone arriva nell'indirizzo, come per i documenti.
func (s *Server) handleAssistenzaGet(w http.ResponseWriter, r *http.Request) {
	nome := r.PathValue("file")
	if !s.local(r) || !reAssistenza.MatchString(nome) {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(s.store.Dir(), assistenzaDir, nome))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+nome+`"`)
	w.Write(b)
}

// GET /api/diario (solo dal computer): le ultime voci del diario, per la pagina.
func (s *Server) handleDiarioGet(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"errore": "Il diario tecnico si legge solo dal computer della segreteria."})
		return
	}
	n, _ := strconv.Atoi(r.URL.Query().Get("n"))
	if n <= 0 || n > 500 {
		n = 40
	}
	d := diarioAttivo.Load()
	e, a := d.Conteggio(time.Now().Add(-24 * time.Hour))
	writeJSON(w, http.StatusOK, map[string]any{"voci": d.Voci(n), "errori24h": e, "avvisi24h": a, "file": diarioNome})
}

// Quanti errori della pagina si scrivono al minuto: una pagina che si rompe in ciclo non deve coprire il resto del diario.
const paginaAlMinuto = 20

type limitePagina struct {
	mu     sync.Mutex
	minuto time.Time
	n      int
}

func (l *limitePagina) ammesso(t time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if t.Sub(l.minuto) >= time.Minute || t.Before(l.minuto) {
		l.minuto, l.n = t, 0
	}
	l.n++
	return l.n <= paginaAlMinuto
}

// POST /api/diario: la pagina riferisce un errore imprevisto (di una finestra del computer o di un telefono). Risponde sempre senza contenuto:
// la pagina non deve aspettare né ripetere. Il testo si ripulisce come ogni voce.
func (s *Server) handleDiarioPost(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<10)
	var in struct {
		Tipo      string   `json:"tipo"`
		Messaggio string   `json:"messaggio"`
		Pila      []string `json:"pila"`
		Pagina    string   `json:"pagina"`
	}
	if !readJSON(r, &in) {
		badRequest(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	if !s.limitePagina.ammesso(time.Now()) {
		return
	}
	dove := "pagina"
	if !s.local(r) {
		dove = "pagina-telefono"
	}
	if len(in.Pila) > 6 {
		in.Pila = in.Pila[:6]
	}
	for i, f := range in.Pila {
		in.Pila[i] = ripulisciTesto(f, 70)
	}
	tipo := "errore"
	if in.Tipo == "promessa" {
		tipo = "errore non gestito"
	}
	msg := ripulisciTesto(in.Messaggio, 220)
	if strings.Contains(strings.ToLower(msg), "json") { // il testo di un errore di lettura può citare il pezzo di file che non andava: meglio non scriverlo
		msg = "JSON non valido (testo omesso)"
	}
	voce := fmt.Sprintf("%s: %s | pagina «%s»", tipo, msg, ripulisciTesto(in.Pagina, 30))
	if len(in.Pila) > 0 {
		voce += " | " + strings.Join(in.Pila, " < ")
	}
	logErrore(dove, "%s", voce)
}
