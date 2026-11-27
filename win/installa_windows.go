//go:build windows

package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

// chiaveApp: la voce del programma in Impostazioni di Windows › App (dell'utente: niente amministratore). Una variabile per le prove.
var chiaveApp = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\GymArtSegreteria`

// nuovoInstallatore: dove si installa e come, su questo computer. datiChiesti è l'opzione -dati: con una cartella scelta a mano,
// come con la cartella «dati» accanto al programma, il programma è «portatile» e non si propone niente.
func nuovoInstallatore(datiChiesti, versione string) *Installatore {
	in := &Installatore{versione: versione, adesso: time.Now, riavvia: riavviaProgramma, collegamenti: creaCollegamenti, registra: registraApp, dove: cartelleUtente, cestina: nelCestino,
		versioneDi: versioneFile, scollega: rimuoviCollegamenti,
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
// mescolano allo script); la risposta torna in Base64. Al massimo un minuto: un PowerShell bloccato non blocca il programma.
func powershell(script string, env map[string]string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, sistema(`System32\WindowsPowerShell\v1.0\powershell.exe`), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	out, err := cmd.Output()
	if err != nil {
		if ctx.Err() != nil {
			return "", errors.New("PowerShell non ha finito in un minuto")
		}
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
	n := 0
	for _, r := range strings.Split(out, "\n") {
		if strings.TrimSpace(r) != "" {
			n++
		}
	}
	if n == 0 {
		return errors.New("nessuna cartella per le icone (Desktop e menu Start non trovati)")
	}
	logInfo("installazione", "collegamenti creati: %d", n)
	return nil
}

// rimuoviCollegamenti toglie i collegamenti «Gym Art Segreteria» che portano a exe (uno con lo stesso nome che porta altrove resta).
// Il confronto lo fa il programma sul file, non sul testo: «C:\Users\RUNNER~1\…» e «C:\Users\runneradmin\…» sono lo stesso file
// (provato su Windows vero: Windows scrive nel collegamento il percorso lungo).
func rimuoviCollegamenti(exe string) error {
	script := psCartelle + `$s = New-Object -ComObject WScript.Shell; $righe = @(); ` +
		`foreach ($c in $cartelle) { if (-not $c) { continue }; $p = Join-Path $c 'Gym Art Segreteria.lnk'; ` +
		`if (Test-Path -LiteralPath $p) { $righe += ($p + "` + "`" + `t" + $s.CreateShortcut($p).TargetPath) } }; ` +
		`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($righe -join "` + "`" + `n")))`
	out, err := powershell(script, nil)
	if err != nil {
		return err
	}
	var errs []string
	for _, r := range strings.Split(out, "\n") {
		lnk, dove, ok := strings.Cut(strings.TrimSpace(r), "\t")
		if !ok || !stessoFile(dove, exe) {
			continue
		}
		if err := os.Remove(lnk); err != nil {
			errs = append(errs, err.Error())
		}
	}
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
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

var (
	procSHGetKnownFolderPath = syscall.NewLazyDLL(dllSistema("shell32.dll")).NewProc("SHGetKnownFolderPath")
	procCoTaskMemFree        = syscall.NewLazyDLL(dllSistema("ole32.dll")).NewProc("CoTaskMemFree")
	procSHFileOperationW     = syscall.NewLazyDLL(dllSistema("shell32.dll")).NewProc("SHFileOperationW")
	procGetDriveTypeW        = syscall.NewLazyDLL(dllSistema("kernel32.dll")).NewProc("GetDriveTypeW")
	procGetFileVersionInfoSz = syscall.NewLazyDLL(dllSistema("version.dll")).NewProc("GetFileVersionInfoSizeW")
	procGetFileVersionInfoW  = syscall.NewLazyDLL(dllSistema("version.dll")).NewProc("GetFileVersionInfoW")
	procVerQueryValueW       = syscall.NewLazyDLL(dllSistema("version.dll")).NewProc("VerQueryValueW")
)

// cartellaNota: una cartella dell'utente come la sa Windows (anche il Desktop spostato su OneDrive), "" se non c'è.
func cartellaNota(id *syscall.GUID) string {
	var p *uint16
	if r, _, _ := procSHGetKnownFolderPath.Call(uintptr(unsafe.Pointer(id)), 0, 0, uintptr(unsafe.Pointer(&p))); r != 0 || p == nil {
		return ""
	}
	defer procCoTaskMemFree.Call(uintptr(unsafe.Pointer(p)))
	n := 0
	for q := unsafe.Pointer(p); *(*uint16)(q) != 0 && n < 32768; q = unsafe.Add(q, 2) {
		n++
	}
	return syscall.UTF16ToString(unsafe.Slice(p, n))
}

var (
	cartellaDesktop  = syscall.GUID{Data1: 0xB4BFCC3A, Data2: 0xDB2C, Data3: 0x424C, Data4: [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41}}
	cartellaDownload = syscall.GUID{Data1: 0x374DE290, Data2: 0x123F, Data3: 0x4565, Data4: [8]byte{0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B}}
)

// cartelleUtente: il Desktop (anche quando sta su OneDrive) e Download, dove di solito finiscono i file scaricati o le copie.
// Le chiede a Windows direttamente (prima con PowerShell: uno o due secondi in più a ogni apertura del programma installato).
var cartelleUtente = func() func() []string {
	var una sync.Once
	var out []string
	return func() []string {
		una.Do(func() {
			for _, id := range []*syscall.GUID{&cartellaDesktop, &cartellaDownload} {
				if d := cartellaNota(id); d != "" {
					out = append(out, d)
				}
			}
			if len(out) < 2 {
				logAvviso("installazione", "cartelle Desktop e Download lette solo in parte: %q", out)
				if h, e := os.UserHomeDir(); e == nil && len(out) == 0 {
					out = []string{filepath.Join(h, "Desktop"), filepath.Join(h, "Downloads")}
				}
			}
		})
		return out
	}
}()

// shFileOpStruct: SHFILEOPSTRUCTW (64 bit).
type shFileOpStruct struct {
	Hwnd          uintptr
	Func          uint32
	From          *uint16
	To            *uint16
	Flags         uint16
	Aborted       int32
	NameMappings  uintptr
	ProgressTitle *uint16
}

// nelCestino sposta un file nel Cestino di Windows (si può riprendere da lì), come fa Esplora file, ma senza nessuna finestra:
// un errore torna al programma invece di aprire un avviso nascosto dietro Edge. Solo su un disco del computer (su una chiavetta o
// in rete il Cestino non c'è e il file sparirebbe davvero).
func nelCestino(percorso string) error {
	ass, err := filepath.Abs(percorso)
	if err != nil {
		return err
	}
	radice, err := syscall.UTF16PtrFromString(filepath.VolumeName(ass) + `\`)
	if err != nil {
		return err
	}
	const driveFixed = 3
	if t, _, _ := procGetDriveTypeW.Call(uintptr(unsafe.Pointer(radice))); t != driveFixed {
		return errors.New("il file non è su un disco del computer (lì il Cestino non c'è): cancellalo a mano se non serve")
	}
	da, err := syscall.UTF16FromString(ass)
	if err != nil {
		return err
	}
	da = append(da, 0) // the list of files ends with two zeros
	const (
		foDelete          = 0x0003
		fofSilent         = 0x0004
		fofNoConfirmation = 0x0010
		fofAllowUndo      = 0x0040
		fofNoErrorUI      = 0x0400
	)
	op := shFileOpStruct{Func: foDelete, From: &da[0], Flags: fofAllowUndo | fofNoConfirmation | fofSilent | fofNoErrorUI}
	if r, _, _ := procSHFileOperationW.Call(uintptr(unsafe.Pointer(&op))); r != 0 {
		return fmt.Errorf("Windows non l'ha spostato (codice %#x): forse è aperto", r)
	}
	if op.Aborted != 0 {
		return errors.New("spostamento interrotto")
	}
	if _, err := os.Stat(ass); err == nil {
		return errors.New("il file è ancora al suo posto")
	}
	return nil
}

// versioneFile: la versione scritta nel programma (le risorse del file .exe, come le mostra Esplora file in Proprietà › Dettagli),
// per esempio «1.29.0»; "" se non c'è o non si legge.
func versioneFile(exe string) string {
	p, err := syscall.UTF16PtrFromString(exe)
	if err != nil {
		return ""
	}
	n, _, _ := procGetFileVersionInfoSz.Call(uintptr(unsafe.Pointer(p)), 0)
	if n == 0 || n > 1<<20 {
		return ""
	}
	buf := make([]byte, n)
	if r, _, _ := procGetFileVersionInfoW.Call(uintptr(unsafe.Pointer(p)), 0, n, uintptr(unsafe.Pointer(&buf[0]))); r == 0 {
		return ""
	}
	radice, _ := syscall.UTF16PtrFromString(`\`)
	var info unsafe.Pointer
	var lun uint32
	if r, _, _ := procVerQueryValueW.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(radice)), uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Pointer(&lun))); r == 0 || info == nil || lun < 52 {
		return ""
	}
	// VS_FIXEDFILEINFO: signature, struct version, then the file version (high and low 32 bits)
	ff := (*[4]uint32)(info)
	if ff[0] != 0xFEEF04BD {
		return ""
	}
	ms, ls := ff[2], ff[3]
	v := fmt.Sprintf("%d.%d.%d", ms>>16, ms&0xFFFF, ls>>16)
	if b := ls & 0xFFFF; b != 0 {
		v += fmt.Sprintf(".%d", b)
	}
	return v
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
	// the entry may hold the long path or the short one (8.3) of the same file: compared on the file, as for the icons
	if out, err := regCmd("query", runKey, "/v", "GymArtSegreteria").Output(); err == nil && stessoFile(exeDiAvvio(string(out)), exe) {
		if err := regCmd("delete", runKey, "/v", "GymArtSegreteria", "/f").Run(); err != nil {
			errs = append(errs, "avvio con Windows: "+err.Error())
		}
	}
	_ = os.Remove(filepath.Join(cartella, fileInstallazione))
	_ = os.Remove(exe + suffissoPrecedente)
	_ = os.Remove(exe + ".nuovo")
	if len(errs) > 0 {
		return errors.New(strings.Join(errs, "; "))
	}
	return nil
}

// cancellaDopo: il programma che gira non può cancellare se stesso. Lo fa cmd.exe, staccato, tre secondi dopo: chi chiama esce subito
// dopo averlo avviato. I percorsi passano nelle variabili d'ambiente, tra virgolette (una «&» nel nome dell'utente resta un carattere).
func cancellaDopo(exe, cartella string) error {
	cmdExe := sistema(`System32\cmd.exe`)
	c := exec.Command(cmdExe)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 | 0x00000200, // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
		CmdLine: syscall.EscapeArg(cmdExe) + ` /d /s /c "ping -n 4 127.0.0.1 >nul & del /f /q "%GYMART_EXE%" & rmdir "%GYMART_DIR%""`} // the whole line, program first
	c.Env = append(os.Environ(), "GYMART_EXE="+exe, "GYMART_DIR="+cartella)
	if err := c.Start(); err != nil {
		return err
	}
	return c.Process.Release()
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
	} else {
		mostraInfo("Gym Art Segreteria è stata disinstallata.\n\nI dati sono ancora in Documenti\\Gym Art Segreteria.")
	}
	// the files go after this program has closed: the message above has already been read, so it closes now
	if err := cancellaDopo(exe, in.cartella); err != nil {
		showError("I file del programma non si cancellano da soli: cancella a mano la cartella " + in.cartella + ".")
	}
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
