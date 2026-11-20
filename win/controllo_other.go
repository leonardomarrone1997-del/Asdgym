//go:build !windows

package main

import "context"

// Fuori da Windows il programma gira solo per lo sviluppo e per le prove: queste prove non si possono fare.
func browserTrovato() string { return "" }

func contaAudio() (int, error) { return 0, errNonDisponibile }

func contaScanner(context.Context) (int, error) { return 0, errNonDisponibile }
