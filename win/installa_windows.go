//go:build windows

package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// chiaveApp: la voce del programma in Impostazioni di Windows › App (dell'utente: niente amministratore). Una variabile per le prove.
var chiaveApp = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\GymArtSegreteria`

// nuovoInstallatore: dove si installa e come, su questo computer. datiChiesti è l'opzione -dati: con una cartella scelta a mano,
// come con la cartella «dati» accanto al programma, il programma è «portatile» e non si propone niente.
func nuovoInstallatore(datiChiesti, versione string) *Installatore {
	in := &Installatore{versione: versione, adesso: time.Now, riavvia: riavviaProgramma, collegamenti: creaCollegamenti, registra: registraApp,
		avvio: func(exe string) error {
			if leggiAvvio != nil && leggiAvvio() {
				return impostaAvvioPer(exe)
			}
			return nil
		}}
	if exe, err := os.Executable(); err == nil {
		in.exe = exe
		if fi, err := os.Stat(filepath.Join(filepath.Dir(exe), "dati")); err == nil && fi.IsDir() {
			in.portatile = true
		}
	}
	in.portatile = in.portatile || datiChiesti != ""
	if la := os.Getenv("LocalAppData"); la != "" {
		in.cartella = filepath.Join(la, "Programs", cartellaProgramma)
		in.locale = filepath.Join(la, "GymArtSegreteria")
	}
	return in
}

// powershell fa uno script con i percorsi nelle variabili d'ambiente (le lettere accentate e gli apostrofi non si perdono e non si
// mescolano allo script); la risposta torna in Base64.
func powershell(script string, env map[string]string) (string, error) {
	cmd := comandoNascosto(`System32\WindowsPowerShell\v1.0\powershell.exe`, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	out, err := cmd.Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return "", fmt.Errorf("%w: %s", err, dettaglioPS(string(ee.Stderr)))
		}
		return "", err
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(out)))
	if err != nil {
		return "", fmt.Errorf("risposta di PowerShell non leggibile: %w", err)
	}
	return string(b), nil
}

// le cartelle dei collegamenti: il Desktop e il menu Start dell'utente (anche se il Desktop è spostato su OneDrive); nelle prove
// GYMART_CARTELLE ne dà altre (una per riga)
const psCartelle = `$cartelle = if ($env:GYMART_CARTELLE) { $env:GYMART_CARTELLE -split "` + "`" + `n" } else { @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) }; `

// creaCollegamenti mette «Gym Art Segreteria» sul Desktop e nel menu Start, con l'icona del programma.
func creaCollegamenti(exe string) error {
	script := `$ErrorActionPreference = 'Stop'; ` + psCartelle +
		`$s = New-Object -ComObject WScript.Shell; $fatti = @(); ` +
		`foreach ($c in $cartelle) { if (-not $c) { continue }; $p = Join-Path $c 'Gym Art Segreteria.lnk'; $l = $s.CreateShortcut($p); ` +
		`$l.TargetPath = $env:GYMART_EXE; $l.WorkingDirectory = Split-Path $env:GYMART_EXE; $l.IconLocation = $env:GYMART_EXE + ',0'; ` +
		`$l.Description = 'Gym Art Segreteria: allieve, iscrizioni, pagamenti e certificati'; $l.Save(); $fatti += $p }; ` +
		`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($fatti -join "` + "`" + `n")))`
	out, err := powershell(script, map[string]string{"GYMART_EXE": exe})
	if err != nil {
		return err
	}
	logInfo("installazione", "collegamenti creati: %d", len(strings.Split(strings.TrimSpace(out), "\n")))
	return nil
}

// rimuoviCollegamenti toglie i collegamenti «Gym Art Segreteria» che portano a exe (uno con lo stesso nome che porta altrove resta).
func rimuoviCollegamenti(exe string) error {
	script := psCartelle + `$s = New-Object -ComObject WScript.Shell; $tolti = @(); ` +
		`foreach ($c in $cartelle) { if (-not $c) { continue }; $p = Join-Path $c 'Gym Art Segreteria.lnk'; ` +
		`if ((Test-Path -LiteralPath $p) -and ($s.CreateShortcut($p).TargetPath -ieq $env:GYMART_EXE)) { Remove-Item -LiteralPath $p -Force; $tolti += $p } }; ` +
		`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($tolti -join "` + "`" + `n")))`
	_, err := powershell(script, map[string]string{"GYMART_EXE": exe})
	return err
}

// registraApp scrive la voce in Impostazioni di Windows › App: nome, versione, icona, chi lo fa, e come si disinstalla.
func registraApp(exe, cartella, versione string) error {
	kb := int64(0)
	if fi, err := os.Stat(exe); err == nil {
		kb = fi.Size() / 1024
	}
	valori := [][3]string{
		{"DisplayName", "REG_SZ", "Gym Art Segreteria"},
		{"DisplayVersion", "REG_SZ", versione},
		{"Publisher", "REG_SZ", "A.S.D. Gym Art Avezzano"},
		{"DisplayIcon", "REG_SZ", exe + ",0"},
		{"InstallLocation", "REG_SZ", cartella},
		{"UninstallString", "REG_SZ", `"` + exe + `" -disinstalla`},
		{"InstallDate", "REG_SZ", time.Now().Format("20060102")},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
		{"EstimatedSize", "REG_DWORD", strconv.FormatInt(kb, 10)},
	}
	for _, v := range valori {
		if out, err := regCmd("add", chiaveApp, "/v", v[0], "/t", v[1], "/d", v[2], "/f").CombinedOutput(); err != nil {
			return fmt.Errorf("%s: %v %s", v[0], err, strings.TrimSpace(string(out)))
		}
	}
	return nil
}

// impostaAvvioPer: l'avvio con Windows (già acceso) da qui in poi con il programma installato.
func impostaAvvioPer(exe string) error {
	return regCmd("add", runKey, "/v", "GymArtSegreteria", "/t", "REG_SZ", "/d", `"`+exe+`" -senza-finestra`, "/f").Run()
}

// rimuoviInstallazione toglie collegamenti, voce in App e avvio con Windows di quello installato, e cancella i suoi file appena
// il programma si è chiuso. I dati non si toccano.
func rimuoviInstallazione(exe, cartella string) error {
	var errs []string
	if err := rimuoviCollegamenti(exe); err != nil {
		errs = append(errs, "collegamenti: "+err.Error())
	}
	if regCmd("query", chiaveApp).Run() == nil {
		if out, err := regCmd("delete", chiaveApp, "/f").CombinedOutput(); err != nil {
			errs = append(errs, "voce in App: "+strings.TrimSpace(string(out)))
		}
	}
	if out, err := regCmd("query", runKey, "/v", "GymArtSegreteria").Output(); err == nil && strings.Contains(strings.ToLower(string(out)), strings.ToLower(exe)) {
		if err := regCmd("delete", runKey, "/v", "GymArtSegreteria", "/f").Run(); err != nil {
			errs = append(errs, "avvio con Windows: "+err.Error())
		}
	}
	_ = os.Remove(filepath.Join(cartella, fileInstallazione))
	_ = os.Remove(exe + suffissoPrecedente)
	// il programma che gira non può cancellare se stesso: lo fa un PowerShell staccato, dopo qualche secondo
	ps := comandoNascosto(`System32\WindowsPowerShell\v1.0\powershell.exe`, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
		`Start-Sleep -Seconds 3; Remove-Item -LiteralPath $env:GYMART_EXE -Force -ErrorAction SilentlyContinue; `+
			`Remove-Item -LiteralPath ($env:GYMART_EXE + '.nuovo') -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $env:GYMART_DIR -ErrorAction SilentlyContinue`)
	ps.Env = append(os.Environ(), "GYMART_EXE="+exe, "GYMART_DIR="+cartella)
	ps.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 | 0x00000008 | 0x00000200} // CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
	if err := ps.Start(); err != nil {
		errs = append(errs, "cancellazione dei file: "+err.Error())
	} else {
		ps.Process.Release()
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

// disinstalla: da Impostazioni di Windows › App (GymArtSegreteria.exe -disinstalla). Chiede prima; chiude il programma se è aperto.
func disinstalla(porta int) {
	in := nuovoInstallatore("", version)
	exe := in.eseguibileInstallato()
	if exe == "" {
		showError("Non trovo la cartella del programma installato.")
		return
	}
	if !chiedi("Disinstallare Gym Art Segreteria da questo computer?\n\nI dati (allieve, iscrizioni, pagamenti, certificati e le copie di sicurezza) NON si cancellano: restano nella cartella Documenti\\Gym Art Segreteria. Reinstallando il programma si ritrovano.") {
		return
	}
	if nostro, _ := copiaAperta(porta); nostro {
		if err := chiudiCopiaAperta(porta); err != nil {
			showError("Il programma è aperto e non riesco a chiuderlo: " + err.Error() + ".\n\nChiudilo con «Chiudi il programma» e riprova.")
			return
		}
	}
	if err := rimuoviInstallazione(exe, in.cartella); err != nil {
		showError("Disinstallato, ma non tutto è andato a posto: " + err.Error())
		return
	}
	mostraInfo("Gym Art Segreteria è stata disinstallata.\n\nI dati sono ancora in Documenti\\Gym Art Segreteria.")
}

// mostraInfo: un messaggio semplice (niente icona d'errore).
func mostraInfo(msg string) {
	title, err1 := syscall.UTF16PtrFromString("Gym Art Segreteria")
	text, err2 := syscall.UTF16PtrFromString(msg)
	if err1 != nil || err2 != nil {
		return
	}
	const mbIconInformation = 0x40
	syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconInformation)
}
