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

func init() { kdfIterations = 1000 } // the real work factor would make every test wait

const pw1, pw2 = "prima-password", "seconda-password"

// secret is a marker that must never be readable on disk once there is a password.
const secret = "Rossi Maria"

func protectedStore(t *testing.T) (*Store, string) {
	t.Helper()
	dir := t.TempDir()
	s := mustOpen(t, dir)
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	body := func(n int) json.RawMessage {
		return json.RawMessage(`{"allieve":[{"id":"0001","name":"` + secret + `","n":` + string(rune('0'+n)) + `}]}`)
	}
	for i := 0; i < 3; i++ { // three saves: two copies (the second forced), three log lines
		if _, _, err := s.Save(int64(i), body(i), []Entry{{Allieva: secret, Operazione: "Modifica"}}, i == 2); err != nil {
			t.Fatal(err)
		}
		clock = clock.Add(time.Second)
	}
	if warn, err := s.SetPassword("", pw1); err != nil || warn != "" {
		t.Fatalf("SetPassword: %q %v", warn, err)
	}
	return s, dir
}

// onDisk returns every file of the data folder joined together.
func onDisk(t *testing.T, dir string) string {
	t.Helper()
	var all []byte
	filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err == nil && !fi.IsDir() {
			raw, _ := os.ReadFile(p)
			all = append(all, raw...)
		}
		return nil
	})
	return string(all)
}

func TestKeyringRoundTrip(t *testing.T) {
	k, err := newKeyring(pw1)
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte(`{"rev":1,"db":{"x":"` + secret + `"}}`)
	raw, err := k.sealFile(plain)
	if err != nil || bytes.Contains(raw, []byte(secret)) {
		t.Fatalf("sealFile: %v %s", err, raw)
	}
	f, ok := parseSealed(raw)
	if !ok {
		t.Fatal("not recognised as encrypted")
	}
	if got, err := k.openFile(f); err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("openFile: %v", err)
	}
	// from the file alone, with the password
	k2, err := unlockHeader(f, pw1)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := k2.openFile(f); err != nil || !bytes.Equal(got, plain) {
		t.Fatalf("file + password: %v", err)
	}
	if _, err := unlockHeader(f, pw2); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("wrong password: %v", err)
	}
	// two encryptions of the same text differ, and a changed byte is detected
	raw2, _ := k.sealFile(plain)
	if bytes.Equal(raw, raw2) {
		t.Fatal("same output twice: the nonce is not random")
	}
	g := *f
	box, _ := b64.DecodeString(g.Dati)
	box[len(box)-1] ^= 1
	g.Dati = b64.EncodeToString(box)
	if _, err := k.openFile(&g); err == nil {
		t.Fatal("tampered data accepted")
	}
	// a log line is not a file and the other way round
	line, _ := k.sealLine([]byte(`{"allieva":"x"}`))
	if got, err := k.openLine(line); err != nil || string(got) != `{"allieva":"x"}` {
		t.Fatalf("line: %v", err)
	}
	var l sealedLine
	json.Unmarshal(line, &l)
	g = *f
	g.Dati = l.C
	if _, err := k.openFile(&g); err == nil {
		t.Fatal("a log line was accepted as an archive")
	}
	if _, ok := parseSealed([]byte(`{"rev":1,"db":{}}`)); ok {
		t.Fatal("a plain archive taken for an encrypted one")
	}
	if _, err := newKeyring("corta"); err == nil {
		t.Fatal("short password accepted")
	}
}

func TestProtectedStoreKeepsNothingReadableOnDisk(t *testing.T) {
	s, dir := protectedStore(t)
	if !s.Protected() || s.Locked() {
		t.Fatalf("protected=%v locked=%v", s.Protected(), s.Locked())
	}
	if disk := onDisk(t, dir); strings.Contains(disk, secret) || strings.Contains(disk, "allieve") {
		t.Fatal("the archive, the log or a copy is still readable on disk")
	}
	if n := len(s.copyNames()); n != 2 {
		t.Fatalf("copies: %d", n)
	}
	// saving goes on: the new data and the new log line are encrypted too
	if _, _, err := s.Save(3, json.RawMessage(`{"allieve":[{"name":"`+secret+` due"}]}`), []Entry{{Allieva: secret, Operazione: "Dopo"}}, true); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(onDisk(t, dir), secret) {
		t.Fatal("a save after protection left readable data")
	}
	rows, err := s.Registro(10)
	if err != nil || len(rows) != 4 || rows[0].Operazione != "Dopo" || rows[3].Allieva != secret {
		t.Fatalf("registro: %+v %v", rows, err)
	}
}

func TestLockedStoreNeedsThePassword(t *testing.T) {
	_, dir := protectedStore(t)
	s := mustOpen(t, dir)
	if !s.Locked() || !s.Protected() {
		t.Fatal("an encrypted archive must open locked")
	}
	if rev, db, _ := s.State(); rev != 0 || db != nil {
		t.Fatalf("data visible while locked: %d %s", rev, db)
	}
	if _, _, err := s.Save(0, json.RawMessage(`{}`), nil, false); !errors.Is(err, ErrLocked) {
		t.Fatalf("save while locked: %v", err)
	}
	if _, err := s.Registro(5); !errors.Is(err, ErrLocked) {
		t.Fatalf("registro while locked: %v", err)
	}
	if _, err := s.SetPassword(pw1, ""); !errors.Is(err, ErrLocked) {
		t.Fatalf("password change while locked: %v", err)
	}
	if err := s.Unlock("sbagliata-di-sicuro"); !errors.Is(err, ErrWrongPassword) || !s.Locked() {
		t.Fatalf("wrong password: %v", err)
	}
	if err := s.Unlock(pw1); err != nil || s.Locked() {
		t.Fatalf("unlock: %v", err)
	}
	rev, db, _ := s.State()
	if rev != 3 || !strings.Contains(string(db), secret) {
		t.Fatalf("after unlock: %d %s", rev, db)
	}
	if rows, err := s.Registro(10); err != nil || len(rows) != 3 {
		t.Fatalf("registro after unlock: %d %v", len(rows), err)
	}
	if _, _, err := s.Save(3, json.RawMessage(`{"ok":true}`), nil, false); err != nil {
		t.Fatalf("save after unlock: %v", err)
	}
}

func TestChangeAndRemovePassword(t *testing.T) {
	s, dir := protectedStore(t)
	if _, err := s.SetPassword("non-la-so", pw2); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("change without the current password: %v", err)
	}
	if _, err := s.SetPassword(pw1, "corta"); err == nil {
		t.Fatal("short new password accepted")
	}
	if warn, err := s.SetPassword(pw1, pw2); err != nil || warn != "" {
		t.Fatalf("change: %q %v", warn, err)
	}
	if rev, _, _ := s.State(); rev != 3 {
		t.Fatalf("changing the password must not change the revision: %d", rev)
	}
	// from disk: the old password is gone, the new one opens archive, log and the older copies
	again := mustOpen(t, dir)
	if err := again.Unlock(pw1); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("old password still works: %v", err)
	}
	if err := again.Unlock(pw2); err != nil {
		t.Fatal(err)
	}
	if rows, _ := again.Registro(10); len(rows) != 3 {
		t.Fatalf("log after the change: %d", len(rows))
	}
	for _, name := range again.copyNames() {
		raw, _ := os.ReadFile(filepath.Join(dir, copiesDir, name))
		f, ok := parseSealed(raw)
		if !ok {
			t.Fatalf("%s is not encrypted", name)
		}
		if _, err := unlockHeader(f, pw2); err != nil {
			t.Fatalf("%s does not open with the new password: %v", name, err)
		}
	}

	// remove: everything readable again, nothing lost
	if warn, err := again.SetPassword(pw2, ""); err != nil || warn != "" {
		t.Fatalf("remove: %q %v", warn, err)
	}
	if again.Protected() {
		t.Fatal("still protected")
	}
	plain := mustOpen(t, dir)
	if plain.Locked() {
		t.Fatal("locked after removing the password")
	}
	if rev, db, _ := plain.State(); rev != 3 || !strings.Contains(string(db), secret) {
		t.Fatalf("archive after removal: %d %s", rev, db)
	}
	if rows, _ := plain.Registro(10); len(rows) != 3 {
		t.Fatalf("log after removal: %d", len(rows))
	}
	for _, name := range plain.copyNames() {
		raw, _ := os.ReadFile(filepath.Join(dir, copiesDir, name))
		if _, ok := parseSealed(raw); ok || !bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("%s is still encrypted", name)
		}
	}
	if _, err := plain.SetPassword("", ""); err != nil {
		t.Fatalf("removing a password that is not there: %v", err)
	}
}

func TestProtectNeedsAnArchive(t *testing.T) {
	s := mustOpen(t, t.TempDir())
	if _, err := s.SetPassword("", pw1); err == nil || s.Protected() {
		t.Fatalf("an empty store was protected: %v", err)
	}
}

func TestUnlockEncryptsWhatWasLeftInClear(t *testing.T) {
	s, dir := protectedStore(t)
	_ = s
	// as if the program had stopped right after encrypting the archive: a clear log line and a clear copy
	f, _ := os.OpenFile(filepath.Join(dir, registroName), os.O_APPEND|os.O_WRONLY, 0o600)
	f.WriteString(`{"quando":"2026-11-10T09:00:00Z","allieva":"` + secret + `","operazione":"In chiaro"}` + "\n")
	f.Close()
	os.WriteFile(filepath.Join(dir, copiesDir, "archivio-20261109-080000.json"), []byte(`{"rev":1,"salvato":"x","db":{"n":"`+secret+`"}}`), 0o600)
	if !strings.Contains(onDisk(t, dir), secret) {
		t.Fatal("the test did not plant readable data")
	}
	again := mustOpen(t, dir)
	if err := again.Unlock(pw1); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(onDisk(t, dir), secret) {
		t.Fatal("readable leftovers survived an unlock")
	}
	rows, _ := again.Registro(10)
	if len(rows) != 4 || rows[0].Operazione != "In chiaro" {
		t.Fatalf("log: %+v", rows)
	}
}

func TestDecryptCopy(t *testing.T) {
	s, dir := protectedStore(t)
	names := s.copyNames()
	own, _ := os.ReadFile(filepath.Join(dir, copiesDir, names[0]))
	if db, err := s.DecryptCopy(own, ""); err != nil || !strings.Contains(string(db), secret) {
		t.Fatalf("own copy: %v", err)
	}
	// a copy from another computer (another key): needs its own password
	other, _ := newKeyring(pw2)
	foreign, _ := other.sealFile([]byte(`{"rev":9,"salvato":"x","db":{"da":"altro pc"}}`))
	if _, err := s.DecryptCopy(foreign, ""); !errors.Is(err, ErrNeedPassword) {
		t.Fatalf("foreign copy without password: %v", err)
	}
	if _, err := s.DecryptCopy(foreign, pw1); !errors.Is(err, ErrWrongPassword) {
		t.Fatalf("foreign copy with the wrong password: %v", err)
	}
	if db, err := s.DecryptCopy(foreign, pw2); err != nil || !strings.Contains(string(db), "altro pc") {
		t.Fatalf("foreign copy with its password: %v", err)
	}
	// plain copies, in the two shapes the program has produced
	for _, raw := range []string{`{"rev":1,"salvato":"x","db":{"a":1}}`, `{"programma":"Gym Art Segreteria","db":{"a":1}}`} {
		if db, err := s.DecryptCopy([]byte(raw), ""); err != nil || compact(db) != `{"a":1}` {
			t.Fatalf("plain copy %s: %v", raw, err)
		}
	}
	for _, raw := range []string{`{}`, `{"db":[1]}`, `ciao`, ``} {
		if _, err := s.DecryptCopy([]byte(raw), ""); err == nil {
			t.Fatalf("%q accepted as a copy", raw)
		}
	}
	// an unprotected program can still open a protected copy, given the password
	clear := mustOpen(t, t.TempDir())
	if db, err := clear.DecryptCopy(own, pw1); err != nil || !strings.Contains(string(db), secret) {
		t.Fatalf("protected copy on an unprotected program: %v", err)
	}
}
