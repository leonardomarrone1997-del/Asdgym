//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
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
	cmd := exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	return nil
}

func openFolder(dir string) error {
	cmd := exec.Command("explorer.exe", dir)
	if err := cmd.Start(); err != nil {
		return err
	}
	cmd.Process.Release()
	return nil
}

// showError uses a message box: the program has no console window.
func showError(msg string) {
	title, err1 := syscall.UTF16PtrFromString("Gym Art Segreteria")
	text, err2 := syscall.UTF16PtrFromString(msg)
	if err1 != nil || err2 != nil {
		return
	}
	const mbIconError = 0x10
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbIconError)
}
