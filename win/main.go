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
	"strconv"
	"time"
)

//go:embed web
var webFiles embed.FS

var version = "1.1.0"

const (
	defaultPort = 47815
	dataFolder  = "Gym Art Segreteria"
)

func main() {
	dati := flag.String("dati", "", "cartella dei dati (se vuota: la cartella \"dati\" accanto al programma, se esiste, altrimenti Documenti)")
	porta := flag.Int("porta", defaultPort, "porta locale (0 = una libera qualsiasi)")
	senza := flag.Bool("senza-finestra", false, "non apre la finestra: la pagina va aperta a mano all'indirizzo stampato (per le prove)")
	flag.Parse()
	if err := run(*dati, *porta, *senza); err != nil {
		showError("Gym Art Segreteria non può partire.\n\n" + err.Error())
		os.Exit(1)
	}
}

func run(dati string, porta int, senza bool) error {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
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
	mirror := OpenMirror(dir, store.ArchiveBytes)
	srv.mirror = mirror
	srv.autoExit = true
	srv.openWindow = func() { openWindow(url) }
	srv.openFolder = func() error { return openFolder(dir) }
	srv.pickFolder = pickFolder
	mirror.Kick() // the second folder may have been away when the program was last closed

	httpSrv := &http.Server{Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	serveErr := make(chan error, 1)
	go func() { serveErr <- httpSrv.Serve(ln) }()
	go srv.Watch()

	fmt.Println("Gym Art Segreteria:", url)
	fmt.Println("Dati:", dir)
	if !senza {
		if err := openWindow(url); err != nil {
			return fmt.Errorf("non riesco ad aprire la finestra. Apri a mano questo indirizzo nel browser: %s (%w)", url, err)
		}
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	select {
	case <-srv.Done():
	case <-stop:
	case err := <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	err = httpSrv.Shutdown(ctx)
	// let the last copy to the second folder finish, but do not hang on a folder that does not answer
	flushed := make(chan struct{})
	go func() { mirror.Flush(); close(flushed) }()
	select {
	case <-flushed:
	case <-time.After(5 * time.Second):
	}
	return err
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
