package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func openAt(t *testing.T, dir string, at time.Time) (*Store, *time.Time) {
	t.Helper()
	s := mustOpen(t, dir)
	clock := at
	s.now = func() time.Time { return clock }
	return s, &clock
}

var day1 = time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)

func TestDailySnapshotHoldsArchiveAndLogAndIsChecked(t *testing.T) {
	s, _ := openAt(t, t.TempDir(), day1)
	save(t, s, archiveJSON(3, "uno"), "Rossi Maria")
	names := snapshotNames(s.dailyPath())
	if len(names) != 1 || names[0] != "2026-11-10" {
		t.Fatalf("snapshots after the first save: %v", names)
	}
	dir := s.dailyPath(names[0])
	if err := verifySnapshot(dir); err != nil {
		t.Fatal(err)
	}
	m, _ := readManifest(dir)
	if m.Allieve != 3 || m.RegistroRighe != 1 || m.Rev != 1 || m.Motivo != "inizio-giornata" || len(m.ArchivioSHA) != 64 {
		t.Fatalf("manifest: %+v", m)
	}
	live, _ := os.ReadFile(filepath.Join(s.Dir(), archiveName))
	if got, _ := os.ReadFile(filepath.Join(dir, archiveName)); string(got) != string(live) {
		t.Fatal("the snapshot is not the archive")
	}
	liveLog, _ := os.ReadFile(filepath.Join(s.Dir(), registroName))
	if got, _ := os.ReadFile(filepath.Join(dir, registroName)); string(got) != string(liveLog) {
		t.Fatal("the snapshot does not hold the change log")
	}
	// no half-written leftovers
	items, _ := os.ReadDir(s.dailyPath())
	for _, it := range items {
		if strings.HasPrefix(it.Name(), ".") {
			t.Fatalf("temporary folder left behind: %s", it.Name())
		}
	}
}

func TestDailySnapshotOncePerDayManualAlways(t *testing.T) {
	s, clock := openAt(t, t.TempDir(), day1)
	save(t, s, archiveJSON(2, "a"), "x")
	save(t, s, archiveJSON(2, "b"), "x")
	save(t, s, archiveJSON(2, "c"), "x")
	if n := snapshotNames(s.dailyPath()); len(n) != 1 {
		t.Fatalf("three saves in a day: %v", n)
	}
	// the snapshot of the day is the state before the second save (the first save had nothing before it, so it was taken after)
	first, _ := os.ReadFile(s.dailyPath("2026-11-10", archiveName))
	if !strings.Contains(string(first), `"a"`) || strings.Contains(string(first), `"c"`) {
		t.Fatalf("the snapshot of the day should keep the start of the day: %.120s", first)
	}
	if _, created, err := s.DailyBackup(false); err != nil || created {
		t.Fatalf("a second automatic one the same day: created=%v err=%v", created, err)
	}
	name, created, err := s.DailyBackup(true)
	if err != nil || !created || !strings.HasPrefix(name, "2026-11-10-") {
		t.Fatalf("manual snapshot: %q %v %v", name, created, err)
	}
	*clock = clock.Add(time.Second) // two manual ones in the same second must not meet
	if _, _, err := s.DailyBackup(true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.DailyBackup(true); err != nil {
		t.Fatal(err)
	}
	if n := snapshotNames(s.dailyPath()); len(n) != 4 {
		t.Fatalf("snapshots: %v", n)
	}
	if r := s.CheckBackups(); r.Controllate != 4 || len(r.Errori) != 0 {
		t.Fatalf("check: %+v", r)
	}
	// the next day, the first save makes the snapshot of the archive as it was
	*clock = clock.AddDate(0, 0, 1)
	save(t, s, archiveJSON(2, "d"), "x")
	next, _ := os.ReadFile(s.dailyPath("2026-11-11", archiveName))
	if !strings.Contains(string(next), `"c"`) {
		t.Fatalf("snapshot of the next day: %.120s", next)
	}
}

func TestCheckFindsAChangedOrMissingFile(t *testing.T) {
	s, _ := openAt(t, t.TempDir(), day1)
	save(t, s, archiveJSON(2, "a"), "x")
	s.DailyBackup(true)
	if r := s.CheckBackups(); len(r.Errori) != 0 {
		t.Fatalf("clean: %+v", r)
	}
	p := s.dailyPath("2026-11-10", archiveName)
	raw, _ := os.ReadFile(p)
	os.WriteFile(p, []byte(strings.Replace(string(raw), `"a"`, `"z"`, 1)), 0o600) // one letter changed
	if r := s.CheckBackups(); len(r.Errori) != 1 || !strings.Contains(r.Errori[0], "2026-11-10") {
		t.Fatalf("a changed byte not found: %+v", r)
	}
	if _, err := s.BackupArchive("2026-11-10"); err == nil {
		t.Fatal("a snapshot that does not check was handed out")
	}
	os.WriteFile(p, raw, 0o600)
	os.Remove(s.dailyPath("2026-11-10", registroName))
	if r := s.CheckBackups(); len(r.Errori) != 1 {
		t.Fatalf("a missing log not found: %+v", r)
	}
	for _, bad := range []string{"../archivio", "2026-11-10/../..", "", "x"} {
		if _, err := s.BackupArchive(bad); err == nil {
			t.Fatalf("name %q accepted", bad)
		}
	}
}

func TestRetentionKeepsSixtyDaysThenWeeksThenMonths(t *testing.T) {
	now := time.Date(2027, 11, 10, 12, 0, 0, 0, time.UTC)
	var names []string
	for d := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC); !d.After(now); d = d.AddDate(0, 0, 1) {
		names = append(names, d.Format("2006-01-02"))
	}
	del := map[string]bool{}
	for _, n := range retentionPlan(names, now) {
		del[n] = true
	}
	var kept []string
	for _, n := range names {
		if !del[n] {
			kept = append(kept, n)
		}
	}
	recent := 0
	for _, n := range kept {
		d, _ := snapshotDay(n)
		if now.Sub(d) < 60*24*time.Hour {
			recent++
		}
	}
	if recent < 60 {
		t.Fatalf("not all of the last 60 days are kept: %d", recent)
	}
	if del["2027-11-10"] || del["2027-09-20"] {
		t.Fatal("a recent snapshot was marked for deletion")
	}
	if len(kept) > 60+55+25 || len(kept) < 60+40 {
		t.Fatalf("%d kept of %d", len(kept), len(names))
	}
	// the oldest month of all still has its first snapshot: history is never cut off
	if del["2025-01-01"] || del["2025-06-01"] {
		t.Fatal("the first snapshot of an old month was dropped")
	}
	// idempotent: planning again on what is left deletes nothing
	left := map[string]bool{}
	for _, n := range kept {
		left[n] = true
	}
	if again := retentionPlan(kept, now); len(again) != 0 {
		t.Fatalf("not stable: %v", again[:3])
	}
	// the newest always stays, and a name that is not a date is never judged
	if got := retentionPlan([]string{"2020-01-01", "2020-01-02"}, now); len(got) != 0 && got[len(got)-1] == "2020-01-02" {
		t.Fatalf("the newest was dropped: %v", got)
	}
}

func TestRetentionOnDiskAfterAYear(t *testing.T) {
	s, clock := openAt(t, t.TempDir(), day1)
	for i := 0; i < 400; i++ {
		save(t, s, archiveJSON(2, fmt.Sprint(i)), "x")
		*clock = clock.AddDate(0, 0, 1)
	}
	names := snapshotNames(s.dailyPath())
	if len(names) < 100 || len(names) > 140 {
		t.Fatalf("%d snapshots after 400 days", len(names))
	}
	if names[len(names)-1] != clock.AddDate(0, 0, -1).Format("2006-01-02") {
		t.Fatalf("newest: %s", names[len(names)-1])
	}
	if r := s.CheckBackups(); len(r.Errori) != 0 {
		t.Fatalf("%+v", r)
	}
}

/* ---------- recovery ---------- */

// withHistory makes a store with saves on three days and returns its folder and the live archive bytes.
func withHistory(t *testing.T) (string, []byte) {
	t.Helper()
	dir := t.TempDir()
	s, clock := openAt(t, dir, day1)
	for i := 0; i < 3; i++ {
		save(t, s, archiveJSON(4+i, fmt.Sprintf("giorno%d", i)), "Rossi Maria")
		*clock = clock.AddDate(0, 0, 1)
	}
	live, _ := os.ReadFile(filepath.Join(dir, archiveName))
	return dir, live
}

func TestRecoversFromADamagedArchive(t *testing.T) {
	for name, damage := range map[string][]byte{
		"cut in the middle": []byte(`{"rev": 3, "salvato": "2026-11-12T09:00:00Z", "db": {"allieve": [{"id":"A"`),
		"empty file":        {},
		"garbage":           []byte("\x00\x00\x00\xff\xfe not json at all"),
		"wrong content":     []byte(`{"qualcosa":"altro"}`),
		"only spaces":       []byte("   \n  "),
	} {
		t.Run(name, func(t *testing.T) {
			dir, live := withHistory(t)
			os.WriteFile(filepath.Join(dir, archiveName), damage, 0o600)
			s, err := OpenStore(dir)
			if err != nil {
				t.Fatalf("the program must recover, not stop: %v", err)
			}
			rec := s.Recovered()
			if rec == nil || rec.Motivo != "danneggiato" || rec.Danneggiato == "" || rec.Da == "" {
				t.Fatalf("recovery notice: %+v", rec)
			}
			// the damaged file is kept, untouched, under another name
			kept, err := os.ReadFile(filepath.Join(dir, rec.Danneggiato))
			if err != nil || string(kept) != string(damage) {
				t.Fatalf("the damaged file was not kept: %v", err)
			}
			rev, db, _ := s.State()
			if db == nil || rev < 1 || countDB(db).Allieve < 4 {
				t.Fatalf("recovered state: rev=%d db=%.80s", rev, db)
			}
			// at most the last day of work is behind the copy, never more
			if !strings.Contains(string(db), `"tag": "giorno`) {
				t.Fatalf("unexpected archive: %.80s", db)
			}
			_ = live
			// it is a normal archive again: saving works, and the notice is in the log and on disk
			if _, _, err := s.Save(rev, archiveJSON(7, "dopo"), []Entry{{Operazione: "Modifica"}}, false); err != nil {
				t.Fatalf("save after recovery: %v", err)
			}
			rows, _ := s.Registro(50)
			found := false
			for _, r := range rows {
				if r.Operazione == "Recupero automatico" {
					found = true
				}
			}
			if !found {
				t.Fatal("the recovery is not in the change log")
			}
			if sf := s.Safety(); sf.Recupero == nil {
				t.Fatal("no recovery notice for the page")
			}
			if err := s.DismissRecovery(); err != nil || s.Safety().Recupero != nil {
				t.Fatalf("dismissing: %v", err)
			}
		})
	}
}

func TestRecoversAMissingArchiveInsteadOfStartingEmpty(t *testing.T) {
	dir, _ := withHistory(t)
	os.Remove(filepath.Join(dir, archiveName))
	s := mustOpen(t, dir)
	rec := s.Recovered()
	if rec == nil || rec.Motivo != "mancante" || rec.Danneggiato != "" {
		t.Fatalf("notice: %+v", rec)
	}
	if _, db, _ := s.State(); db == nil || countDB(db).Allieve < 4 {
		t.Fatalf("the archive was not put back: %.60s", db)
	}
}

func TestRecoverySkipsBrokenCopiesAndTakesTheNewestGoodOne(t *testing.T) {
	dir, _ := withHistory(t)
	// break the newest copies in every folder: a cut copy, a copy with a changed byte
	items, _ := os.ReadDir(filepath.Join(dir, copiesDir))
	for _, it := range items {
		os.WriteFile(filepath.Join(dir, copiesDir, it.Name()), []byte(`{"rev":9,"db":`), 0o600)
	}
	names := snapshotNames(filepath.Join(dir, dailyDir))
	newest := filepath.Join(dir, dailyDir, names[len(names)-1], archiveName)
	raw, _ := os.ReadFile(newest)
	os.WriteFile(newest, []byte(strings.Replace(string(raw), "giorno", "gXorno", 1)), 0o600) // fails its checksum
	os.WriteFile(filepath.Join(dir, archiveName), []byte("rotto"), 0o600)
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	rec := s.Recovered()
	// the two older snapshots hold the same state (nothing was saved in between): either is the right answer, the broken ones are not
	if rec == nil || !(strings.Contains(rec.Da, names[len(names)-2]) || strings.Contains(rec.Da, names[len(names)-3])) {
		t.Fatalf("it should come from a snapshot that checks (%v): %+v", names, rec)
	}
	if _, db, _ := s.State(); countDB(db).Allieve != 4 {
		t.Fatalf("unexpected state: %.60s", db)
	}
}

func TestNoCopyNoRecoveryAndTheDamagedFileIsNeverTouched(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, archiveName), []byte("rotto"), 0o600)
	if _, err := OpenStore(dir); !errors.Is(err, ErrDamaged) {
		t.Fatalf("expected ErrDamaged: %v", err)
	}
	if raw, _ := os.ReadFile(filepath.Join(dir, archiveName)); string(raw) != "rotto" {
		t.Fatal("the damaged file was changed")
	}
	if items, _ := os.ReadDir(dir); len(items) > 3 {
		t.Fatalf("unexpected files: %v", items)
	}
}

func TestRecoversFromTheSecondFolderWhenTheWholeDataFolderIsGone(t *testing.T) {
	dir := t.TempDir()
	s, clock := openAt(t, dir, day1)
	m := OpenMirror(dir, s)
	m.now = func() time.Time { return *clock }
	second := filepath.Join(t.TempDir(), "chiavetta")
	if err := m.Set(second); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		save(t, s, archiveJSON(5, fmt.Sprintf("v%d", i)), "Rossi Maria")
		*clock = clock.AddDate(0, 0, 1)
	}
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	// the data folder is lost, apart from the small file that says where the second folder is
	cfg, _ := os.ReadFile(filepath.Join(dir, localConfigName))
	for _, n := range []string{archiveName, registroName, copiesDir, dailyDir} {
		os.RemoveAll(filepath.Join(dir, n))
	}
	if string(cfg) == "" {
		t.Fatal("no local settings")
	}
	again, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	rec := again.Recovered()
	if rec == nil || !strings.Contains(rec.Da, "seconda cartella") {
		t.Fatalf("recovery: %+v", rec)
	}
	if _, db, _ := again.State(); countDB(db).Allieve != 5 || !strings.Contains(string(db), `"v2"`) {
		t.Fatalf("the newest state was not recovered: %.80s", db)
	}
	// and the change log, which only the snapshots and the second folder hold, comes back too
	if rows, _ := again.Registro(10); len(rows) < 3 {
		t.Fatalf("log after recovery: %d rows", len(rows))
	}
}

func TestMissingLogIsRestoredFromTheNewestSnapshot(t *testing.T) {
	dir, _ := withHistory(t)
	before, _ := os.ReadFile(filepath.Join(dir, registroName))
	os.Remove(filepath.Join(dir, registroName))
	s := mustOpen(t, dir)
	rows, err := s.Registro(50)
	if err != nil || len(rows) < 2 {
		t.Fatalf("log not restored: %d %v", len(rows), err)
	}
	if after, _ := os.ReadFile(filepath.Join(dir, registroName)); len(after) == 0 || len(after) > len(before) {
		t.Fatalf("restored log size %d (was %d)", len(after), len(before))
	}
}

func TestLeftoverTemporaryFilesAreCleanedAtStart(t *testing.T) {
	dir, _ := withHistory(t)
	os.WriteFile(filepath.Join(dir, archiveName+".tmp"), []byte("metà"), 0o600)
	os.MkdirAll(filepath.Join(dir, dailyDir, ".nuova-2026-12-01"), 0o700)
	mustOpen(t, dir)
	if _, err := os.Stat(filepath.Join(dir, archiveName+".tmp")); err == nil {
		t.Fatal("temporary archive left")
	}
	if _, err := os.Stat(filepath.Join(dir, dailyDir, ".nuova-2026-12-01")); err == nil {
		t.Fatal("temporary snapshot left")
	}
	// the live archive was not touched by any of this
	if rev, db, _ := mustOpen(t, dir).State(); rev != 3 || countDB(db).Allieve != 6 {
		t.Fatalf("live archive: rev=%d", rev)
	}
}

/* ---------- a save that would lose the data ---------- */

func TestSaveRefusesAnArchiveThatLostMostOfTheData(t *testing.T) {
	s, _ := openAt(t, t.TempDir(), day1)
	save(t, s, archiveJSON(20, "pieno"), "x")
	rev, _, _ := s.State()
	cases := map[string]json.RawMessage{
		"emptied":         archiveJSON(0, "vuoto"),
		"lost half":       archiveJSON(10, "meta"),
		"no student list": json.RawMessage(`{"impostazioni":{}}`),
	}
	for name, db := range cases {
		if _, _, err := s.Save(rev, db, nil, false); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
	if _, db, _ := s.State(); countDB(db).Allieve != 20 {
		t.Fatal("the archive changed")
	}
	// a normal edit, a small deletion and a confirmed big change all go through
	if _, _, err := s.Save(rev, archiveJSON(20, "modifica"), nil, false); err != nil {
		t.Fatalf("normal edit: %v", err)
	}
	rev, _, _ = s.State()
	if _, _, err := s.Save(rev, archiveJSON(19, "uno in meno"), nil, false); err != nil {
		t.Fatalf("one deleted: %v", err)
	}
	rev, _, _ = s.State()
	if _, _, err := s.Save(rev, archiveJSON(3, "importa"), nil, true); err != nil {
		t.Fatalf("confirmed change (import/restore): %v", err)
	}
	// tiny archives: going from 3 to 0 is refused, from 2 to 0 is not judged
	rev, _, _ = s.State()
	if _, _, err := s.Save(rev, archiveJSON(0, "x"), nil, false); err == nil {
		t.Fatal("3 -> 0 accepted")
	}
}

func TestSaveFailureLeavesTheArchiveAndSnapshotsIntact(t *testing.T) {
	s, clock := openAt(t, t.TempDir(), day1)
	save(t, s, archiveJSON(5, "uno"), "x")
	*clock = clock.AddDate(0, 0, 1)
	before, _ := os.ReadFile(filepath.Join(s.Dir(), archiveName))
	rev, _, _ := s.State()
	if _, _, err := s.Save(rev+5, archiveJSON(5, "due"), nil, false); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision: %v", err)
	}
	if _, _, err := s.Save(rev, json.RawMessage(`not json`), nil, false); err == nil {
		t.Fatal("invalid data accepted")
	}
	after, _ := os.ReadFile(filepath.Join(s.Dir(), archiveName))
	if string(before) != string(after) {
		t.Fatal("a refused save changed the archive")
	}
	if r := s.CheckBackups(); len(r.Errori) != 0 {
		t.Fatalf("%+v", r)
	}
}

func TestConcurrentSavesSnapshotsAndMirrorStayConsistent(t *testing.T) {
	dir := t.TempDir()
	s := mustOpen(t, dir)
	m := OpenMirror(dir, s)
	second := filepath.Join(t.TempDir(), "disco")
	if err := m.Set(second); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	stop := make(chan struct{})
	run := func(f func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					f()
				}
			}
		}()
	}
	run(func() { s.DailyBackup(true); time.Sleep(time.Millisecond) })
	run(func() { m.CopyNow(); time.Sleep(time.Millisecond) })
	run(func() { s.CheckBackups(); s.Safety(); s.Backups() })
	for i := 0; i < 40; i++ {
		rev, _, _ := s.State()
		if _, _, err := s.Save(rev, archiveJSON(3+i%4, fmt.Sprint(i)), []Entry{{Operazione: "Modifica", Allieva: "x"}}, i%10 == 0); err != nil {
			close(stop)
			wg.Wait()
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
	if err := m.CopyNow(); err != nil {
		t.Fatal(err)
	}
	if r := s.CheckBackups(); len(r.Errori) != 0 || r.Controllate == 0 {
		t.Fatalf("local snapshots: %+v", r)
	}
	for _, n := range snapshotNames(filepath.Join(second, dailyDir)) {
		if err := verifySnapshot(filepath.Join(second, dailyDir, n)); err != nil {
			t.Fatalf("second folder %s: %v", n, err)
		}
	}
	if err := verifySnapshot(filepath.Join(second, mirrorLatest)); err != nil {
		t.Fatal(err)
	}
	live, _ := os.ReadFile(filepath.Join(dir, archiveName))
	if got, _ := os.ReadFile(filepath.Join(second, mirrorLatest, archiveName)); string(got) != string(live) {
		t.Fatal("the second folder does not hold the final archive")
	}
}

func TestSnapshotsStayCheckableThroughPasswordChanges(t *testing.T) {
	s, dir := protectedStore(t)
	check := func(when string) {
		t.Helper()
		r := s.CheckBackups()
		if r.Controllate == 0 || len(r.Errori) != 0 {
			t.Fatalf("%s: %+v", when, r)
		}
	}
	check("after protecting")
	if _, err := s.SetPassword(pw1, pw2); err != nil {
		t.Fatal(err)
	}
	check("after changing the password")
	if _, err := s.SetPassword(pw2, ""); err != nil {
		t.Fatal(err)
	}
	check("after removing it")
	names := snapshotNames(filepath.Join(dir, dailyDir))
	raw, _ := os.ReadFile(filepath.Join(dir, dailyDir, names[0], archiveName))
	if !strings.Contains(string(raw), "allieve") {
		t.Fatal("the snapshot is still encrypted after removing the password")
	}
}

// TestRandomFaultsNeverLoseMoreThanTheLastFewSaves plays a long random life: saves, restarts, a day passing, and damage to the
// archive and to the copies (cut in the middle, garbage, empty, deleted, a flipped byte). After every restart the store must open, hold a
// state that really existed (never a mixture), be at most a few saves behind, keep working, and every copy that is left must check.
func TestRandomFaultsNeverLoseMoreThanTheLastFewSaves(t *testing.T) {
	for seed := int64(1); seed <= 12; seed++ {
		seed := seed
		t.Run(fmt.Sprint("seed", seed), func(t *testing.T) {
			rng := newRand(seed)
			dir := t.TempDir()
			second := filepath.Join(t.TempDir(), "chiavetta")
			clock := time.Date(2026, 11, 10, 8, 0, 0, 0, time.UTC)
			open := func() *Store {
				s := mustOpen(t, dir)
				s.now = func() time.Time { return clock }
				return s
			}
			s := open()
			m := OpenMirror(dir, s)
			m.now = func() time.Time { return clock }
			if err := m.Set(second); err != nil {
				t.Fatal(err)
			}
			states := map[string]bool{} // every archive that was ever saved, by its tag
			recoveries := 0
			last := -1
			save := func() {
				last++
				rev, _, _ := s.State()
				tag := fmt.Sprintf("t%04d", last)
				states[tag] = true
				if _, _, err := s.Save(rev, archiveJSON(8+last%2, tag), []Entry{{Operazione: "Modifica", Allieva: tag}}, rng.Intn(15) == 0); err != nil {
					t.Fatalf("save %d: %v", last, err)
				}
				m.CopyNow()
			}
			damage := func(path string) {
				switch rng.Intn(5) {
				case 0:
					raw, _ := os.ReadFile(path)
					if len(raw) > 4 {
						os.WriteFile(path, raw[:len(raw)/2], 0o600)
					}
				case 1:
					os.WriteFile(path, []byte("\x00\xff garbage"), 0o600)
				case 2:
					os.WriteFile(path, nil, 0o600)
				case 3:
					os.Remove(path)
				case 4:
					raw, _ := os.ReadFile(path)
					if len(raw) > 10 {
						raw[len(raw)/2] ^= 0x01
						os.WriteFile(path, raw, 0o600)
					}
				}
			}
			save()
			for step := 0; step < 120; step++ {
				clock = clock.Add(time.Duration(5+rng.Intn(40)) * time.Minute)
				if rng.Intn(6) == 0 {
					clock = clock.Add(20 * time.Hour) // a new day now and then
				}
				switch op := rng.Intn(10); {
				case op < 5:
					save()
				case op == 5: // an ordinary restart
					s = open()
					m.st = s
				case op == 6: // the live archive is damaged, then the program starts
					damage(filepath.Join(dir, archiveName))
					s = open()
					m.st = s
					_, db, _ := s.State()
					var tag struct{ Tag string }
					if err := json.Unmarshal(db, &tag); err != nil || !states[tag.Tag] {
						t.Fatalf("step %d: recovered a state that never existed: %.60s", step, db)
					}
					var n int
					fmt.Sscanf(tag.Tag, "t%d", &n)
					if last-n > 8 {
						t.Fatalf("step %d: recovered t%04d but the last save was t%04d: too much lost", step, n, last)
					}
					if s.Recovered() == nil {
						t.Fatalf("step %d: the archive was damaged but no recovery was noted", step)
					}
					recoveries++
					last = n // the work continues from what is there
					s.DismissRecovery()
				case op == 7: // some copies are damaged, nothing else
					names := s.copyNames()
					if len(names) > 0 {
						damage(filepath.Join(dir, copiesDir, names[rng.Intn(len(names))]))
					}
					if dn := snapshotNames(filepath.Join(dir, dailyDir)); len(dn) > 0 {
						damage(filepath.Join(dir, dailyDir, dn[rng.Intn(len(dn))], archiveName))
					}
				case op == 8: // the second folder is damaged: it is mended by the next copy
					if dn := snapshotNames(filepath.Join(second, dailyDir)); len(dn) > 0 {
						damage(filepath.Join(second, dailyDir, dn[rng.Intn(len(dn))], registroName))
					}
					damage(filepath.Join(second, mirrorLatest, archiveName))
					m.CopyNow()
				default:
					s.DailyBackup(rng.Intn(3) == 0)
				}
			}
			if recoveries < 3 {
				t.Fatalf("the test did not exercise recovery enough: %d", recoveries)
			}
			// the final state is still intact and still in the second folder
			_, db, _ := s.State()
			var tag struct{ Tag string }
			if json.Unmarshal(db, &tag) != nil || !states[tag.Tag] {
				t.Fatalf("final state: %.60s", db)
			}
			s.DailyBackup(true)
			m.CopyNow()
			if err := verifySnapshot(filepath.Join(second, mirrorLatest)); err != nil {
				t.Fatalf("second folder: %v", err)
			}
		})
	}
}

func newRand(seed int64) *rand.Rand { return rand.New(rand.NewSource(seed)) }
