//go:build windows

package main

import (
	"fmt"
	"syscall"
	"unsafe"
)

// versioneSistema dice quale Windows è (numero e build): serve a chi cura il programma per capire un guasto che c'è su un computer e non su un altro.
func versioneSistema() string {
	var v struct {
		Size                          uint32
		Major, Minor, Build, Platform uint32
		CSD                           [128]uint16
	}
	v.Size = uint32(unsafe.Sizeof(v))
	r, _, _ := syscall.NewLazyDLL(dllSistema("ntdll.dll")).NewProc("RtlGetVersion").Call(uintptr(unsafe.Pointer(&v)))
	if r != 0 {
		return "Windows (versione non letta)"
	}
	nome := fmt.Sprintf("Windows %d.%d", v.Major, v.Minor)
	if v.Major == 10 && v.Build >= 22000 {
		nome = "Windows 11"
	} else if v.Major == 10 {
		nome = "Windows 10"
	}
	return fmt.Sprintf("%s (versione %d.%d, build %d)", nome, v.Major, v.Minor, v.Build)
}

// spazioLibero dice quanto posto c'è sul disco della cartella (liberi e totali, in byte). ok è falso se Windows non lo dice.
func spazioLibero(dir string) (liberi, totali int64, ok bool) {
	p, err := syscall.UTF16PtrFromString(dir)
	if err != nil {
		return 0, 0, false
	}
	var l, t, f uint64
	r, _, _ := syscall.NewLazyDLL(dllSistema("kernel32.dll")).NewProc("GetDiskFreeSpaceExW").Call(uintptr(unsafe.Pointer(p)), uintptr(unsafe.Pointer(&l)), uintptr(unsafe.Pointer(&t)), uintptr(unsafe.Pointer(&f)))
	if r == 0 {
		return 0, 0, false
	}
	return int64(l), int64(t), true
}
