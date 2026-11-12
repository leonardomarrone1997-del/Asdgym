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

func openFolder(dir string) error {
	return exec.Command("xdg-open", dir).Start()
}

// pickFolder is nil: there is no folder dialog here, the path is typed.
var pickFolder func() (string, error)

func showError(msg string) {
	fmt.Fprintln(os.Stderr, msg)
}
