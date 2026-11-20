//go:build windows

package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

// scanImage apre la finestra di scansione di Windows (WIA, la stessa dei programmi di scansione) e restituisce l'immagine in JPEG.
// Si appoggia a PowerShell, che fa parte di Windows, come la finestra di scelta della cartella. Codici di uscita dello script:
// 0 fatto, 2 finestra chiusa senza scansionare, 3 nessuno scanner (o scanner non raggiungibile).
var scanImage = func() ([]byte, error) {
	var r [6]byte
	if _, err := rand.Read(r[:]); err != nil {
		return nil, err
	}
	tmp := filepath.Join(os.TempDir(), "gymart-scansione-"+hex.EncodeToString(r[:])+".jpg")
	defer os.Remove(tmp)
	script := `$ErrorActionPreference = 'Stop'; try { ` +
		`$d = New-Object -ComObject WIA.CommonDialog; ` +
		`$i = $d.ShowAcquireImage(1, 1, 0, '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}', $false, $true, $false); ` +
		`if ($i -eq $null) { exit 2 }; ` +
		`$p = New-Object -ComObject WIA.ImageProcess; ` +
		`$p.Filters.Add($p.FilterInfos.Item('Convert').FilterID); ` +
		`$p.Filters.Item(1).Properties.Item('FormatID').Value = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'; ` +
		`$p.Filters.Item(1).Properties.Item('Quality').Value = 88; ` +
		`$i = $p.Apply($i); ` +
		`$i.SaveFile($env:GYMART_SCANSIONE); exit 0 } catch { exit 3 }` // il percorso passa da una variabile d'ambiente: dentro il testo dello script un apice (anche quello tipografico) lo romperebbe
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, sistema(`System32\WindowsPowerShell\v1.0\powershell.exe`), "-NoProfile", "-STA", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "GYMART_SCANSIONE="+tmp)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW: no console flashes up
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			switch ee.ExitCode() {
			case 2:
				return nil, ErrScansioneAnnullata
			case 3:
				return nil, ErrNessunoScanner
			}
		}
		return nil, err
	}
	return os.ReadFile(tmp)
}
