//go:build !windows

package main

import "errors"

const suoniDisponibili = false

// Su questo sistema il programma non suona niente: i suoni sono fatti per Windows.
func suonaSistema([]byte) error { return errors.New("i suoni funzionano solo su Windows") }
