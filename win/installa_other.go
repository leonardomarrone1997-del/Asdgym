//go:build !windows

package main

import (
	"fmt"
	"os"
	"time"
)

// Fuori da Windows (sviluppo e prove) non c'è niente da installare: lo stato è «non disponibile».
func nuovoInstallatore(datiChiesti, versione string) *Installatore {
	in := &Installatore{versione: versione, adesso: time.Now, portatile: datiChiesti != ""}
	if exe, err := os.Executable(); err == nil {
		in.exe = exe
	}
	return in
}

func disinstalla(int) { fmt.Fprintln(os.Stderr, "La disinstallazione c'è solo su Windows.") }
