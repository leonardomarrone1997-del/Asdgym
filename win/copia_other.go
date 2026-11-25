//go:build !windows

package main

import "errors"

// Outside Windows (development and tests) there is no window to ask in, and an older copy is not closed.
func chiedi(msg string) bool { return false }

func chiudiCopiaAperta(porta int) error { return errors.New("solo su Windows") }
