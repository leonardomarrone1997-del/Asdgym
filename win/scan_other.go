//go:build !windows

package main

import "os"

// Fuori da Windows non c'è la finestra dello scanner. Per lo sviluppo e per i test, se GYMART_SCANNER_PROVA indica un file,
// quel file fa le veci della scansione.
var scanImage func() ([]byte, error)

func init() {
	if p := os.Getenv("GYMART_SCANNER_PROVA"); p != "" {
		scanImage = func() ([]byte, error) { return os.ReadFile(p) }
	}
}
