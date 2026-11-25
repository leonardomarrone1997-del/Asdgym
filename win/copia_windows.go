package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
	"unsafe"
)

// chiedi: a question with «Sì» and «No» in a window of Windows (the program has no console). true = «Sì».
func chiedi(msg string) bool {
	title, err1 := syscall.UTF16PtrFromString("Gym Art Segreteria")
	text, err2 := syscall.UTF16PtrFromString(msg)
	if err1 != nil || err2 != nil {
		return false
	}
	const mbYesNo, mbIconQuestion, mbTopmost, idYes = 0x4, 0x20, 0x40000, 6
	r, _, _ := syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbYesNo|mbIconQuestion|mbTopmost)
	return r == idYes
}

// comandoNascosto: a program of Windows, from its full path, without a black window.
func comandoNascosto(rel string, args ...string) *exec.Cmd {
	cmd := exec.Command(sistema(rel), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}

// chiudiCopiaAperta stops the older copy of the program that holds porta: it finds who listens there (netstat), checks that it is
// Gym Art Segreteria (tasklist) and stops it (taskkill). The data are not at risk: every change is already on disk, written to a
// temporary file and then renamed, and at the next start the program checks the archive and its copies.
func chiudiCopiaAperta(porta int) error {
	out, err := comandoNascosto(`System32\NETSTAT.EXE`, "-ano", "-p", "TCP").Output()
	if err != nil {
		return fmt.Errorf("non riesco a leggere i programmi aperti: %w", err)
	}
	pid := pidInAscolto(string(out), porta)
	if pid == 0 || pid == os.Getpid() {
		return fmt.Errorf("non trovo la versione aperta")
	}
	out, err = comandoNascosto(`System32\tasklist.exe`, "/FI", "PID eq "+strconv.Itoa(pid), "/FO", "CSV", "/NH").Output()
	if err != nil {
		return fmt.Errorf("non riesco a leggere il nome del programma aperto: %w", err)
	}
	if nome := nomeProcesso(string(out)); !eNostroProgramma(nome) {
		return fmt.Errorf("al suo posto c'è un altro programma (%s)", nome)
	}
	if err := comandoNascosto(`System32\taskkill.exe`, "/PID", strconv.Itoa(pid), "/F").Run(); err != nil {
		return fmt.Errorf("non si è chiusa (taskkill): %w", err)
	}
	time.Sleep(500 * time.Millisecond) // Windows frees the port a moment after the end of the program
	return nil
}
