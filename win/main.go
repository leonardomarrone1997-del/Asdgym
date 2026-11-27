// Gym Art Segreteria per Windows: anagrafica e iscrizioni in un archivio sul computer.
// The program serves its page to this computer only and shows it in its own window.
package main

import (
	"context"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed web
var webFiles embed.FS

var version = "1.29.0"

const (
	defaultPort = 47815
	dataFolder  = "Gym Art Segreteria"
)

func main() {
	dati := flag.String("dati", "", "cartella dei dati (se vuota: la cartella \"dati\" accanto al programma, se esiste, altrimenti Documenti)")
	porta := flag.Int("porta", defaultPort, "porta locale (0 = una libera qualsiasi)")
	senza := flag.Bool("senza-finestra", false, "non apre la finestra: la pagina va aperta a mano all'indirizzo stampato (per le prove)")
	dopoAgg := flag.Bool("dopo-aggiornamento", false, "avviato dal programma di prima dopo un aggiornamento: aspetta che quello si chiuda (uso interno)")
	dopoInst := flag.Bool("dopo-installazione", false, "avviato dalla copia che l'ha appena installato o aperto: aspetta che quella si chiuda (uso interno)")
	togli := flag.Bool("disinstalla", false, "toglie il programma installato (da Impostazioni di Windows › App); i dati restano")
	flag.Parse()
	if *togli {
		disinstalla(*porta)
		return
	}
	defer func() { // un errore imprevisto non deve far sparire il programma senza dire niente
		if p := recover(); p != nil {
			logErrore("avvio", "errore imprevisto: %v | %s", p, pila(10))
			diarioAttivo.Load().Chiudi()
			showError("Gym Art Segreteria si è fermata per un errore imprevisto.\n\nÈ stato scritto nel diario tecnico, nella cartella dei dati (Impostazioni, Assistenza).")
			os.Exit(2)
		}
	}()
	dopo := ""
	if *dopoAgg {
		dopo = "aggiornamento"
	} else if *dopoInst {
		dopo = "installazione"
	}
	if err := run(*dati, *porta, *senza, dopo); err != nil {
		logErrore("avvio", "il programma non parte: %v", err)
		diarioAttivo.Load().Chiudi()
		showError("Gym Art Segreteria non può partire.\n\n" + err.Error())
		os.Exit(1)
	}
}

// run starts the program. dopo says who started it: "aggiornamento" (the program before an update) or "installazione" (the copy that
// installed it, or opened it in its place); both are closing and free the port in a moment.
func run(dati string, porta int, senza bool, dopo string) error {
	dopoAgg := dopo != ""
	// 1.29.0: a copy as new as the installed one, or older, opens the installed one (the person keeps finding one program, in one place)
	inst := nuovoInstallatore(dati, version)
	st := inst.Stato() // quick: the other copies on the computer are looked for only when the page asks
	if (st.Stato == instGiaInstallato || st.Stato == instPiuVecchia) && !dopoAgg {
		if err := inst.riavvia(inst.eseguibileInstallato(), os.Args[1:]); err == nil {
			return nil
		}
	}
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
	// after an update the program that started this one is still closing: its port is free in a moment (it must not be mistaken for "already running")
	for t := time.Now(); err != nil && dopoAgg && time.Since(t) < 25*time.Second; {
		time.Sleep(300 * time.Millisecond)
		ln, err = net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
	}
	chiusa := "" // the older copy closed to start in its place (for the diary)
	if err != nil {
		// The port is busy. If it is this program at the same version or a newer one: show its window and stop here.
		// If it is an older version (1.26.2: before, the person kept seeing the old version after replacing the exe), ask to close it and start in its place.
		nostro, altra := copiaAperta(porta)
		switch {
		case nostro && piuVecchia(altra, version):
			if !chiedi(testoCopiaVecchia(altra, version)) {
				apriCopiaAperta(porta)
				return nil
			}
			if e := chiudiCopiaAperta(porta); e != nil {
				showError("Non riesco a chiudere la versione aperta: " + e.Error() + ".\n\nChiudila tu con «Chiudi il programma», in fondo al menu, e poi riapri questo programma.")
				return nil
			}
			for t := time.Now(); err != nil && time.Since(t) < 10*time.Second; {
				time.Sleep(300 * time.Millisecond)
				ln, err = net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
			}
			if err != nil {
				return fmt.Errorf("la versione di prima è chiusa ma il suo posto non si è ancora liberato: riapri il programma tra qualche secondo")
			}
			chiusa = altra
			if chiusa == "" {
				chiusa = "precedente alla 1.26.2"
			}
		case nostro:
			apriCopiaAperta(porta)
			return nil
		default:
			if ln, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
				return fmt.Errorf("non riesco ad aprire una porta locale: %w", err)
			}
		}
	}
	defer ln.Close()
	host := "127.0.0.1:" + strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)
	url := "http://" + host + "/"

	dir, err := dataDir(dati)
	if err != nil {
		return err
	}
	dia := ApriDiario(dir)
	ImpostaDiario(dia)
	defer dia.Chiudi()
	modo := ""
	if senza {
		modo += ", senza finestra"
	}
	switch dopo {
	case "aggiornamento":
		modo += ", dopo un aggiornamento"
	case "installazione":
		modo += ", dalla cartella del programma installato"
	}
	logInfo("avvio", "Gym Art Segreteria %s, %s, %s, porta %d%s", version, versioneSistema(), runtime.GOARCH, ln.Addr().(*net.TCPAddr).Port, modo)
	if chiusa != "" {
		logInfo("avvio", "chiusa la versione %s che era ancora aperta, su richiesta della persona", chiusa)
	}
	store, err := OpenStore(dir)
	if err != nil {
		return err
	}
	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		return err
	}
	token, err := newToken()
	if err != nil {
		return err
	}
	srv, err := NewServer(store, static, host, token, version)
	if err != nil {
		return err
	}
	mirror := OpenMirror(dir, store)
	srv.mirror = mirror
	srv.autoExit = true
	srv.suoni = ApriSuoni(dir, suonaSistema, suoniDisponibili)
	srv.inst = inst
	if st.Stato == instInstallato {
		go func() { defer recuperaPanic("installazione"); inst.Allinea() }() // a version file left behind by an update from the channel is written again
	}
	srv.openWindow = func() { openWindow(srv.LaunchURL()) }
	srv.chiudiFinestre = chiudiFinestre
	srv.openFolder = openFolder
	srv.pickFolder = pickFolder
	srv.scanImage = scanImage
	srv.sonde = sondeSistema()
	srv.sonde.Canale = srv.agg.Raggiungibile
	portaInUso := ln.Addr().(*net.TCPAddr).Port
	srv.agg.argomenti = func() []string { return nuoviArgomenti(os.Args[1:], portaInUso, segnoDopoAggiornamento) } // the new program restarts on the same port: same address, same choices of the browser
	inst.argomenti = func() []string { return nuoviArgomenti(os.Args[1:], portaInUso, segnoDopoInstallazione) }
	if !srv.agg.prova { // (in the tests nothing restarts and nothing closes)
		srv.agg.chiudi = func() { // the new program is running: this one goes, after the page has said goodbye, with its window
			go func() {
				defer recuperaPanic("aggiornamenti")
				time.Sleep(1500 * time.Millisecond)
				srv.chiudiLeFinestre()
				srv.ferma("aggiornamento installato: il programma nuovo ha preso il posto")
			}()
		}
	}
	mirror.Kick() // the second folder may have been away when the program was last closed

	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	go srv.Watch()
	go srv.Maintain(5 * time.Minute)
	go srv.agg.Ciclo(srv.Done(), os.Getenv("GYMART_AGGIORNAMENTI_SUBITO") == "1")

	srv.rete.Avvia(srv.Handler()) // network access, if it was switched on the last time
	launch := srv.LaunchURL()
	fmt.Println("Gym Art Segreteria:", url)
	fmt.Println("Dati:", dir)
	fmt.Println("Apri:", launch)
	if st := srv.rete.Stato(); st.InAscolto {
		fmt.Println("Rete:", strings.Join(st.Indirizzi, " "))
	}
	if !senza {
		if err := openWindow(launch); err != nil {
			return fmt.Errorf("non riesco ad aprire la finestra: %w", err)
		}
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	select {
	case <-srv.Done():
	case <-stop:
		srv.ferma("interrotto dalla tastiera (Ctrl+C)")
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			logErrore("avvio", "il server si è fermato: %v", err)
			return err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil { // una richiesta ancora in corso dopo tre secondi: il programma si ferma lo stesso, non è un guasto (e non deve mostrare «non può partire»)
		logAvviso("chiusura", "alcune richieste non erano finite dopo tre secondi: %v", err)
	}
	srv.rete.Ferma()
	// let the last copy to the second folder finish, but do not hang on a folder that does not answer
	flushed := make(chan struct{})
	go func() { mirror.Flush(); close(flushed) }()
	select {
	case <-flushed:
	case <-time.After(5 * time.Second):
	}
	return nil
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// dataDir picks the folder of the archive: the one asked for, a "dati" folder next to the program
// (so the whole folder can be carried around), or Documents.
func dataDir(asked string) (string, error) {
	if asked != "" {
		return filepath.Abs(asked)
	}
	if exe, err := os.Executable(); err == nil {
		portable := filepath.Join(filepath.Dir(exe), "dati")
		if fi, err := os.Stat(portable); err == nil && fi.IsDir() {
			return portable, nil
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("non trovo la cartella dell'utente: %w", err)
	}
	return filepath.Join(home, "Documents", dataFolder), nil
}
