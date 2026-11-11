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

func showError(msg string) {
	fmt.Fprintln(os.Stderr, msg)
}
