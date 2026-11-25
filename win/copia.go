package main

// When the program is started while a copy of it is already open (1.26.2).
//
// Before, the new start only showed the window of the copy already open and stopped: after replacing the exe by hand,
// with the old version still open (or left running), the person kept seeing the old version and could not tell why.
// Now the copy says its version (header versioneHeader, on every answer); a copy that is older than this one, or that
// says nothing (the versions before 1.26.2), is closed if the person agrees, and this one starts in its place.

import (
	"bufio"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const versioneHeader = "X-Gymart-Versione"

// copiaAperta asks the program on porta who it is, without opening its window: nostro = it is Gym Art Segreteria,
// versione = what it says («» for the versions before 1.26.2, which did not say it).
func copiaAperta(porta int) (nostro bool, versione string) {
	c := &http.Client{Timeout: 3 * time.Second}
	resp, err := c.Get("http://127.0.0.1:" + strconv.Itoa(porta) + "/__versione")
	if err != nil {
		return false, ""
	}
	resp.Body.Close()
	return resp.Header.Get(appHeader) == "1", resp.Header.Get(versioneHeader)
}

// apriCopiaAperta shows the window of the copy already open.
func apriCopiaAperta(porta int) {
	c := &http.Client{Timeout: 3 * time.Second}
	if resp, err := c.Get("http://127.0.0.1:" + strconv.Itoa(porta) + "/__apri"); err == nil {
		resp.Body.Close()
	}
}

// piuVecchia: the copy open is older than this program (one that does not say its version is from before 1.26.2).
func piuVecchia(altra, mia string) bool {
	return altra == "" || confrontaVersioni(altra, mia) < 0
}

// testoCopiaVecchia: the question asked before closing the older copy.
func testoCopiaVecchia(altra, mia string) string {
	quale := "una versione precedente"
	if altra != "" {
		quale = "la versione " + altra
	}
	return "È ancora aperta " + quale + " di Gym Art Segreteria.\n\n" +
		"Vuoi chiuderla e aprire la versione " + mia + "?\n\n" +
		"I dati già salvati non si toccano. Se in quella finestra stavi scrivendo qualcosa senza salvarlo, rispondi No, salva e chiudi il programma, poi riapri questo."
}

// pidInAscolto reads the output of «netstat -ano -p TCP» and gives the process that listens on 127.0.0.1:porta (0 if none).
func pidInAscolto(netstat string, porta int) int {
	cerca := "127.0.0.1:" + strconv.Itoa(porta)
	sc := bufio.NewScanner(strings.NewReader(netstat))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		// TCP  127.0.0.1:47815  0.0.0.0:0  LISTENING  1234  (the state is translated on Windows in other languages: it is not read)
		if len(f) < 5 || !strings.EqualFold(f[0], "TCP") || f[1] != cerca {
			continue
		}
		if f[2] != "0.0.0.0:0" && f[2] != "*:*" {
			continue // a connection to the port, not the one listening
		}
		if pid, err := strconv.Atoi(f[len(f)-1]); err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}

// nomeProcesso reads the output of «tasklist /FI "PID eq N" /FO CSV /NH» and gives the name of the program («» if none).
func nomeProcesso(tasklist string) string {
	riga := strings.TrimSpace(tasklist)
	if !strings.HasPrefix(riga, `"`) {
		return "" // «INFO: no tasks are running…», in the language of Windows
	}
	if i := strings.Index(riga[1:], `"`); i >= 0 {
		return riga[1 : 1+i]
	}
	return ""
}

// eNostroProgramma: the name of a program that may be closed in place of this one (the exe can have been renamed, as in «GymArtSegreteria (1).exe»).
func eNostroProgramma(nome string) bool {
	return strings.HasPrefix(strings.ToLower(nome), "gymartsegreteria")
}
