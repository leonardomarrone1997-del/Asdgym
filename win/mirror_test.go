package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// archiveJSON builds an archive with n students.
func archiveJSON(n int, tag string) json.RawMessage {
	var b strings.Builder
	b.WriteString(`{"tag":"` + tag + `","allieve":[`)
	for i := 0; i < n; i++ {
		if i > 0 {
			b.WriteString(",")
		}
		b.WriteString(`{"id":"` + string(rune('A'+i%26)) + `"}`)
	}
	b.WriteString(`],"iscrizioni":[],"pagamenti":[]}`)
	return json.RawMessage(b.String())
}

// newMirror returns a mirror, its store and a settable clock shared by both.
func newMirror(t *testing.T) (*Mirror, *Store, *time.Time) {
	t.Helper()
	data := t.TempDir()
	s := mustOpen(t, data)
	clock := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	m := OpenMirror(data, s)
	m.now = func() time.Time { return clock }
	return m, s, &clock
}

func save(t *testing.T, s *Store, db json.RawMessage, who string) {
	t.Helper()
	rev, _, _ := s.State()
	if _, _, err := s.Save(rev, db, []Entry{{Allieva: who, Operazione: "Modifica"}}, false); err != nil {
		t.Fatal(err)
	}
}

func TestMirrorHoldsLatestAndDailySnapshotsWithTheLog(t *testing.T) {
	m, s, clock := newMirror(t)
	if err := m.CopyNow(); err != nil || m.Status().Ultima != "" {
		t.Fatalf("no folder chosen: %v %+v", err, m.Status())
	}
	dir := filepath.Join(t.TempDir(), "chiavetta", "Copie Gym Art")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	if err := m.CopyNow(); err != nil {
		t.Fatalf("no archive yet must not be an error: %v", err)
	}
	save(t, s, archiveJSON(2, "uno"), "Rossi Maria")
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	live, _ := os.ReadFile(filepath.Join(s.Dir(), archiveName))
	liveLog, _ := os.ReadFile(filepath.Join(s.Dir(), registroName))
	latest := filepath.Join(dir, mirrorLatest)
	if got, _ := os.ReadFile(filepath.Join(latest, archiveName)); string(got) != string(live) {
		t.Fatal("the newest copy is not the live archive")
	}
	if got, _ := os.ReadFile(filepath.Join(latest, registroName)); string(got) != string(liveLog) || len(liveLog) == 0 {
		t.Fatal("the change log is not in the second folder")
	}
	if err := verifySnapshot(latest); err != nil {
		t.Fatal(err)
	}
	// the snapshot of the day was made at the first save, before it: it holds the state at the start of the day and is not rewritten
	day := filepath.Join(dir, dailyDir, "2026-11-10")
	if err := verifySnapshot(day); err != nil {
		t.Fatalf("daily snapshot in the second folder: %v", err)
	}
	first, _ := os.ReadFile(filepath.Join(day, archiveName))
	// a later save of the same day changes "ultima" only
	save(t, s, archiveJSON(3, "due"), "Bianchi Sara")
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	if again, _ := os.ReadFile(filepath.Join(day, archiveName)); string(again) != string(first) {
		t.Fatal("the daily snapshot was overwritten by a later save")
	}
	if got, _ := os.ReadFile(filepath.Join(latest, archiveName)); !strings.Contains(string(got), `"due"`) {
		t.Fatal("the newest copy did not follow the save")
	}
	// the next day brings a new snapshot; a file that is not ours is never touched
	os.WriteFile(filepath.Join(dir, "foto-saggio.jpg"), []byte("x"), 0o600)
	*clock = clock.AddDate(0, 0, 1)
	save(t, s, archiveJSON(3, "tre"), "Verdi Anna")
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	if st := m.Status(); st.Giornaliere != 2 || st.Errore != "" || st.Ultima == "" || st.Cartella != dir {
		t.Fatalf("status: %+v", st)
	}
	if _, err := os.Stat(filepath.Join(dir, "foto-saggio.jpg")); err != nil {
		t.Fatal("a file that is not a copy was removed")
	}
	// the choice survives a restart
	again := OpenMirror(s.Dir(), s)
	if st := again.Status(); st.Cartella != dir || st.Ultima == "" {
		t.Fatalf("after restart: %+v", st)
	}
}

func TestMirrorRefusesBadFoldersAndReportsFailures(t *testing.T) {
	m, s, _ := newMirror(t)
	data := s.Dir()
	for _, bad := range []string{"Copie", data, filepath.Join(data, "copie"), filepath.Join(data, "x", "y")} {
		if err := m.Set(bad); err == nil {
			t.Fatalf("%q accepted", bad)
		}
	}
	if m.Status().Cartella != "" {
		t.Fatal("a refused folder was kept")
	}
	save(t, s, archiveJSON(1, "a"), "x")
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
	save(t, s, archiveJSON(1, "b"), "x")
	err := m.CopyNow()
	st := m.Status()
	if err == nil || st.Errore == "" || st.Ultima == "" {
		t.Fatalf("failure not reported: %v %+v", err, st)
	}
	// back again: the next copy clears the error and catches up
	os.Remove(dir)
	if err := m.CopyNow(); err != nil || m.Status().Errore != "" {
		t.Fatalf("recovery: %v %+v", err, m.Status())
	}
	if got, _ := os.ReadFile(filepath.Join(dir, mirrorLatest, archiveName)); !strings.Contains(string(got), `"b"`) {
		t.Fatal("after the stick came back the newest state was not copied")
	}
	// choosing no folder turns the copies off
	if err := m.Set(""); err != nil || m.Status().Cartella != "" {
		t.Fatalf("turning off: %v", err)
	}
}

func TestMirrorNeverCopiesADamagedArchiveOverAGoodCopy(t *testing.T) {
	m, s, _ := newMirror(t)
	dir := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	save(t, s, archiveJSON(5, "buono"), "x")
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	good, _ := os.ReadFile(filepath.Join(dir, mirrorLatest, archiveName))
	os.WriteFile(filepath.Join(s.Dir(), archiveName), []byte(`{"rev": 3, "db": {"allie`), 0o600) // cut in the middle
	if err := m.CopyNow(); err == nil {
		t.Fatal("a damaged archive was copied without a word")
	}
	if now, _ := os.ReadFile(filepath.Join(dir, mirrorLatest, archiveName)); string(now) != string(good) {
		t.Fatal("the good copy was overwritten by the damaged archive")
	}
}

func TestMirrorKeepsTheSameRetentionAsTheLocalSnapshots(t *testing.T) {
	m, s, clock := newMirror(t)
	dir := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 120; i++ { // 120 days, one save each
		save(t, s, archiveJSON(2, "g"), "x")
		if err := m.CopyNow(); err != nil {
			t.Fatal(err)
		}
		*clock = clock.AddDate(0, 0, 1)
	}
	local, remote := snapshotNames(filepath.Join(s.Dir(), dailyDir)), snapshotNames(filepath.Join(dir, dailyDir))
	if strings.Join(local, ",") != strings.Join(remote, ",") {
		t.Fatalf("local %d snapshots, second folder %d", len(local), len(remote))
	}
	if len(local) < keepDailyDays || len(local) > keepDailyDays+10 {
		t.Fatalf("%d snapshots after 120 days", len(local))
	}
}

func TestMirrorKickAndFlush(t *testing.T) {
	m, s, _ := newMirror(t)
	dir := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(dir); err != nil {
		t.Fatal(err)
	}
	save(t, s, archiveJSON(1, "dopo il salvataggio"), "x")
	m.Kick()
	m.Kick() // a second request while one waits is not an error
	m.Flush()
	deadline := time.Now().Add(2 * time.Second)
	for {
		raw, err := os.ReadFile(filepath.Join(dir, mirrorLatest, archiveName))
		if err == nil && strings.Contains(string(raw), "dopo il salvataggio") {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the copy asked for was not made: %q %v", raw, err)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
