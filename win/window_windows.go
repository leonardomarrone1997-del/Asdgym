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
	"strings"
	"sync"
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

// argomentiFinestra: the page in a window of its own, like a program and not like a browser (1.25.0). A profile of its own
// (%LOCALAPPDATA%\GymArtSegreteria\Finestra, never in Documents, which OneDrive may sync) makes it a separate Edge with its own window and
// taskbar button, where these options hold even when Edge is already open; nothing of the browser around it: no first-run pages,
// no extensions, no translation bar, no sidebar, no zoom with two fingers, no "back" with a swipe. Options Edge does not know are ignored.
// The size (1.29.0) only when Edge does not remember the window yet: see finestra.go.
func argomentiFinestra(url, profilo string, ap *Apertura) []string {
	a := []string{"--app=" + url, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-sync",
		"--disable-pinch", "--overscroll-history-navigation=0", "--disable-features=Translate,msEdgeSidebarV2,msHubApps,msEdgeShoppingUI,msUndersideButton"}
	if ap != nil {
		a = append(a, ap.argomenti()...)
	}
	if profilo != "" {
		a = append(a, "--user-data-dir="+profilo)
	}
	return a
}

// profiloFinestra: the folder of the window's own Edge profile ("" if LocalAppData is missing: then Edge uses its usual profile).
func profiloFinestra() string {
	la := os.Getenv("LocalAppData")
	if la == "" {
		return ""
	}
	dir := filepath.Join(la, "GymArtSegreteria", "Finestra")
	if os.MkdirAll(dir, 0o700) != nil {
		return ""
	}
	return dir
}

// openWindow shows the page in a window of its own; without Edge or Chrome it falls back to the default browser.
func openWindow(url string) error {
	profilo := profiloFinestra()
	var ap *Apertura
	if !edgeRicordaFinestra(profilo) { // the first time (or a new profile): a size in proportion to the screen
		x := aperturaFinestra(areaDiLavoro())
		ap = &x
	}
	for _, p := range browserPaths() {
		if _, err := os.Stat(p); err != nil {
			continue
		}
		cmd := exec.Command(p, argomentiFinestra(urlFinestra(url), profilo, ap)...)
		if err := cmd.Start(); err == nil {
			pid := cmd.Process.Pid
			cmd.Process.Release()
			if ap != nil {
				logInfo("finestra", "aperta con %s, la prima volta: %dx%d%s", filepath.Base(p), ap.W, ap.H, map[bool]string{true: ", ingrandita", false: ""}[ap.Ingrandisci])
				if ap.Ingrandisci {
					go ingrandisciQuandoAppare(pid)
				}
			} else {
				logInfo("finestra", "aperta con %s, come l'ultima volta", filepath.Base(p))
			}
			return nil
		}
	}
	logAvviso("finestra", "né Edge né Chrome si sono aperti: uso il browser predefinito")
	cmd := exec.Command(sistema(`System32\rundll32.exe`), "url.dll,FileProtocolHandler", url)
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	return nil
}

var (
	procSystemParametersInfoW    = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("SystemParametersInfoW")
	procGetDpiForSystem          = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("GetDpiForSystem")
	procEnumWindows              = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("EnumWindows")
	procGetWindowThreadProcessId = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("GetWindowThreadProcessId")
	procIsWindowVisible          = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("IsWindowVisible")
	procGetClassNameW            = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("GetClassNameW")
	procGetWindowRect            = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("GetWindowRect")
	procShowWindow               = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("ShowWindow")
	procIsZoomed                 = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("IsZoomed")
)

type rettangolo struct{ Left, Top, Right, Bottom int32 }

// areaDiLavoro: the part of the main screen above the taskbar, in page pixels (the program is "system" DPI aware: see winres.json).
// An empty area if it cannot be read: then aperturaFinestra gives a plain size.
func areaDiLavoro() Area {
	var r rettangolo
	const spiGetWorkArea = 0x0030
	if ok, _, _ := procSystemParametersInfoW.Call(spiGetWorkArea, 0, uintptr(unsafe.Pointer(&r)), 0); ok == 0 {
		return Area{}
	}
	dpi := dpiNormale
	if procGetDpiForSystem.Find() == nil { // Windows 10 1607 and later
		if d, _, _ := procGetDpiForSystem.Call(); d >= 72 && d <= 960 {
			dpi = int(d)
		}
	}
	return inPixelPagina(Area{X: int(r.Left), Y: int(r.Top), W: int(r.Right - r.Left), H: int(r.Bottom - r.Top)}, dpi)
}

// finestraDi: the visible window of Edge's main process pid (class Chrome_WidgetWin_1, not a small helper window), or 0.
// Only the process the program started: a window of the person's own Edge is never touched.
func finestraDi(pid uint32) uintptr {
	cercata.Lock()
	defer cercata.Unlock()
	cercata.pid, cercata.trovata = pid, 0
	procEnumWindows.Call(cercaFinestraCallback, 0)
	return cercata.trovata
}

var cercata struct {
	sync.Mutex
	pid     uint32
	trovata uintptr
}

// cercaFinestraCallback is made once: Windows allows only a limited number of callbacks per program.
var cercaFinestraCallback = syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
	var pid uint32
	procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	if pid != cercata.pid {
		return 1
	}
	if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
		return 1
	}
	var cls [64]uint16
	n, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&cls[0])), uintptr(len(cls)))
	if syscall.UTF16ToString(cls[:n]) != "Chrome_WidgetWin_1" {
		return 1
	}
	var r rettangolo
	if ok, _, _ := procGetWindowRect.Call(hwnd, uintptr(unsafe.Pointer(&r))); ok == 0 || r.Right-r.Left < 300 || r.Bottom-r.Top < 200 {
		return 1
	}
	cercata.trovata = hwnd
	return 0 // found: stop
})

// ingrandisciQuandoAppare maximizes the program's window as soon as Edge shows it (at most 20 seconds of waiting). Edge then
// remembers it maximized, and opens it so the next times by itself.
func ingrandisciQuandoAppare(pid int) {
	defer recuperaPanic("finestra")
	for fine := time.Now().Add(20 * time.Second); time.Now().Before(fine); time.Sleep(150 * time.Millisecond) {
		if h := finestraDi(uint32(pid)); h != 0 {
			const swMaximize = 3
			procShowWindow.Call(h, swMaximize)
			logInfo("finestra", "ingrandita: lo schermo è piccolo")
			return
		}
	}
	logAvviso("finestra", "non ho trovato la finestra da ingrandire: resta della misura data")
}

// ingrandita says whether the window is maximized (for the tests on Windows).
func ingrandita(h uintptr) bool { r, _, _ := procIsZoomed.Call(h); return r != 0 }

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
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return "", fmt.Errorf("%w: %s", err, dettaglioPS(string(ee.Stderr)))
		}
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
