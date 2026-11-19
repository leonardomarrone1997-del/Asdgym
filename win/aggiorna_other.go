//go:build !windows

package main

import (
	"os/exec"
	"syscall"
)

// Fuori da Windows il programma gira solo per lo sviluppo e per le prove: non si aggiorna da solo (in prova sì, con un riavvio finto).
func installabile() bool { return false }

func staccato(cmd *exec.Cmd) { cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }

func controllaEseguibile(string) error { return nil }
