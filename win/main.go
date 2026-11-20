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

var version = "1.23.0"

const (
	defaultPort = 47815
	dataFolder  = "Gym Art Segreteria"
)

func main() {
	dati := flag.String("dati", "", "cartella dei dati (se vuota: la cartella \"dati\" accanto al programma, se esiste, altrimenti Documenti)")
	porta := flag.Int("porta", defaultPort, "porta locale (0 = una libera qualsiasi)")
	senza := flag.Bool("senza-finestra", false, "non apre la finestra: la pagina va aperta a mano all'indirizzo stampato (per le prove)")
	dopoAgg := flag.Bool("dopo-aggiornamento", false, "avviato dal programma di prima dopo un aggiornamento: aspetta che quello si chiuda (uso interno)")
	flag.Parse()
	defer func() { // un errore imprevisto non deve far sparire il programma senza dire niente
		if p := recover(); p != nil {
			logErrore("avvio", "errore imprevisto: %v | %s", p, pila(10))
			diarioAttivo.Load().Chiudi()
			showError("Gym Art Segreteria si è fermata per un errore imprevisto.\n\nÈ stato scritto nel diario tecnico, nella cartella dei dati (Impostazioni, Assistenza).")
			os.Exit(2)
		}
	}()
	if err := run(*dati, *porta, *senza, *dopoAgg); err != nil {
		logErrore("avvio", "il programma non parte: %v", err)
		diarioAttivo.Load().Chiudi()
		showError("Gym Art Segreteria non può partire.\n\n" + err.Error())
		os.Exit(1)
	}
}

func run(dati string, porta int, senza, dopoAgg bool) error {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
	// after an update the program that started this one is still closing: its port is free in a moment (it must not be mistaken for "already running")
	for t := time.Now(); err != nil && dopoAgg && time.Since(t) < 25*time.Second; {
		time.Sleep(300 * time.Millisecond)
		ln, err = net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
	}
	if err != nil {
		// The port is busy: if it is this program, show its window and stop here.
		if alreadyRunning(porta) {
			return nil
		}
		if ln, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
			return fmt.Errorf("non riesco ad aprire una porta locale: %w", err)
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
	if dopoAgg {
		modo += ", dopo un aggiornamento"
	}
	logInfo("avvio", "Gym Art Segreteria %s, %s, %s, porta %d%s", version, versioneSistema(), runtime.GOARCH, ln.Addr().(*net.TCPAddr).Port, modo)
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
	srv.openWindow = func() { openWindow(srv.LaunchURL()) }
	srv.openFolder = openFolder
	srv.pickFolder = pickFolder
	srv.scanImage = scanImage
	srv.sonde = sondeSistema()
	srv.sonde.Canale = srv.agg.Raggiungibile
	portaInUso := ln.Addr().(*net.TCPAddr).Port
	srv.agg.argomenti = func() []string { return nuoviArgomenti(os.Args[1:], portaInUso) } // the new program restarts on the same port: same address, same choices of the browser
	if !srv.agg.prova {                                                                    // (in the tests nothing restarts and nothing closes)
		srv.agg.chiudi = func() { // the new program is running: this one goes, after the answer to the page has left
			go func() {
				time.Sleep(900 * time.Millisecond)
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

// alreadyRunning asks the program on the default port to show a window. False if the port belongs to something else.
func alreadyRunning(porta int) bool {
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + strconv.Itoa(porta) + "/__apri")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.Header.Get(appHeader) == "1"
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
