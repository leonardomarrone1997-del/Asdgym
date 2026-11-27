//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

// Outside Windows the program is only run for development and tests.
func openWindow(url string) error {
	return exec.Command("xdg-open", url).Start()
}

// chiudiFinestre: outside Windows the windows are the person's browser: nothing is closed.
func chiudiFinestre() {}

func openFolder(dir string) error {
	return exec.Command("xdg-open", dir).Start()
}

// Start with Windows exists only on Windows.
var leggiAvvio func() bool
var impostaAvvio func(bool) error

// pickFolder is nil: there is no folder dialog here, the path is typed.
var pickFolder func() (string, error)

func showError(msg string) {
	fmt.Fprintln(os.Stderr, msg)
}
