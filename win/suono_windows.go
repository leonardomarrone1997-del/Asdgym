//go:build windows

package main

import (
	"errors"
	"os"
	"syscall"
	"unsafe"
)

const suoniDisponibili = true

// dllSistema dà il percorso completo di una DLL di Windows: così non si carica una DLL con lo stesso nome messa accanto al programma
// (che gira da cartelle come Download o Desktop).
func dllSistema(nome string) string {
	radice := os.Getenv("SystemRoot")
	if radice == "" {
		radice = `C:\Windows`
	}
	return radice + `\System32\` + nome
}

var procPlaySound = syscall.NewLazyDLL(dllSistema("winmm.dll")).NewProc("PlaySoundW")

const (
	sndAsync     = 0x0001 // torna subito, il suono continua
	sndNoDefault = 0x0002 // se non riesce non fa il «bip» di sistema
	sndMemory    = 0x0004 // il suono è un file WAV già in memoria
)

// suonaSistema suona un file WAV che è in memoria, senza aspettarne la fine. Chi la chiama tiene il file in vita finché suona
// (è nella memoria di Suoni per tutto il tempo in cui il programma gira). Un altro suono interrompe quello in corso.
func suonaSistema(wav []byte) error {
	if len(wav) == 0 {
		return errors.New("suono vuoto")
	}
	r, _, err := procPlaySound.Call(uintptr(unsafe.Pointer(&wav[0])), 0, uintptr(sndMemory|sndAsync|sndNoDefault))
	if r == 0 {
		if err == nil || err == syscall.Errno(0) {
			err = errors.New("PlaySound non è riuscito")
		}
		return err
	}
	return nil
}
