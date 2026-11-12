package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newMirror(t *testing.T) (*Mirror, string, *string) {
	t.Helper()
	data := t.TempDir()
	content := "archivio uno"
	m := OpenMirror(data, func() ([]byte, error) {
		if content == "" {
			return nil, os.ErrNotExist
		}
		return []byte(content), nil
	})
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	m.now = func() time.Time { return clock }
	return m, data, &content
}

func TestMirrorCopiesOncePerDayAndKeepsThirty(t *testing.T) {
	m, data, content := newMirror(t)
	if err := m.CopyNow(); err != nil || m.Status().Ultima != "" {
		t.Fatalf("no folder chosen: %v %+v", err, m.Status())
	}
	dir := filepath.Join(t.TempDir(), "chiavetta", "Copie Gym Art")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	today := filepath.Join(dir, "gymart-20261110.json")
	if raw, _ := os.ReadFile(today); string(raw) != "archivio uno" {
		t.Fatalf("first copy: %q", raw)
	}
	// a later save of the same day rewrites the same file
	*content = "archivio due"
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	if raw, _ := os.ReadFile(today); string(raw) != "archivio due" {
		t.Fatalf("second copy of the day: %q", raw)
	}
	if st := m.Status(); st.Cartella != dir || st.Ultima != "2026-11-10T09:00:00Z" || st.Errore != "" {
		t.Fatalf("status: %+v", st)
	}
	// 40 more days: only the newest 30 files stay, and other files in the folder are never touched
	os.WriteFile(filepath.Join(dir, "foto-saggio.jpg"), []byte("x"), 0o600)
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	for i := 0; i < 40; i++ {
		clock = clock.AddDate(0, 0, 1)
		c := clock
		m.now = func() time.Time { return c }
		if err := m.CopyNow(); err != nil {
			t.Fatal(err)
		}
	}
	items, _ := os.ReadDir(dir)
	var copies []string
	for _, it := range items {
		if strings.HasPrefix(it.Name(), "gymart-") {
			copies = append(copies, it.Name())
		}
	}
	if len(copies) != mirrorKeep || copies[len(copies)-1] != "gymart-20261220.json" || copies[0] != "gymart-20261121.json" {
		t.Fatalf("kept %d copies: %v", len(copies), copies)
	}
	if _, err := os.Stat(filepath.Join(dir, "foto-saggio.jpg")); err != nil {
		t.Fatal("a file that is not a copy was removed")
	}
	// the choice survives a restart
	again := OpenMirror(data, func() ([]byte, error) { return nil, os.ErrNotExist })
	if st := again.Status(); st.Cartella != dir || st.Ultima != "2026-12-20T09:00:00Z" {
		t.Fatalf("after restart: %+v", st)
	}
	if err := again.CopyNow(); err != nil {
		t.Fatalf("no archive yet must not be an error: %v", err)
	}
}

func TestMirrorRefusesBadFoldersAndReportsFailures(t *testing.T) {
	m, data, _ := newMirror(t)
	for _, bad := range []string{"Copie", data, filepath.Join(data, "copie"), filepath.Join(data, "x", "y")} {
		if err := m.Set(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
	if m.Status().Cartella != "" {
		t.Fatal("a refused folder was kept")
	}
	dir := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	// the stick is pulled out: here, the folder becomes a file, so nothing can be written in it
	os.RemoveAll(dir)
	os.WriteFile(dir, []byte("non una cartella"), 0o600)
	err := m.CopyNow()
	st := m.Status()
	if err == nil || st.Errore == "" || st.Ultima == "" {
		t.Fatalf("failure not reported: %v %+v", err, st)
	}
	// back again: the next copy clears the error
	os.Remove(dir)
	if err := m.CopyNow(); err != nil || m.Status().Errore != "" {
		t.Fatalf("recovery: %v %+v", err, m.Status())
	}
	// choosing no folder turns the copies off
	if err := m.Set(""); err != nil || m.Status().Cartella != "" {
		t.Fatalf("turning off: %v", err)
	}
}

func TestMirrorKickAndFlush(t *testing.T) {
	m, _, content := newMirror(t)
	dir := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	*content = "dopo il salvataggio"
	m.Kick()
	m.Kick() // a second request while one waits is not an error
	m.Flush()
	deadline := time.Now().Add(2 * time.Second)
	for {
		raw, err := os.ReadFile(filepath.Join(dir, "gymart-20261110.json"))
		if err == nil && string(raw) == "dopo il salvataggio" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the copy asked for was not made: %q %v", raw, errors.Unwrap(err))
		}
		time.Sleep(10 * time.Millisecond)
	}
}
