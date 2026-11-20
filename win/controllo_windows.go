//go:build windows

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// browserTrovato dice quale browser aprirà la finestra del programma: Edge (c'è in ogni Windows) o Chrome; vuoto se non c'è nessuno dei due.
func browserTrovato() string {
	for _, p := range browserPaths() {
		if _, err := os.Stat(p); err == nil {
			if strings.Contains(strings.ToLower(p), "msedge") {
				return "Microsoft Edge"
			}
			return "Google Chrome"
		}
	}
	return ""
}

// contaAudio: quante uscite audio ha il computer (winmm, la stessa libreria che suona i suoni).
func contaAudio() (int, error) {
	r, _, _ := syscall.NewLazyDLL(dllSistema("winmm.dll")).NewProc("waveOutGetNumDevs").Call()
	return int(r), nil
}

// contaScanner chiede a Windows (WIA, come la finestra di scansione) quanti scanner vede, senza scansionare. Passa da PowerShell, come la scansione.
func contaScanner(ctx context.Context) (int, error) {
	const script = `$ErrorActionPreference = 'Stop'; try { ` +
		`$m = New-Object -ComObject WIA.DeviceManager; $n = 0; ` +
		`foreach ($d in $m.DeviceInfos) { if ($d.Type -eq 1) { $n++ } }; ` +
		`Write-Output $n; exit 0 } catch { ` +
		`[Console]::Error.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(('{0} [0x{1:X8}]' -f $_.Exception.Message, $_.Exception.HResult)))); exit 3 }`
	cmd := exec.CommandContext(ctx, sistema(`System32\WindowsPowerShell\v1.0\powershell.exe`), "-NoProfile", "-STA", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW: nessuna finestra nera
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return 0, errors.New("la ricerca non ha risposto in tempo")
		}
		return 0, errors.New(dettaglioPS(errb.String()))
	}
	n, err := strconv.Atoi(strings.TrimSpace(out.String()))
	if err != nil {
		return 0, fmt.Errorf("risposta inattesa («%.40s»)", strings.TrimSpace(out.String()))
	}
	return n, nil
}
