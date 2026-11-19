//go:build windows

package main

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"syscall"
)

// Su Windows il programma si può aggiornare da solo.
func installabile() bool { return true }

// staccato: il programma nuovo non deve chiudersi con quello vecchio.
func staccato(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200} // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
}

// controllaEseguibile: il file scaricato deve essere almeno un programma di Windows ("MZ" all'inizio).
func controllaEseguibile(p string) error {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close()
	var b [2]byte
	if _, err := io.ReadFull(f, b[:]); err != nil || b[0] != 'M' || b[1] != 'Z' {
		return errors.New("il file scaricato non è un programma per Windows")
	}
	return nil
}
