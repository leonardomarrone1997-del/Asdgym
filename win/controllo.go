package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Il controllo del computer: alcune prove rapide, fatte quando la persona preme «Controlla questo computer» (Impostazioni › Assistenza) e
// riportate anche nel file per l'assistenza. Dicono in italiano semplice che cosa va e che cosa no: l'orologio, la cartella dei dati e il suo
// spazio, le copie, la seconda copia, la cartella del programma (serve per gli aggiornamenti), il canale degli aggiornamenti, il browser che
// apre la finestra, lo scanner, i suoni, l'avvio con Windows, l'accesso dal telefono, gli errori delle ultime ore.
// Esiste perché una parte del programma (scanner, suoni, aggiornamento che sostituisce il programma) si può provare solo su Windows vero.
// Non cambia niente: legge e basta. Nessun dato delle persone: solo percorsi (ripuliti), numeri e stati.

// Gli stati di un esito.
const (
	esitoOk     = "ok"     // a posto
	esitoAvviso = "avviso" // da guardare, ma il programma lavora
	esitoErrore = "errore" // un problema
	esitoInfo   = "info"   // una cosa da sapere, o una prova che qui non si può fare
)

// errNonDisponibile: la prova non si può fare su questo sistema (o non è stata collegata, nelle prove).
var errNonDisponibile = errors.New("non disponibile su questo sistema")

// Esito è il risultato di una prova.
type Esito struct {
	Cosa      string `json:"cosa"`
	Stato     string `json:"stato"`
	Testo     string `json:"testo"`
	Consiglio string `json:"consiglio,omitempty"`
}

// Sonde sono le prove che dipendono dal computer: Windows le sa fare, altrove (e nelle prove automatiche) restano vuote o si sostituiscono.
// Una sonda vuota dà un esito «non controllato», mai un guasto.
type Sonde struct {
	Browser func() string                          // il browser che apre la finestra («Microsoft Edge», «Google Chrome»), o ""
	Scanner func(ctx context.Context) (int, error) // quanti scanner vede Windows
	Audio   func() (int, error)                    // quante uscite audio ha il computer
	Canale  func(ctx context.Context) error        // il canale degli aggiornamenti risponde?
	Adesso  func() time.Time
}

// sondeSistema: le prove vere, per il programma che gira (le definisce ogni sistema: controllo_windows.go, controllo_other.go).
func sondeSistema() Sonde {
	return Sonde{Browser: browserTrovato, Scanner: contaScanner, Audio: contaAudio, Adesso: time.Now}
}

const (
	annoMinimo     = 2026               // il programma è di quest'anno: un orologio prima è sbagliato
	spazioAvviso   = 1 << 30            // sotto 1 GB si avvisa
	spazioErrore   = 100 << 20          // sotto 100 MB è un problema
	copiaVecchia   = 2 * 24 * time.Hour // una copia giornaliera più vecchia di così è strana
	secondaVecchia = 3 * 24 * time.Hour // la seconda copia ferma da tanto
)

// I tempi sono variabili solo perché le prove li accorciano.
var (
	tempoControllo = 25 * time.Second // il controllo intero
	tempoSonda     = 20 * time.Second // una sola sonda lenta (PowerShell)
)

// classificaSpazio dice se lo spazio libero sul disco dei dati è a posto, da guardare o un problema.
func classificaSpazio(liberi int64) string {
	switch {
	case liberi < spazioErrore:
		return esitoErrore
	case liberi < spazioAvviso:
		return esitoAvviso
	}
	return esitoOk
}

// Raggiungibile dice se il canale degli aggiornamenti risponde (200, o 404: «ancora vuoto» non è un guasto). Non scarica niente e non cambia lo stato.
// Con noAuto (le prove) non va su internet.
func (a *Aggiornamenti) Raggiungibile(ctx context.Context) error {
	if a.noAuto {
		return errNonDisponibile
	}
	a.mu.Lock()
	canale := a.canale()
	a.mu.Unlock()
	ctx, annulla := context.WithTimeout(ctx, 6*time.Second)
	defer annulla()
	resp, err := a.richiesta(ctx, canale+nomeManifesto)
	if err != nil {
		return errors.New(messaggioErrore(err))
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNotFound {
		return fmt.Errorf("il canale risponde con il codice %d", resp.StatusCode)
	}
	return nil
}

func dataBreve(t time.Time) string { return t.Local().Format("02/01/2006 15:04") }

// controllaComputer fa tutte le prove (le lente insieme, ciascuna con il suo tempo) e le mette in un ordine fisso.
func (s *Server) controllaComputer(ctx context.Context) []Esito {
	ctx, annulla := context.WithTimeout(ctx, tempoControllo)
	defer annulla()
	p := s.sonde
	if p.Adesso == nil {
		p.Adesso = time.Now
	}
	d := diarioAttivo.Load()

	// le prove lente (PowerShell, internet) partono subito e si aspettano alla fine
	var wg sync.WaitGroup
	var nScanner, nAudio int
	var errScanner, errAudio, errCanale error
	if p.Scanner != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer recuperaPanic("controllo")
			c, fine := context.WithTimeout(ctx, tempoSonda)
			defer fine()
			nScanner, errScanner = p.Scanner(c)
		}()
	}
	if p.Canale != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer recuperaPanic("controllo")
			errCanale = p.Canale(ctx)
		}()
	}
	if p.Audio != nil {
		nAudio, errAudio = p.Audio()
	}

	var out []Esito
	aggiungi := func(cosa, stato, testo, consiglio string) {
		out = append(out, Esito{Cosa: cosa, Stato: stato, Testo: testo, Consiglio: consiglio})
	}
	adesso := p.Adesso()
	dir := s.store.Dir()

	// 1. l'orologio: le scadenze si contano con quello
	_, _, salvato := s.store.State()
	zona, _ := adesso.Zone()
	switch ultimo, err := time.Parse(time.RFC3339, salvato); {
	case adesso.Year() < annoMinimo:
		aggiungi("Orologio", esitoAvviso, "L'orologio del computer segna il "+dataBreve(adesso)+": sembra indietro.", "Metti a posto data e ora in Windows: gli abbonamenti e i certificati scadono secondo l'orologio.")
	case err == nil && ultimo.After(adesso.Add(24*time.Hour)):
		aggiungi("Orologio", esitoAvviso, "L'ultimo salvataggio è del "+dataBreve(ultimo)+", cioè dopo l'ora che segna il computer ("+dataBreve(adesso)+").", "L'orologio è stato spostato indietro? Controlla data e ora in Windows.")
	default:
		aggiungi("Orologio", esitoOk, "Il computer segna il "+dataBreve(adesso)+" (fuso orario "+zona+").", "")
	}

	// 2. la cartella dei dati
	switch liberi, totali, ok := spazioLibero(dir); {
	case !cartellaScrivibile(dir):
		aggiungi("Cartella dei dati", esitoErrore, "Non riesco a scrivere nella cartella dei dati ("+d.percorso(dir)+").", "Senza, il programma non può salvare. Controlla che il disco o la chiavetta ci siano e che la cartella non sia in sola lettura.")
	case ok && classificaSpazio(liberi) == esitoErrore:
		aggiungi("Cartella dei dati", esitoErrore, "Sul disco dei dati restano solo "+dimensioneTesto(liberi)+".", "Libera spazio: con il disco pieno il programma non riesce più a salvare.")
	case ok && classificaSpazio(liberi) == esitoAvviso:
		aggiungi("Cartella dei dati", esitoAvviso, "Sul disco dei dati restano "+dimensioneTesto(liberi)+" su "+dimensioneTesto(totali)+".", "Conviene liberare un po' di spazio.")
	case ok:
		aggiungi("Cartella dei dati", esitoOk, "Si può scrivere in "+d.percorso(dir)+". Spazio libero: "+dimensioneTesto(liberi)+" su "+dimensioneTesto(totali)+".", "")
	default:
		aggiungi("Cartella dei dati", esitoOk, "Si può scrivere in "+d.percorso(dir)+".", "")
	}

	// 3. l'archivio e la copia di oggi
	sic := s.store.Safety()
	oggi := adesso.Local().Format("2006-01-02")
	switch {
	case s.store.Locked():
		aggiungi("Archivio e copie", esitoInfo, "L'archivio aspetta la password: le copie non si possono controllare adesso.", "")
	case sic.Errore != "":
		aggiungi("Archivio e copie", esitoAvviso, "L'ultima copia giornaliera non è riuscita: "+d.pulito(sic.Errore), "Controlla lo spazio sul disco e riprova da Impostazioni › Sicurezza dei dati › «Fai una copia ora».")
	case sic.Recupero != nil:
		aggiungi("Archivio e copie", esitoAvviso, "All'ultimo avvio l'archivio era "+d.pulito(sic.Recupero.Motivo)+" ed è stato rimesso da una copia (salvata il "+quandoTesto(sic.Recupero.Salvato)+").", "Controlla che i dati siano quelli giusti, poi in Impostazioni › Sicurezza dei dati conferma di aver letto l'avviso. Se succede ancora, manda il file per l'assistenza.")
	case sic.Giornaliere == 0:
		if _, db, _ := s.store.State(); db != nil {
			aggiungi("Archivio e copie", esitoAvviso, "Non c'è ancora nessuna copia giornaliera.", "Si fa da sola al primo salvataggio del giorno; oppure Impostazioni › Sicurezza dei dati › «Fai una copia ora».")
		} else {
			aggiungi("Archivio e copie", esitoInfo, "L'archivio è ancora vuoto: non c'è niente da copiare.", "")
		}
	case sic.UltimaGiorno == oggi:
		aggiungi("Archivio e copie", esitoOk, plurale(sic.Giornaliere, "copia giornaliera", "copie giornaliere")+"; quella di oggi c'è ed è stata riletta.", "")
	default:
		if g, err := time.ParseInLocation("2006-01-02", sic.UltimaGiorno, time.Local); err == nil && adesso.Sub(g) > copiaVecchia {
			aggiungi("Archivio e copie", esitoAvviso, "L'ultima copia giornaliera è del "+sic.UltimaGiorno[8:]+"/"+sic.UltimaGiorno[5:7]+"/"+sic.UltimaGiorno[:4]+".", "Se il programma resta chiuso o non si salva niente, la copia nuova non c'è: va bene. Altrimenti fai una copia ora da Impostazioni › Sicurezza dei dati.")
		} else {
			aggiungi("Archivio e copie", esitoOk, plurale(sic.Giornaliere, "copia giornaliera", "copie giornaliere")+"; l'ultima è del "+sic.UltimaGiorno[8:]+"/"+sic.UltimaGiorno[5:7]+".", "")
		}
	}

	// 4. la seconda copia
	m := s.mirrorStatus()
	switch {
	case m.Cartella == "":
		aggiungi("Seconda copia", esitoAvviso, "Non è impostata: le copie stanno sullo stesso disco dei dati.", "Se il disco si rompe si perde tutto. Imposta una chiavetta o un disco esterno in Impostazioni › Dati su questo computer.")
	case m.Errore != "":
		aggiungi("Seconda copia", esitoErrore, d.pulito(m.Errore), "Collega la chiavetta o il disco, oppure scegli un'altra cartella in Impostazioni › Dati su questo computer.")
	default:
		if _, err := os.Stat(m.Cartella); err != nil {
			aggiungi("Seconda copia", esitoErrore, "La cartella "+d.percorso(m.Cartella)+" non risponde (chiavetta scollegata?).", "Collegala: la copia riparte da sola.")
		} else if t, err := time.Parse(time.RFC3339, m.Ultima); err != nil {
			aggiungi("Seconda copia", esitoAvviso, "In "+d.percorso(m.Cartella)+" non è ancora stata fatta nessuna copia.", "Premi «Copia adesso» in Impostazioni › Dati su questo computer.")
		} else if adesso.Sub(t) > secondaVecchia {
			aggiungi("Seconda copia", esitoAvviso, "In "+d.percorso(m.Cartella)+" l'ultima copia è del "+dataBreve(t)+".", "La chiavetta è stata collegata? Premi «Copia adesso» in Impostazioni › Dati su questo computer.")
		} else if m.Avviso != "" {
			aggiungi("Seconda copia", esitoAvviso, d.pulito(m.Avviso), "")
		} else {
			aggiungi("Seconda copia", esitoOk, "In "+d.percorso(m.Cartella)+", aggiornata il "+dataBreve(t)+".", "")
		}
	}

	// 5. gli errori che il programma ha annotato di recente
	if d != nil {
		if e, a := d.Conteggio(adesso.Add(-24 * time.Hour)); e > 0 {
			aggiungi("Errori recenti", esitoAvviso, plurale(e, "errore annotato", "errori annotati")+" nelle ultime 24 ore dal programma.", "Guarda l'elenco qui sotto («Diario tecnico») o crea il file per l'assistenza e mandalo.")
		} else if a > 0 {
			aggiungi("Errori recenti", esitoInfo, "Nessun errore nelle ultime 24 ore; "+plurale(a, "avviso", "avvisi")+" nel diario tecnico.", "")
		} else {
			aggiungi("Errori recenti", esitoOk, "Nessun errore né avviso nelle ultime 24 ore.", "")
		}
	}

	// 6. la cartella del programma: gli aggiornamenti ci scrivono il programma nuovo
	if exe, err := os.Executable(); err == nil {
		cartella := filepath.Dir(exe)
		switch {
		case !installabile():
			aggiungi("Aggiornamenti: cartella del programma", esitoInfo, "Gli aggiornamenti automatici funzionano solo su Windows.", "")
		case !cartellaScrivibile(cartella):
			aggiungi("Aggiornamenti: cartella del programma", esitoAvviso, "Il programma sta in "+d.percorso(cartella)+", dove non può scrivere: l'aggiornamento automatico non potrebbe sostituirlo.", "Metti il programma in una cartella tua (per esempio sul Desktop o in Documenti), non in «Programmi».")
		default:
			aggiungi("Aggiornamenti: cartella del programma", esitoOk, "Il programma sta in "+d.percorso(cartella)+" e può sostituirsi da solo quando c'è una versione nuova.", "")
		}
	}

	// 7. il canale degli aggiornamenti e l'avvio con Windows: si aspettano le prove lente
	wg.Wait()
	st := s.agg.Stato()
	switch {
	case p.Canale == nil || errors.Is(errCanale, errNonDisponibile):
		aggiungi("Aggiornamenti: canale", esitoInfo, "Non controllato in questa prova (nessun collegamento a internet fatto).", "")
	case errCanale != nil:
		aggiungi("Aggiornamenti: canale", esitoAvviso, "Non riesco a raggiungere il canale degli aggiornamenti: "+d.pulito(errCanale.Error()), "Se internet c'è, il programma continua a funzionare; solo le versioni nuove non arrivano da sole.")
	case !st.Automatico:
		aggiungi("Aggiornamenti: canale", esitoInfo, "Il canale risponde. Il controllo automatico è spento (Altro › Aggiornamenti e novità).", "")
	default:
		aggiungi("Aggiornamenti: canale", esitoOk, "Il canale degli aggiornamenti risponde.", "")
	}

	// 8. la finestra: Edge o Chrome
	switch {
	case p.Browser == nil:
		aggiungi("Finestra del programma", esitoInfo, "Non controllato in questa prova.", "")
	default:
		if b := p.Browser(); b != "" {
			aggiungi("Finestra del programma", esitoOk, "Si apre con "+b+", in una finestra tutta sua.", "")
		} else if installabile() {
			aggiungi("Finestra del programma", esitoAvviso, "Non trovo né Edge né Chrome: la pagina si apre nel browser predefinito, in una scheda.", "Funziona lo stesso, ma la scheda va chiusa a mano: «Chiudi il programma» (in fondo al menu) lo ferma in ogni caso.")
		} else {
			aggiungi("Finestra del programma", esitoInfo, "Questa prova vale per Windows.", "")
		}
	}

	// 9. lo scanner (non serve: ci sono «Allega un file» e «Fotografa»)
	switch {
	case p.Scanner == nil || errors.Is(errScanner, errNonDisponibile):
		aggiungi("Scanner", esitoInfo, "Non controllato su questo sistema: si prova su Windows.", "")
	case errScanner != nil:
		aggiungi("Scanner", esitoAvviso, "Windows non riesce a cercare gli scanner: "+d.pulito(errScanner.Error()), "Per i certificati resta «Allega un file» (un PDF o una foto già pronti).")
	case nScanner == 0:
		aggiungi("Scanner", esitoInfo, "Windows non vede nessuno scanner in questo momento.", "Non serve per usare il programma: per il certificato c'è «Allega un file» e, dal telefono, «Fotografa». Se ne hai uno, accendilo e collegalo.")
	default:
		aggiungi("Scanner", esitoOk, "Windows vede "+plurale(nScanner, "scanner", "scanner")+". Per provarlo davvero: scheda dell'allieva › Certificato medico › «Scansiona».", "")
	}

	// 10. i suoni
	su := s.suoni.Stato()
	switch {
	case p.Audio == nil || errors.Is(errAudio, errNonDisponibile):
		aggiungi("Suoni", esitoInfo, "Non controllato su questo sistema: i suoni si sentono su Windows.", "")
	case errAudio != nil:
		aggiungi("Suoni", esitoInfo, "Non riesco a sapere se c'è un'uscita audio: "+d.pulito(errAudio.Error()), "")
	case nAudio == 0:
		aggiungi("Suoni", esitoInfo, "Il computer non ha un'uscita audio: i suoni di apertura e chiusura non si sentiranno.", "Non cambia niente per il resto. Si possono spegnere in Impostazioni › Aspetto › Suoni.")
	default:
		aggiungi("Suoni", esitoOk, "Il computer ha un'uscita audio (suoni: "+fmt.Sprint(su["livello"])+").", "Per sentirli: Impostazioni › Aspetto › «Prova i suoni».")
	}

	// 11. l'avvio con Windows
	if leggiAvvio != nil {
		if leggiAvvio() {
			aggiungi("Avvio con Windows", esitoInfo, "Il programma parte da solo quando si accende il computer (senza finestra: serve per l'accesso dal telefono).", "")
		} else {
			aggiungi("Avvio con Windows", esitoInfo, "Il programma non parte da solo: si apre quando lo apri tu.", "")
		}
	}

	// 12. l'accesso dal telefono
	rete := s.rete.Stato()
	switch {
	case !rete.Attiva:
		aggiungi("Accesso dal telefono", esitoInfo, "Spento.", "")
	case rete.Errore != "":
		aggiungi("Accesso dal telefono", esitoErrore, d.pulito(rete.Errore), "")
	case !rete.InAscolto:
		aggiungi("Accesso dal telefono", esitoAvviso, "È acceso ma il programma non è in ascolto.", "Spegni e riaccendi l'accesso in Impostazioni › Accesso dal telefono.")
	default:
		aggiungi("Accesso dal telefono", esitoOk, "Acceso: in ascolto sulla porta "+fmt.Sprint(rete.Porta)+", "+plurale(rete.Sessioni, "dispositivo collegato", "dispositivi collegati")+".", "Se il telefono non si collega, Windows può aver bloccato il programma: nel firewall scegli «Reti private».")
	}
	return out
}

// riassuntoEsiti conta gli esiti per stato.
func riassuntoEsiti(esiti []Esito) (ok, avvisi, errori int) {
	for _, e := range esiti {
		switch e.Stato {
		case esitoOk:
			ok++
		case esitoAvviso:
			avvisi++
		case esitoErrore:
			errori++
		}
	}
	return
}

// POST /api/controllo (solo dal computer): fa le prove e le riporta. Le cose da guardare finiscono anche nel diario tecnico.
func (s *Server) handleControllo(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"errore": "Il controllo si fa solo dal computer della segreteria."})
		return
	}
	esiti := s.controllaComputer(r.Context())
	ok, avvisi, errori := riassuntoEsiti(esiti)
	logInfo("controllo", "controllo del computer: %d a posto, %d da guardare, %d problemi", ok, avvisi, errori)
	for _, e := range esiti {
		switch e.Stato {
		case esitoAvviso:
			logAvviso("controllo", "%s: %s", strings.ToLower(e.Cosa), e.Testo)
		case esitoErrore:
			logErrore("controllo", "%s: %s", strings.ToLower(e.Cosa), e.Testo)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"esiti": esiti, "ok": ok, "avvisi": avvisi, "errori": errori})
}
