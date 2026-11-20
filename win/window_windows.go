//go:build windows

package main

import (
	"context"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

// browserPaths lists Edge first (it is part of Windows), then Chrome: both can show a page as an app window.
func browserPaths() []string {
	var out []string
	roots := []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData")}
	for _, rel := range []string{`Microsoft\Edge\Application\msedge.exe`, `Google\Chrome\Application\chrome.exe`} {
		for _, root := range roots {
			if root != "" {
				out = append(out, filepath.Join(root, rel))
			}
		}
	}
	return out
}

// sistema dà il percorso completo di un programma di Windows (nella cartella di sistema): non lo si cerca nel PATH, dove un programma
// con lo stesso nome messo da qualcun altro verrebbe prima. Se il file non c'è, resta il nome semplice.
func sistema(rel string) string {
	radice := os.Getenv("SystemRoot")
	if radice == "" {
		radice = `C:\Windows`
	}
	p := filepath.Join(radice, rel)
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return filepath.Base(rel)
}

// openWindow shows the page in a window of its own; without Edge or Chrome it falls back to the default browser.
func openWindow(url string) error {
	for _, p := range browserPaths() {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		cmd := exec.Command(p, "--app="+url, "--window-size=1280,860")
		if err := cmd.Start(); err == nil {
			cmd.Process.Release()
			return nil
		}
	}
	cmd := exec.Command(sistema(`System32\rundll32.exe`), "url.dll,FileProtocolHandler", url)
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	return nil
}

func openFolder(dir string) error {
	cmd := exec.Command(sistema("explorer.exe"), dir)
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	return nil
}

// pickFolder shows the Windows "choose a folder" dialog and returns the folder, or "" if it was closed.
// It borrows the dialog from PowerShell, which is part of Windows; the path comes back in Base64 so that
// accented letters survive whatever the console encoding is.
var pickFolder = func() (string, error) {
	const script = `Add-Type -AssemblyName System.Windows.Forms; ` +
		`$d = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$d.Description = 'Scegli la cartella per la seconda copia (una chiavetta o un disco esterno)'; ` +
		`$d.ShowNewFolderButton = $true; ` +
		`$w = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}; ` +
		`if ($d.ShowDialog($w) -eq [System.Windows.Forms.DialogResult]::OK) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($d.SelectedPath)) }`
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, sistema(`System32\WindowsPowerShell\v1.0\powershell.exe`), "-NoProfile", "-STA", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW: no console flashes up
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	dir, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(out)))
	if err != nil {
		return "", err
	}
	return string(dir), nil
}

const runKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

func regCmd(args ...string) *exec.Cmd {
	cmd := exec.Command(sistema(`System32\reg.exe`), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

// leggiAvvio says whether the program starts with Windows (an entry of the current user, no administrator needed).
var leggiAvvio = func() bool { return regCmd("query", runKey, "/v", "GymArtSegreteria").Run() == nil }

// impostaAvvio switches the start with Windows on or off. It starts without a window: the program only serves the other devices.
var impostaAvvio = func(on bool) error {
	if !on {
		if !leggiAvvio() {
			return nil
		}
		return regCmd("delete", runKey, "/v", "GymArtSegreteria", "/f").Run()
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return regCmd("add", runKey, "/v", "GymArtSegreteria", "/t", "REG_SZ", "/d", `"`+exe+`" -senza-finestra`, "/f").Run()
}

// showError uses a message box: the program has no console window.
func showError(msg string) {
	title, err1 := syscall.UTF16PtrFromString("Gym Art Segreteria")
	text, err2 := syscall.UTF16PtrFromString(msg)
	if err1 != nil || err2 != nil {
		return
	}
	const mbIconError = 0x10
	syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconError)
}
