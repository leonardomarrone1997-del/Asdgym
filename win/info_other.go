//go:build !windows

package main

import (
	"runtime"
	"syscall"
)

// Fuori da Windows il programma gira solo per lo sviluppo e per le prove.
func versioneSistema() string { return runtime.GOOS }

func spazioLibero(dir string) (liberi, totali int64, ok bool) {
	var st syscall.Statfs_t
	if syscall.Statfs(dir, &st) != nil {
		return 0, 0, false
	}
	return int64(st.Bavail) * int64(st.Bsize), int64(st.Blocks) * int64(st.Bsize), true
}
