package main

// Safety of the data: daily snapshots of the archive AND of the change log, checked after writing,
// kept for a long time, and used to recover on their own when the archive file is damaged or gone.
//
// Layers, from the newest to the oldest:
//   - archivio.json            the live archive (written atomically, read back after every save)
//   - copie/                   a copy before a save when the last one is older than 30 minutes (last 100)
//   - giornaliere/<day>/       a snapshot at the start of every day (archive + log + manifest with checksums)
//   - second folder            the same files on another disk, a USB stick or a synchronised folder
// Nothing here ever deletes or overwrites the live files except the recovery, which first sets the
// damaged file aside under another name.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	dailyDir        = "giornaliere"
	manifestName    = "MANIFEST.json"
	recoveryNotice  = "recupero.json"
	keepDailyDays   = 60  // every snapshot of the last 60 days
	keepWeeklyDays  = 364 // then one per week for a year
	damagedSuffix   = ".danneggiato-"
	mirrorLatest    = "ultima" // in the second folder: the newest state
	manifestVersion = 1
)

// ErrDamaged means the archive file exists but cannot be read as an archive.
var ErrDamaged = errors.New("archivio danneggiato")

// ErrShrink means the archive offered is much smaller than the one on disk: it is refused unless the person confirmed.
var ErrShrink = errors.New("il nuovo archivio ha molti meno dati di quello attuale")

var backupName = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}(-\d{6})?$`)

// Manifest describes one snapshot and lets it be checked later without the program that made it.
type Manifest struct {
	Nome          string `json:"nome"`
	Creato        string `json:"creato"` // RFC 3339
	Motivo        string `json:"motivo"` // inizio-giornata | manuale
	Rev           int64  `json:"rev"`
	ArchivioSHA   string `json:"archivioSha256"`
	ArchivioByte  int64  `json:"archivioByte"`
	RegistroSHA   string `json:"registroSha256"`
	RegistroByte  int64  `json:"registroByte"`
	RegistroRighe int    `json:"registroRighe"`
	Allieve       int    `json:"numAllieve"` // -1: not readable (the archive is encrypted)
	Iscrizioni    int    `json:"numIscrizioni"`
	Pagamenti     int    `json:"numPagamenti"`
	Versione      int    `json:"versione"`
}

// BackupInfo is what the page lists for a snapshot.
type BackupInfo struct {
	Nome          string `json:"nome"`
	Creato        string `json:"creato"`
	Motivo        string `json:"motivo"`
	Allieve       int    `json:"allieve"`
	Iscrizioni    int    `json:"iscrizioni"`
	Pagamenti     int    `json:"pagamenti"`
	RegistroRighe int    `json:"registroRighe"`
	Byte          int64  `json:"byte"`
}

// Recovery says that the archive was damaged or missing and was put back from a copy.
type Recovery struct {
	Quando      string `json:"quando"`
	Da          string `json:"da"`          // where the copy came from
	Salvato     string `json:"salvato"`     // when that copy had been saved
	Danneggiato string `json:"danneggiato"` // the set-aside file, if there was one
	Motivo      string `json:"motivo"`      // danneggiato | mancante
}

// Safety is the summary of the safety copies.
type Safety struct {
	Giornaliere   int       `json:"giornaliere"`
	Ultima        string    `json:"ultima"` // creation time of the newest snapshot
	UltimaGiorno  string    `json:"ultimaGiorno"`
	Prima         string    `json:"prima"`   // oldest snapshot day
	Recenti       int       `json:"recenti"` // files in copie/
	RegistroRighe int       `json:"registroRighe"`
	RegistroByte  int64     `json:"registroByte"`
	Errore        string    `json:"errore"` // why the last snapshot failed, if it did
	Recupero      *Recovery `json:"recupero"`
}

func sha(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func (s *Store) dailyPath(parts ...string) string {
	return filepath.Join(append([]string{s.dir, dailyDir}, parts...)...)
}

type counts struct{ Allieve, Iscrizioni, Pagamenti int }

// countRecords reads how many students, enrollments and payments an archive file holds; ok is false for an encrypted file.
func countRecords(raw []byte) (c counts, rev int64, saved string, ok bool) {
	if _, sealed := parseSealed(raw); sealed {
		return counts{-1, -1, -1}, 0, "", false
	}
	var env envelope
	if json.Unmarshal(raw, &env) != nil || !isObject(env.DB) {
		return counts{-1, -1, -1}, 0, "", false
	}
	return countDB(env.DB), env.Rev, env.Salvato, true
}

func countDB(db json.RawMessage) counts {
	var d struct {
		Allieve    []json.RawMessage `json:"allieve"`
		Iscrizioni []json.RawMessage `json:"iscrizioni"`
		Pagamenti  []json.RawMessage `json:"pagamenti"`
	}
	json.Unmarshal(db, &d)
	return counts{len(d.Allieve), len(d.Iscrizioni), len(d.Pagamenti)}
}

func countLines(b []byte) int {
	n := 0
	for _, l := range bytes.Split(b, []byte("\n")) {
		if len(bytes.TrimSpace(l)) > 0 {
			n++
		}
	}
	return n
}

/* ---------- writing a snapshot ---------- */

// DailyBackup writes a snapshot of the archive and the log if there is none for today (or always, when manual).
// created is false when today's one already existed. A snapshot is checked by reading it back before it counts.
func (s *Store) DailyBackup(manual bool) (name string, created bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dailyLocked(manual)
}

func (s *Store) dailyLocked(manual bool) (string, bool, error) {
	arch, err := os.ReadFile(s.path(archiveName))
	if errors.Is(err, os.ErrNotExist) {
		return "", false, nil // nothing to save yet
	}
	if err != nil {
		return "", false, s.noteDailyError(fmt.Errorf("non riesco a leggere l'archivio: %w", err))
	}
	if _, sealed := parseSealed(arch); !sealed {
		var env envelope
		if json.Unmarshal(arch, &env) != nil || !isObject(env.DB) {
			return "", false, s.noteDailyError(s.damaged()) // a damaged archive never replaces a good snapshot
		}
	}
	reg, err := os.ReadFile(s.path(registroName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", false, s.noteDailyError(fmt.Errorf("non riesco a leggere il registro: %w", err))
	}
	now := s.now()
	day := now.Format("2006-01-02")
	name := day
	if manual {
		name = day + "-" + now.Format("150405")
	}
	if !manual {
		if _, err := os.Stat(s.dailyPath(name, manifestName)); err == nil {
			s.lastDaily = day
			return name, false, nil
		}
	}
	for i := 2; ; i++ { // two manual snapshots in the same second must not meet
		if _, err := os.Stat(s.dailyPath(name)); err != nil {
			break
		}
		name = fmt.Sprintf("%s-%d", day+"-"+now.Format("150405"), i)
		if !backupName.MatchString(name) {
			name = fmt.Sprintf("%s-%06d", day, i)
		}
	}
	c, rev, _, _ := countRecords(arch)
	m := Manifest{Nome: name, Creato: now.Format(time.RFC3339), Motivo: "inizio-giornata", Rev: rev,
		ArchivioSHA: sha(arch), ArchivioByte: int64(len(arch)), RegistroSHA: sha(reg), RegistroByte: int64(len(reg)), RegistroRighe: countLines(reg),
		Allieve: c.Allieve, Iscrizioni: c.Iscrizioni, Pagamenti: c.Pagamenti, Versione: manifestVersion}
	if manual {
		m.Motivo = "manuale"
	}
	if err := writeSnapshot(s.dailyPath(), name, arch, reg, m); err != nil {
		return "", false, s.noteDailyError(err)
	}
	s.lastDaily = day
	s.dailyErr = ""
	s.pruneDaily()
	logInfo("copie", "copia giornaliera %s fatta e riletta (%s)", name, m.Motivo)
	return name, true, nil
}

func (s *Store) noteDailyError(err error) error {
	s.dailyErr = err.Error()
	logAvviso("copie", "copia giornaliera non riuscita: %v", err)
	return err
}

// writeSnapshot writes the three files into a temporary folder, reads them back, and only then gives the folder its name.
func writeSnapshot(root, name string, arch, reg []byte, m Manifest) error {
	if err := os.MkdirAll(root, 0o700); err != nil {
		return fmt.Errorf("non riesco a creare la cartella delle copie giornaliere: %w", err)
	}
	tmp := filepath.Join(root, ".nuova-"+name)
	os.RemoveAll(tmp)
	if err := os.MkdirAll(tmp, 0o700); err != nil {
		return err
	}
	fail := func(err error) error { os.RemoveAll(tmp); return err }
	if err := writeAtomic(filepath.Join(tmp, archiveName), arch); err != nil {
		return fail(fmt.Errorf("non riesco a scrivere la copia dell'archivio: %w", err))
	}
	if err := writeAtomic(filepath.Join(tmp, registroName), reg); err != nil {
		return fail(fmt.Errorf("non riesco a scrivere la copia del registro: %w", err))
	}
	raw, err := json.MarshalIndent(m, "", " ")
	if err != nil {
		return fail(err)
	}
	if err := writeAtomic(filepath.Join(tmp, manifestName), raw); err != nil {
		return fail(err)
	}
	if err := verifySnapshot(tmp); err != nil {
		return fail(fmt.Errorf("la copia appena scritta non risulta uguale all'originale: %w", err))
	}
	if err := os.Rename(tmp, filepath.Join(root, name)); err != nil {
		return fail(err)
	}
	return nil
}

// verifySnapshot reads a snapshot folder back and compares it with its manifest.
func verifySnapshot(dir string) error {
	raw, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return fmt.Errorf("manca il file di controllo: %w", err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return errors.New("il file di controllo è illeggibile")
	}
	arch, err := os.ReadFile(filepath.Join(dir, archiveName))
	if err != nil {
		return fmt.Errorf("manca la copia dell'archivio: %w", err)
	}
	if int64(len(arch)) != m.ArchivioByte || sha(arch) != m.ArchivioSHA {
		return errors.New("la copia dell'archivio è diversa da quando è stata fatta")
	}
	if _, sealed := parseSealed(arch); !sealed {
		var env envelope
		if json.Unmarshal(arch, &env) != nil || !isObject(env.DB) {
			return errors.New("la copia dell'archivio non si legge")
		}
	}
	reg, err := os.ReadFile(filepath.Join(dir, registroName))
	if err != nil {
		return fmt.Errorf("manca la copia del registro: %w", err)
	}
	if int64(len(reg)) != m.RegistroByte || sha(reg) != m.RegistroSHA {
		return errors.New("la copia del registro è diversa da quando è stata fatta")
	}
	return nil
}

/* ---------- reading the snapshots ---------- */

func readManifest(dir string) (Manifest, error) {
	var m Manifest
	raw, err := os.ReadFile(filepath.Join(dir, manifestName))
	if err != nil {
		return m, err
	}
	return m, json.Unmarshal(raw, &m)
}

// snapshotNames returns the snapshot folders of a root, oldest first.
func snapshotNames(root string) []string {
	items, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var names []string
	for _, it := range items {
		if it.IsDir() && backupName.MatchString(it.Name()) {
			names = append(names, it.Name())
		}
	}
	sort.Strings(names)
	return names
}

// Backups lists the daily snapshots, newest first.
func (s *Store) Backups() []BackupInfo {
	names := snapshotNames(s.dailyPath())
	out := make([]BackupInfo, 0, len(names))
	for i := len(names) - 1; i >= 0; i-- {
		m, err := readManifest(s.dailyPath(names[i]))
		if err != nil {
			continue
		}
		out = append(out, BackupInfo{Nome: names[i], Creato: m.Creato, Motivo: m.Motivo, Allieve: m.Allieve, Iscrizioni: m.Iscrizioni, Pagamenti: m.Pagamenti, RegistroRighe: m.RegistroRighe, Byte: m.ArchivioByte + m.RegistroByte})
	}
	return out
}

// BackupArchive returns the archive file of a snapshot after checking the snapshot.
func (s *Store) BackupArchive(name string) ([]byte, error) {
	if !backupName.MatchString(name) {
		return nil, errors.New("copia non valida")
	}
	if err := verifySnapshot(s.dailyPath(name)); err != nil {
		return nil, err
	}
	return os.ReadFile(s.dailyPath(name, archiveName))
}

// CheckResult is the outcome of checking every copy.
type CheckResult struct {
	Controllate int      `json:"controllate"`
	Errori      []string `json:"errori"`
}

// CheckBackups reads every daily snapshot back and compares it with its manifest.
func (s *Store) CheckBackups() CheckResult {
	var r CheckResult
	r.Errori = []string{}
	for _, n := range snapshotNames(s.dailyPath()) {
		r.Controllate++
		if err := verifySnapshot(s.dailyPath(n)); err != nil {
			r.Errori = append(r.Errori, n+": "+err.Error())
		}
	}
	return r
}

// Safety summarises the copies.
func (s *Store) Safety() Safety {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Safety{Recenti: len(s.copyNames()), Errore: s.dailyErr}
	names := snapshotNames(s.dailyPath())
	out.Giornaliere = len(names)
	if len(names) > 0 {
		out.Prima = names[0][:10]
		out.UltimaGiorno = names[len(names)-1][:10]
		if m, err := readManifest(s.dailyPath(names[len(names)-1])); err == nil {
			out.Ultima = m.Creato
		}
	}
	if fi, err := os.Stat(s.path(registroName)); err == nil {
		out.RegistroByte = fi.Size()
		if s.logCount.size != fi.Size() || !s.logCount.mod.Equal(fi.ModTime()) { // the log can be long: it is counted again only when it changed
			if reg, err := os.ReadFile(s.path(registroName)); err == nil {
				s.logCount.size, s.logCount.mod, s.logCount.n = fi.Size(), fi.ModTime(), countLines(reg)
			}
		}
		out.RegistroRighe = s.logCount.n
	}
	if raw, err := os.ReadFile(s.path(recoveryNotice)); err == nil {
		var r Recovery
		if json.Unmarshal(raw, &r) == nil {
			out.Recupero = &r
		}
	}
	return out
}

// DismissRecovery removes the notice about an automatic recovery once the person has read it.
func (s *Store) DismissRecovery() error {
	err := os.Remove(s.path(recoveryNotice))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

/* ---------- how long snapshots are kept ---------- */

func snapshotDay(name string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02", name[:10])
	return t, err == nil
}

// retentionPlan says which snapshots to delete: all the ones of the last 60 days stay; older ones stay one per week
// (the earliest of the week) up to a year; older still, one per month (the earliest of the month). The newest always stays.
func retentionPlan(names []string, now time.Time) []string {
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	keep := map[string]bool{}
	seenWeek, seenMonth := map[string]bool{}, map[string]bool{}
	for _, n := range sorted {
		d, ok := snapshotDay(n)
		if !ok {
			keep[n] = true // not ours to judge
			continue
		}
		age := int(today.Sub(d).Hours() / 24)
		switch {
		case age < keepDailyDays:
			keep[n] = true
		case age < keepWeeklyDays:
			y, w := d.ISOWeek()
			k := fmt.Sprintf("%d-%02d", y, w)
			if !seenWeek[k] {
				seenWeek[k], keep[n] = true, true
			}
		default:
			k := d.Format("2006-01")
			if !seenMonth[k] {
				seenMonth[k], keep[n] = true, true
			}
		}
	}
	if len(sorted) > 0 {
		keep[sorted[len(sorted)-1]] = true
	}
	var del []string
	for _, n := range sorted {
		if !keep[n] {
			del = append(del, n)
		}
	}
	return del
}

func (s *Store) pruneDaily() {
	names := snapshotNames(s.dailyPath())
	for _, n := range retentionPlan(names, s.now()) {
		os.RemoveAll(s.dailyPath(n))
	}
}

/* ---------- recovery ---------- */

type candidate struct {
	path    string
	salvato time.Time
	rev     int64
	source  string
}

// readCandidate accepts a file only if it is an archive that reads and, for a snapshot, matches its manifest.
func readCandidate(path, source string, manifest bool) (candidate, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return candidate{}, false
	}
	if _, sealed := parseSealed(raw); sealed {
		return candidate{}, false // an encrypted copy cannot be judged without the password
	}
	var env envelope
	if json.Unmarshal(raw, &env) != nil || !isObject(env.DB) {
		return candidate{}, false
	}
	if manifest {
		if err := verifySnapshot(filepath.Dir(path)); err != nil {
			return candidate{}, false
		}
	}
	t, _ := time.Parse(time.RFC3339, env.Salvato)
	return candidate{path: path, salvato: t, rev: env.Rev, source: source}, true
}

// mirrorBase returns the second folder chosen on this computer ("" if none), read from the local settings.
func mirrorBase(dir string) string {
	raw, err := os.ReadFile(filepath.Join(dir, localConfigName))
	if err != nil {
		return ""
	}
	var cfg struct {
		Cartella string `json:"cartellaCopie"`
	}
	if json.Unmarshal(raw, &cfg) != nil {
		return ""
	}
	return cfg.Cartella
}

// candidates collects every archive copy that can be trusted, newest first, in this folder and in the second one.
func candidates(dir, mirror string) []candidate {
	var out []candidate
	if items, err := os.ReadDir(filepath.Join(dir, copiesDir)); err == nil {
		for _, it := range items {
			if !it.IsDir() && strings.HasPrefix(it.Name(), "archivio-") && strings.HasSuffix(it.Name(), ".json") {
				if c, ok := readCandidate(filepath.Join(dir, copiesDir, it.Name()), "copia "+it.Name(), false); ok {
					out = append(out, c)
				}
			}
		}
	}
	roots := []string{filepath.Join(dir, dailyDir)}
	if mirror != "" {
		roots = append(roots, filepath.Join(mirror, dailyDir))
		if c, ok := readCandidate(filepath.Join(mirror, mirrorLatest, archiveName), "seconda cartella, ultima copia", true); ok {
			out = append(out, c)
		}
	}
	for i, root := range roots {
		for _, n := range snapshotNames(root) {
			label := "copia giornaliera " + n
			if i > 0 {
				label = "seconda cartella, copia giornaliera " + n
			}
			if c, ok := readCandidate(filepath.Join(root, n, archiveName), label, true); ok {
				out = append(out, c)
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if !out[i].salvato.Equal(out[j].salvato) {
			return out[i].salvato.After(out[j].salvato)
		}
		return out[i].rev > out[j].rev
	})
	return out
}

// recover puts the newest trustworthy copy in place of a damaged or missing archive. The damaged file is kept under another name.
// It returns false when there was nothing to recover from.
func (s *Store) recoverArchive(reason, mirror string) (bool, error) {
	cands := candidates(s.dir, mirror)
	if len(cands) == 0 {
		return false, nil
	}
	best := cands[0]
	raw, err := os.ReadFile(best.path)
	if err != nil {
		return false, err
	}
	rec := Recovery{Quando: s.now().Format(time.RFC3339), Da: best.source, Salvato: best.salvato.Format(time.RFC3339), Motivo: reason}
	if reason == "danneggiato" {
		aside := archiveName + damagedSuffix + s.now().Format("20060102-150405")
		if err := os.Rename(s.path(archiveName), s.path(aside)); err != nil {
			return false, fmt.Errorf("non riesco a mettere da parte l'archivio danneggiato: %w", err)
		}
		rec.Danneggiato = aside
	}
	if err := writeAtomic(s.path(archiveName), raw); err != nil {
		return false, fmt.Errorf("non riesco a rimettere l'archivio da una copia: %w", err)
	}
	if note, err := json.MarshalIndent(rec, "", " "); err == nil {
		writeAtomic(s.path(recoveryNotice), note)
	}
	s.recovered = &rec
	return true, nil
}

// restoreMissingLog puts the log back from the newest snapshot when the file is gone.
func (s *Store) restoreMissingLog(mirror string) {
	if _, err := os.Stat(s.path(registroName)); err == nil || !errors.Is(err, os.ErrNotExist) {
		return
	}
	var dirs []string
	for _, n := range snapshotNames(filepath.Join(s.dir, dailyDir)) {
		dirs = append(dirs, filepath.Join(s.dir, dailyDir, n))
	}
	if mirror != "" {
		for _, n := range snapshotNames(filepath.Join(mirror, dailyDir)) {
			dirs = append(dirs, filepath.Join(mirror, dailyDir, n))
		}
		dirs = append(dirs, filepath.Join(mirror, mirrorLatest))
	}
	var best, bestTime string
	for _, d := range dirs {
		if verifySnapshot(d) != nil {
			continue
		}
		m, err := readManifest(d)
		if err != nil || m.RegistroByte == 0 {
			continue
		}
		if m.Creato > bestTime {
			best, bestTime = filepath.Join(d, registroName), m.Creato
		}
	}
	if best == "" {
		return
	}
	if raw, err := os.ReadFile(best); err == nil {
		writeAtomic(s.path(registroName), raw)
	}
}

/* ---------- a save that would lose most of the data ---------- */

// guardShrink refuses an archive that has far fewer records than the one on disk, unless the person confirmed an operation
// that removes records (import, restore, deletion): a bug or a wrong file must never be able to empty the archive.
func guardShrink(cur, next json.RawMessage, confirmed bool) error {
	if confirmed || cur == nil {
		return nil
	}
	a, b := countDB(cur), countDB(next)
	var d struct {
		Allieve *json.RawMessage `json:"allieve"`
	}
	json.Unmarshal(next, &d)
	if a.Allieve > 0 && d.Allieve == nil {
		return fmt.Errorf("%w: manca l'elenco delle allieve", ErrShrink)
	}
	for _, p := range []struct {
		nome  string
		prima int
		dopo  int
	}{{"allieve", a.Allieve, b.Allieve}, {"iscrizioni", a.Iscrizioni, b.Iscrizioni}, {"pagamenti", a.Pagamenti, b.Pagamenti}} {
		if p.prima >= 10 && p.dopo*10 < p.prima*7 { // lost more than 30 %
			return fmt.Errorf("%w: %s da %d a %d", ErrShrink, p.nome, p.prima, p.dopo)
		}
		if p.prima > 0 && p.dopo == 0 && p.prima >= 3 {
			return fmt.Errorf("%w: %s da %d a 0", ErrShrink, p.nome, p.prima)
		}
	}
	return nil
}

// liveFiles reads the archive and the log as they are on disk, together, under the store lock. ok is false when there is no archive yet.
// A file that is not an archive is an error: a damaged archive must never be copied over a good copy.
func (s *Store) liveFiles() (arch, reg []byte, m Manifest, ok bool, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	arch, err = os.ReadFile(s.path(archiveName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, m, false, nil
	}
	if err != nil {
		return nil, nil, m, false, err
	}
	if _, sealed := parseSealed(arch); !sealed {
		var env envelope
		if json.Unmarshal(arch, &env) != nil || !isObject(env.DB) {
			return nil, nil, m, false, s.damaged()
		}
	}
	reg, err = os.ReadFile(s.path(registroName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, nil, m, false, err
	}
	c, rev, _, _ := countRecords(arch)
	m = Manifest{Creato: s.now().Format(time.RFC3339), Rev: rev, ArchivioSHA: sha(arch), ArchivioByte: int64(len(arch)), RegistroSHA: sha(reg), RegistroByte: int64(len(reg)),
		RegistroRighe: countLines(reg), Allieve: c.Allieve, Iscrizioni: c.Iscrizioni, Pagamenti: c.Pagamenti, Versione: manifestVersion}
	return arch, reg, m, true, nil
}
