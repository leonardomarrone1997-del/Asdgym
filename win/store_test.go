package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustOpen(t *testing.T, dir string) *Store {
	t.Helper()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatalf("OpenStore: %v", err)
	}
	return s
}

// compact removes the indentation the store adds when it writes the file.
func compact(raw []byte) string {
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		return string(raw)
	}
	return b.String()
}

func TestStoreSaveAndReload(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir)
	if rev, db, _ := s.State(); rev != 0 || db != nil {
		t.Fatalf("new store: rev=%d db=%s", rev, db)
	}
	rev, warn, err := s.Save(0, json.RawMessage(`{"allieve":[{"id":"0001"}]}`), []Entry{{Allieva: "Rossi Maria", Operazione: "Nuova allieva"}}, false)
	if err != nil || warn != "" || rev != 1 {
		t.Fatalf("Save: rev=%d warn=%q err=%v", rev, warn, err)
	}

	again := mustOpen(t, dir)
	rev, db, salvato := again.State()
	if rev != 1 || salvato == "" {
		t.Fatalf("reload: rev=%d salvato=%q", rev, salvato)
	}
	var got struct{ Allieve []struct{ ID string } }
	if err := json.Unmarshal(db, &got); err != nil || len(got.Allieve) != 1 || got.Allieve[0].ID != "0001" {
		t.Fatalf("reload db: %s (%v)", db, err)
	}
	rows, err := again.Registro(10)
	if err != nil || len(rows) != 1 || rows[0].Allieva != "Rossi Maria" || rows[0].Quando == "" {
		t.Fatalf("registro: %+v (%v)", rows, err)
	}
	if _, err := os.Stat(filepath.Join(dir, archiveName+".tmp")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary file left behind: %v", err)
	}
}

func TestStoreRejectsStaleRevisionAndBadData(t *testing.T) {
	s := mustOpen(t, t.TempDir())
	if _, _, err := s.Save(0, json.RawMessage(`{"a":1}`), nil, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Save(0, json.RawMessage(`{"a":2}`), nil, false); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision: %v", err)
	}
	for _, bad := range []string{``, `null`, `[]`, `{"a":`, `"x"`} {
		if _, _, err := s.Save(1, json.RawMessage(bad), nil, false); err == nil || errors.Is(err, ErrConflict) {
			t.Fatalf("bad data %q accepted or misreported: %v", bad, err)
		}
	}
	if rev, db, _ := s.State(); rev != 1 || string(db) != `{"a":1}` {
		t.Fatalf("archive changed by rejected saves: rev=%d db=%s", rev, db)
	}
}

func TestStoreDetectsFileChangedByAnotherProgram(t *testing.T) {
	dir := t.TempDir()
	a := mustOpen(t, dir)
	if _, _, err := a.Save(0, json.RawMessage(`{"n":1}`), nil, false); err != nil {
		t.Fatal(err)
	}
	b := mustOpen(t, dir)
	time.Sleep(20 * time.Millisecond)
	if _, _, err := b.Save(1, json.RawMessage(`{"n":2,"longer":true}`), nil, false); err != nil {
		t.Fatal(err)
	}
	// a still believes revision 1 is current
	if _, _, err := a.Save(1, json.RawMessage(`{"n":3}`), nil, false); !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict, got %v", err)
	}
	if rev, db, _ := a.State(); rev != 2 || !strings.Contains(compact(db), `"n":2`) {
		t.Fatalf("a did not reload: rev=%d db=%s", rev, db)
	}
}

func TestStoreKeepsDamagedArchive(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, archiveName), []byte(`{"rev":3,"db":{"x":`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenStore(dir); err == nil {
		t.Fatal("a damaged archive must stop the program")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, archiveName))
	if string(raw) != `{"rev":3,"db":{"x":` {
		t.Fatalf("damaged archive was modified: %s", raw)
	}
}

func TestStoreCopies(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir)
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }

	save := func(rev int64, body string) {
		t.Helper()
		if _, _, err := s.Save(rev, json.RawMessage(body), nil, false); err != nil {
			t.Fatal(err)
		}
	}
	save(0, `{"v":1}`) // nothing to copy yet
	if n := len(s.copyNames()); n != 0 {
		t.Fatalf("copies after first save: %d", n)
	}
	clock = clock.Add(time.Minute)
	save(1, `{"v":2}`) // first change of an existing archive: copy of v1
	clock = clock.Add(time.Minute)
	save(2, `{"v":3}`) // too soon for another copy
	names := s.copyNames()
	if len(names) != 1 {
		t.Fatalf("copies: %v", names)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, copiesDir, names[0]))
	if !strings.Contains(compact(raw), `"v":1`) {
		t.Fatalf("the copy must hold the archive as it was before the change: %s", raw)
	}
	clock = clock.Add(copyEvery)
	save(3, `{"v":4}`)
	if n := len(s.copyNames()); n != 2 {
		t.Fatalf("copies after the interval: %d", n)
	}

	// old copies are dropped, newest kept
	for i := 0; i < keepCopies+5; i++ {
		clock = clock.Add(copyEvery)
		rev, _, _ := s.State()
		save(rev, `{"v":"x"}`)
	}
	names = s.copyNames()
	if len(names) != keepCopies {
		t.Fatalf("kept %d copies, want %d", len(names), keepCopies)
	}
	if want := "archivio-" + clock.Format("20060102-150405") + ".json"; names[len(names)-1] != want {
		t.Fatalf("newest copy %s, want %s", names[len(names)-1], want)
	}
}

func TestStoreForcedCopy(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir)
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	save := func(rev int64, body string, force bool) {
		t.Helper()
		if _, _, err := s.Save(rev, json.RawMessage(body), nil, force); err != nil {
			t.Fatal(err)
		}
	}
	save(0, `{"v":1}`, true) // nothing to copy yet, even when asked
	if n := len(s.copyNames()); n != 0 {
		t.Fatalf("copies of an archive that did not exist: %d", n)
	}
	save(1, `{"v":2}`, false) // the regular copy of v1
	// one second later the regular rule would not copy, but an import or a restore must
	clock = clock.Add(time.Second)
	save(2, `{"v":3}`, true)
	// and again within the same second: the earlier copy is kept, not overwritten
	save(3, `{"v":4}`, true)
	names := s.copyNames()
	if len(names) != 3 {
		t.Fatalf("copies: %v", names)
	}
	var seen []string
	for _, n := range names {
		raw, _ := os.ReadFile(filepath.Join(dir, copiesDir, n))
		seen = append(seen, compact(raw))
	}
	all := strings.Join(seen, " ")
	for _, want := range []string{`"v":1`, `"v":2`, `"v":3`} {
		if !strings.Contains(all, want) {
			t.Fatalf("no copy holds %s: %v", want, seen)
		}
	}
}

func TestRegistroNewestFirstAndLimit(t *testing.T) {
	s := mustOpen(t, t.TempDir())
	for i, name := range []string{"uno", "due", "tre"} {
		if _, _, err := s.Save(int64(i), json.RawMessage(`{}`), []Entry{{Allieva: name, Operazione: "Modifica", Campo: "Telefono", Prima: "1", Dopo: "2"}}, false); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := s.Registro(2)
	if err != nil || len(rows) != 2 || rows[0].Allieva != "tre" || rows[1].Allieva != "due" {
		t.Fatalf("registro: %+v (%v)", rows, err)
	}
}
