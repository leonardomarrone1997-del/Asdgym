package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	archiveName  = "archivio.json"
	registroName = "registro.jsonl"
	copiesDir    = "copie"
	// A copy of the archive is taken before a save when the newest copy is older than this.
	copyEvery  = 10 * time.Minute
	keepCopies = 200
)

// ErrConflict means the caller's revision is not the one on disk: it must reload before saving.
var ErrConflict = errors.New("l'archivio è stato modificato da un'altra finestra: ricarica i dati")

// ErrLocked means the archive is encrypted and the password has not been given yet.
var ErrLocked = errors.New("l'archivio è protetto: serve la password")

// ErrNeedPassword means an encrypted copy was made with a key this program does not hold.
var ErrNeedPassword = errors.New("questa copia è protetta da un'altra password")

// Entry is one line of the change log.
type Entry struct {
	Quando     string `json:"quando"`
	Allieva    string `json:"allieva"`
	Operazione string `json:"operazione"`
	Campo      string `json:"campo,omitempty"`
	Prima      string `json:"prima,omitempty"`
	Dopo       string `json:"dopo,omitempty"`
	Nota       string `json:"nota,omitempty"`
}

type envelope struct {
	Rev     int64           `json:"rev"`
	Salvato string          `json:"salvato"`
	DB      json.RawMessage `json:"db"`
}

type fileStamp struct {
	size int64
	mod  time.Time
}

// Store keeps the archive in one JSON file, written atomically, with dated copies and an append-only change log.
// It does not interpret the archive: the page owns its shape. With a password, the three are encrypted on disk.
type Store struct {
	mu       sync.Mutex
	dir      string
	rev      int64
	db       json.RawMessage // nil until the first save
	salvato  string
	stamp    fileStamp
	lastCopy time.Time
	now      func() time.Time
	keys     *keyring    // nil: no password
	sealed   *sealedFile // the encrypted archive, while it waits for the password

	lastDaily string    // day of the newest daily snapshot
	dailyErr  string    // why the last one failed
	recovered *Recovery // set when the archive was put back from a copy at start
	logCount  struct {
		size int64
		mod  time.Time
		n    int
	}
}

// OpenStore prepares the folder and loads the archive if there is one.
// A damaged archive is an error: it is never replaced by an empty one.
// An encrypted archive leaves the store locked until Unlock.
func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, copiesDir), 0o700); err != nil {
		return nil, fmt.Errorf("non riesco a creare la cartella dei dati %s: %w", dir, err)
	}
	probe, err := os.CreateTemp(dir, ".prova-*")
	if err != nil {
		return nil, fmt.Errorf("non riesco a scrivere nella cartella dei dati %s: %w", dir, err)
	}
	probe.Close()
	os.Remove(probe.Name())

	s := &Store{dir: dir, now: time.Now}
	s.cleanLeftovers()
	mirror := mirrorBase(dir)
	err = s.load()
	switch {
	case errors.Is(err, ErrDamaged):
		// The archive does not read: it is set aside under another name and the newest good copy takes its place.
		ok, rerr := s.recoverArchive("danneggiato", mirror)
		if rerr != nil {
			return nil, rerr
		}
		if !ok {
			return nil, err
		}
		err = s.load()
	case err == nil && s.db == nil && s.sealed == nil:
		// No archive file at all, but copies exist: it was lost, and it is put back instead of starting from nothing.
		if ok, rerr := s.recoverArchive("mancante", mirror); rerr != nil {
			return nil, rerr
		} else if ok {
			err = s.load()
		}
	}
	if err != nil {
		return nil, err
	}
	s.restoreMissingLog(mirror)
	if s.recovered != nil {
		s.appendLog([]Entry{{Operazione: "Recupero automatico", Nota: "L'archivio era " + s.recovered.Motivo + ": rimesso da " + s.recovered.Da + " (salvata il " + s.recovered.Salvato + ")."}}, s.now())
	}
	s.lastCopy = s.newestCopy()
	if s.sealed == nil && s.db != nil {
		s.dailyLocked(false) // the first thing of the day: a snapshot of what is there before anything changes
	}
	return s, nil
}

// cleanLeftovers removes half-written temporary files that a crash can leave behind. Only ours, only temporary.
func (s *Store) cleanLeftovers() {
	os.Remove(s.path(archiveName + ".tmp"))
	os.Remove(s.path(registroName + ".tmp"))
	if items, err := os.ReadDir(s.dailyPath()); err == nil {
		for _, it := range items {
			if it.IsDir() && strings.HasPrefix(it.Name(), ".nuova-") {
				os.RemoveAll(s.dailyPath(it.Name()))
			}
		}
	}
}

// Recovered tells whether the archive was put back from a copy when the program started.
func (s *Store) Recovered() *Recovery {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.recovered
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

func (s *Store) damaged() error {
	return fmt.Errorf("%w: l'archivio %s non si legge e non è stato toccato. Nella cartella %q ci sono le copie precedenti", ErrDamaged, s.path(archiveName), filepath.Join(s.dir, copiesDir))
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path(archiveName))
	if errors.Is(err, os.ErrNotExist) {
		s.rev, s.db, s.salvato, s.stamp, s.sealed = 0, nil, "", fileStamp{}, nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("non riesco a leggere l'archivio: %w", err)
	}
	if f, ok := parseSealed(raw); ok {
		if s.keys == nil { // locked: nothing can be read yet
			s.rev, s.db, s.salvato, s.sealed = 0, nil, "", f
			s.stamp = stampOf(s.path(archiveName))
			return nil
		}
		if raw, err = s.keys.openFile(f); err != nil {
			return fmt.Errorf("l'archivio è stato sostituito da un file cifrato con un'altra chiave: %w", err)
		}
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || !isObject(env.DB) {
		return s.damaged()
	}
	s.rev, s.db, s.salvato, s.sealed = env.Rev, env.DB, env.Salvato, nil
	s.stamp = stampOf(s.path(archiveName))
	return nil
}

func stampOf(path string) fileStamp {
	fi, err := os.Stat(path)
	if err != nil {
		return fileStamp{}
	}
	return fileStamp{size: fi.Size(), mod: fi.ModTime()}
}

func isObject(raw json.RawMessage) bool {
	t := bytes.TrimSpace(raw)
	return len(t) > 1 && t[0] == '{' && json.Valid(t)
}

// Dir is the folder that holds the archive.
func (s *Store) Dir() string { return s.dir }

// Locked reports whether the archive is encrypted and still waiting for the password.
func (s *Store) Locked() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sealed != nil
}

// Protected reports whether the archive is kept encrypted on disk.
func (s *Store) Protected() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.keys != nil || s.sealed != nil
}

// State returns the current revision, the archive (nil if none yet) and when it was last saved.
func (s *Store) State() (int64, json.RawMessage, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rev, s.db, s.salvato
}

// ArchiveBytes returns the archive file exactly as it is on disk (encrypted, if there is a password).
func (s *Store) ArchiveBytes() ([]byte, error) {
	return os.ReadFile(s.path(archiveName))
}

// Unlock opens an encrypted archive with its password.
func (s *Store) Unlock(password string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sealed == nil {
		return nil
	}
	k, err := unlockHeader(s.sealed, password)
	if err != nil {
		return err
	}
	raw, err := k.openFile(s.sealed)
	if err != nil {
		return err
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || !isObject(env.DB) {
		return s.damaged()
	}
	s.keys, s.sealed = k, nil
	s.rev, s.db, s.salvato = env.Rev, env.DB, env.Salvato
	s.sealLeftovers() // whatever a previous run did not get to encrypt
	return nil
}

// writeArchive stores the current state under rev, encrypted if there is a password.
func (s *Store) writeArchive(env envelope) error {
	out, err := json.MarshalIndent(env, "", " ")
	if err != nil {
		return err
	}
	if s.keys != nil {
		if out, err = s.keys.sealFile(out); err != nil {
			return err
		}
	}
	if err := writeAtomic(s.path(archiveName), out); err != nil {
		return err
	}
	// Read it back: what is on the disk must be exactly what was meant to be written.
	if back, err := os.ReadFile(s.path(archiveName)); err != nil || !bytes.Equal(back, out) {
		return errors.New("il file scritto sul disco non corrisponde a quello da salvare")
	}
	s.stamp = stampOf(s.path(archiveName))
	return nil
}

// changedOutside reloads and reports true when another program wrote the archive file.
func (s *Store) changedOutside() (bool, error) {
	if stampOf(s.path(archiveName)) == s.stamp {
		return false, nil
	}
	return true, s.load()
}

// Save replaces the archive if rev is the current revision, then appends the entries to the change log.
// forceCopy takes a copy of the archive first whatever the time of the last one: for changes that replace
// or remove records (an import, a restore, a deletion). It returns the new revision. A non-empty warning
// means the archive was saved but the log was not.
func (s *Store) Save(rev int64, db json.RawMessage, entries []Entry, forceCopy bool) (newRev int64, warning string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.sealed != nil {
		return s.rev, "", ErrLocked
	}
	if !isObject(db) {
		return s.rev, "", errors.New("dati non validi: l'archivio non è stato modificato")
	}
	// Another program (or a second copy of this one) may have written the file.
	if changed, lerr := s.changedOutside(); changed {
		if lerr != nil {
			return s.rev, "", lerr
		}
		return s.rev, "", ErrConflict
	}
	if rev != s.rev {
		return s.rev, "", ErrConflict
	}
	if err := guardShrink(s.db, db, forceCopy); err != nil {
		return s.rev, "", fmt.Errorf("per sicurezza non salvo: %s. Se vuoi davvero togliere questi dati, usa la funzione apposta (elimina, importa, ripristina), che fa prima una copia", err.Error())
	}
	if s.db != nil && s.lastDaily != s.now().Format("2006-01-02") {
		s.dailyLocked(false) // the first save of the day: a snapshot of the archive as it was, before it changes; a failure is shown, it does not stop the work
	}
	if s.db != nil && (forceCopy || s.now().Sub(s.lastCopy) >= copyEvery) {
		if cerr := s.copyArchive(); cerr != nil {
			return s.rev, "", fmt.Errorf("non riesco a fare la copia di sicurezza, quindi non salvo: %w", cerr)
		}
	}

	now := s.now()
	env := envelope{Rev: s.rev + 1, Salvato: now.Format(time.RFC3339), DB: db}
	if err := s.writeArchive(env); err != nil {
		return s.rev, "", fmt.Errorf("non riesco a salvare l'archivio: %w", err)
	}
	s.rev, s.db, s.salvato = env.Rev, db, env.Salvato

	if len(entries) > 0 {
		if lerr := s.appendLog(entries, now); lerr != nil {
			warning = "Dati salvati, ma non sono riuscito ad aggiornare il registro delle modifiche: " + lerr.Error()
		}
	}
	if s.lastDaily != now.Format("2006-01-02") {
		s.dailyLocked(false) // the very first save has nothing before it to keep: the snapshot of the day is taken after it
	}
	return s.rev, warning, nil
}

func writeAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	// On Windows an antivirus or the search indexer can hold the old file for a moment.
	for i := 1; ; i++ {
		if err = os.Rename(tmp, path); err == nil || i == 5 {
			break
		}
		time.Sleep(time.Duration(i) * 40 * time.Millisecond)
	}
	if err != nil {
		os.Remove(tmp)
	}
	return err
}

func (s *Store) appendLog(entries []Entry, now time.Time) error {
	f, err := os.OpenFile(s.path(registroName), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	stamp := now.Format(time.RFC3339)
	for _, e := range entries {
		e.Quando = stamp
		line, err := json.Marshal(e)
		if err != nil {
			return err
		}
		if s.keys != nil {
			if line, err = s.keys.sealLine(line); err != nil {
				return err
			}
		}
		w.Write(line)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return f.Sync()
}

// readLines returns the non-empty lines of a file; a missing file has none.
func readLines(path string) ([][]byte, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var out [][]byte
	r := bufio.NewReader(f)
	for {
		line, err := r.ReadBytes('\n')
		if t := bytes.TrimSpace(line); len(t) > 0 {
			out = append(out, append([]byte(nil), t...))
		}
		if err == io.EOF {
			return out, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// Registro returns the newest entries first, at most limit of them.
func (s *Store) Registro(limit int) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sealed != nil {
		return nil, ErrLocked
	}
	lines, err := readLines(s.path(registroName))
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, limit)
	for i := len(lines) - 1; i >= 0 && len(out) < limit; i-- {
		line := lines[i]
		if isSealedLine(line) {
			if s.keys == nil {
				continue
			}
			if line, err = s.keys.openLine(line); err != nil {
				continue // written under a key this program does not hold
			}
		}
		var e Entry
		if json.Unmarshal(line, &e) == nil {
			out = append(out, e)
		}
	}
	return out, nil
}

func (s *Store) copyNames() []string {
	items, err := os.ReadDir(filepath.Join(s.dir, copiesDir))
	if err != nil {
		return nil
	}
	var names []string
	for _, it := range items {
		if !it.IsDir() && strings.HasPrefix(it.Name(), "archivio-") && strings.HasSuffix(it.Name(), ".json") {
			names = append(names, it.Name())
		}
	}
	// the timestamp in the name sorts chronologically; "-2" of the same second comes after the plain name
	sort.Slice(names, func(i, j int) bool {
		return strings.TrimSuffix(names[i], ".json") < strings.TrimSuffix(names[j], ".json")
	})
	return names
}

func (s *Store) newestCopy() time.Time {
	names := s.copyNames()
	if len(names) == 0 {
		return time.Time{}
	}
	fi, err := os.Stat(filepath.Join(s.dir, copiesDir, names[len(names)-1]))
	if err != nil {
		return time.Time{}
	}
	return fi.ModTime()
}

// copyArchive saves the archive as it is on disk into the copies folder and drops the oldest copies.
func (s *Store) copyArchive() error {
	data, err := os.ReadFile(s.path(archiveName))
	if err != nil {
		return err
	}
	name := "archivio-" + s.now().Format("20060102-150405") + ".json"
	for i := 2; ; i++ { // two copies in the same second must not overwrite each other
		if _, err := os.Stat(filepath.Join(s.dir, copiesDir, name)); err != nil {
			break
		}
		name = fmt.Sprintf("archivio-%s-%d.json", s.now().Format("20060102-150405"), i)
	}
	if err := writeAtomic(filepath.Join(s.dir, copiesDir, name), data); err != nil {
		return err
	}
	s.lastCopy = s.now()
	names := s.copyNames()
	for i := 0; i < len(names)-keepCopies; i++ {
		os.Remove(filepath.Join(s.dir, copiesDir, names[i]))
	}
	return nil
}

/* ---------- password ---------- */

// SetPassword protects the archive (current empty), changes the password, or removes it (next empty).
// A non-empty warning means the archive is in the requested state but some older file could not be converted.
func (s *Store) SetPassword(current, next string) (warning string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sealed != nil {
		return "", ErrLocked
	}
	if s.keys != nil { // whoever changes or removes the password must know it
		hdr := &sealedFile{V: 1, KDF: "pbkdf2-sha256", Iter: s.keys.iter, Sale: b64.EncodeToString(s.keys.salt), Chiave: b64.EncodeToString(s.keys.wrap)}
		if _, err := unlockHeader(hdr, current); err != nil {
			return "", ErrWrongPassword
		}
	}
	if changed, lerr := s.changedOutside(); changed {
		if lerr != nil {
			return "", lerr
		}
		return "", ErrConflict
	}
	env := envelope{Rev: s.rev, Salvato: s.salvato, DB: s.db}

	switch {
	case next == "" && s.keys == nil:
		return "", nil

	case next == "":
		// Remove: the archive goes last, because until then it is what holds the key.
		warning = s.convertOthers(false)
		old := s.keys
		s.keys = nil
		if err := s.writeArchive(env); err != nil {
			s.keys = old
			return "", fmt.Errorf("non riesco a riscrivere l'archivio: %w", err)
		}
		return warning, nil

	case s.keys == nil:
		if s.db == nil {
			return "", errors.New("non c'è ancora un archivio da proteggere: inserisci prima un dato")
		}
		k, err := newKeyring(next)
		if err != nil {
			return "", err
		}
		// Protect: the archive goes first, so the key exists on disk before anything depends on it.
		s.keys = k
		if err := s.writeArchive(env); err != nil {
			s.keys = nil
			return "", fmt.Errorf("non riesco a riscrivere l'archivio: %w", err)
		}
		return s.convertOthers(true), nil

	default:
		old := *s.keys
		if err := s.keys.rewrap(next); err != nil {
			return "", err
		}
		if err := s.writeArchive(env); err != nil {
			*s.keys = old
			return "", fmt.Errorf("non riesco a riscrivere l'archivio: %w", err)
		}
		return s.reheaderCopies(), nil
	}
}

// sealLeftovers encrypts log lines and copies that are still in clear, if there is a password.
func (s *Store) sealLeftovers() {
	if s.keys != nil {
		s.convertOthers(true)
	}
}

// convertOthers encrypts (or decrypts) the change log and the copies. It returns a warning for what it could not do.
func (s *Store) convertOthers(seal bool) string {
	var failed []string
	if err := s.convertLog(seal); err != nil {
		failed = append(failed, "il registro")
	}
	n := 0
	for _, name := range s.copyNames() {
		if err := s.convertFile(filepath.Join(s.dir, copiesDir, name), seal); err != nil {
			n++
		}
	}
	n += s.convertSnapshots(seal)
	if n > 0 {
		failed = append(failed, fmt.Sprintf("%d copie", n))
	}
	if len(failed) == 0 {
		return ""
	}
	verb := "cifrare"
	if !seal {
		verb = "decifrare"
	}
	return "Non sono riuscito a " + verb + " " + strings.Join(failed, " e ") + "."
}

func (s *Store) convertLog(seal bool) error {
	path := s.path(registroName)
	lines, err := readLines(path)
	if err != nil || len(lines) == 0 {
		return err
	}
	out, changed, err := s.convertLines(lines, seal)
	if err != nil || !changed {
		return err
	}
	return writeAtomic(path, out)
}

// convertLines encrypts or decrypts log lines. A line under another key stays as it is.
func (s *Store) convertLines(lines [][]byte, seal bool) (out []byte, changed bool, err error) {
	for i, line := range lines {
		switch sealedNow := isSealedLine(line); {
		case seal && !sealedNow:
			if lines[i], err = s.keys.sealLine(line); err != nil {
				return nil, false, err
			}
			changed = true
		case !seal && sealedNow:
			if plain, err := s.keys.openLine(line); err == nil {
				lines[i] = plain
				changed = true
			}
		}
	}
	return append(bytes.Join(lines, []byte("\n")), '\n'), changed, nil
}

// convertSnapshots encrypts or decrypts the daily snapshots (archive and log) and rewrites their manifests, one at a time,
// so that a snapshot is never left half converted. It returns how many it could not do.
func (s *Store) convertSnapshots(seal bool) int {
	failed := 0
	for _, n := range snapshotNames(s.dailyPath()) {
		if err := s.convertSnapshot(n, seal); err != nil {
			failed++
		}
	}
	return failed
}

func (s *Store) convertSnapshot(name string, seal bool) error {
	dir := s.dailyPath(name)
	m, err := readManifest(dir)
	if err != nil {
		return err
	}
	arch, err := os.ReadFile(filepath.Join(dir, archiveName))
	if err != nil {
		return err
	}
	if f, isSealed := parseSealed(arch); seal && !isSealed {
		if arch, err = s.keys.sealFile(arch); err != nil {
			return err
		}
	} else if !seal && isSealed {
		if arch, err = s.keys.openFile(f); err != nil {
			return err
		}
	}
	c, _, _, _ := countRecords(arch) // -1 while it is encrypted: the manifest says nothing about the content
	m.Allieve, m.Iscrizioni, m.Pagamenti = c.Allieve, c.Iscrizioni, c.Pagamenti
	reg, err := os.ReadFile(filepath.Join(dir, registroName))
	if err != nil {
		return err
	}
	if lines, _ := readLinesBytes(reg); len(lines) > 0 {
		if out, changed, err := s.convertLines(lines, seal); err != nil {
			return err
		} else if changed {
			reg = out
		}
	}
	return replaceSnapshot(s.dailyPath(), name, arch, reg, m)
}

func readLinesBytes(b []byte) ([][]byte, error) {
	var out [][]byte
	for _, l := range bytes.Split(b, []byte("\n")) {
		if t := bytes.TrimSpace(l); len(t) > 0 {
			out = append(out, append([]byte(nil), t...))
		}
	}
	return out, nil
}

// replaceSnapshot gives a snapshot new content: the new one is written and checked first, the old one is only removed after.
func replaceSnapshot(root, name string, arch, reg []byte, m Manifest) error {
	m.ArchivioSHA, m.ArchivioByte, m.RegistroSHA, m.RegistroByte = sha(arch), int64(len(arch)), sha(reg), int64(len(reg))
	if err := writeSnapshot(root, ".conv-"+name, arch, reg, m); err != nil {
		return err
	}
	conv, old := filepath.Join(root, ".conv-"+name), filepath.Join(root, ".vecchia-"+name)
	os.RemoveAll(old)
	if _, err := os.Stat(filepath.Join(root, name)); errors.Is(err, os.ErrNotExist) {
		return os.Rename(conv, filepath.Join(root, name)) // nothing to replace
	}
	if err := os.Rename(filepath.Join(root, name), old); err != nil {
		os.RemoveAll(conv)
		return err
	}
	if err := os.Rename(conv, filepath.Join(root, name)); err != nil {
		os.Rename(old, filepath.Join(root, name)) // put the old one back
		return err
	}
	os.RemoveAll(old)
	return nil
}

// convertFile encrypts or decrypts one copy in place, keeping its date.
func (s *Store) convertFile(path string, seal bool) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	f, isSealed := parseSealed(raw)
	var out []byte
	switch {
	case seal && !isSealed:
		out, err = s.keys.sealFile(raw)
	case !seal && isSealed:
		out, err = s.keys.openFile(f)
	default:
		return nil
	}
	if err != nil {
		return err
	}
	return rewriteKeepingTime(path, out)
}

func rewriteKeepingTime(path string, data []byte) error {
	fi, statErr := os.Stat(path)
	if err := writeAtomic(path, data); err != nil {
		return err
	}
	if statErr == nil {
		os.Chtimes(path, fi.ModTime(), fi.ModTime())
	}
	return nil
}

// reheaderCopies lets the copies be opened with the new password too. Their data is not touched.
func (s *Store) reheaderCopies() string {
	n := 0
	for _, name := range s.copyNames() {
		path := filepath.Join(s.dir, copiesDir, name)
		raw, err := os.ReadFile(path)
		if err != nil {
			n++
			continue
		}
		f, ok := parseSealed(raw)
		if !ok {
			continue
		}
		out, err := s.keys.reheader(f)
		if err == nil {
			err = rewriteKeepingTime(path, out)
		}
		if err != nil {
			n++
		}
	}
	for _, name := range snapshotNames(s.dailyPath()) {
		dir := s.dailyPath(name)
		m, err := readManifest(dir)
		arch, aerr := os.ReadFile(filepath.Join(dir, archiveName))
		reg, rerr := os.ReadFile(filepath.Join(dir, registroName))
		if err != nil || aerr != nil || rerr != nil {
			n++
			continue
		}
		f, ok := parseSealed(arch)
		if !ok {
			continue
		}
		out, err := s.keys.reheader(f)
		if err == nil {
			err = replaceSnapshot(s.dailyPath(), name, out, reg, m)
		}
		if err != nil {
			n++
		}
	}
	if n > 0 {
		return fmt.Sprintf("%d copie precedenti si aprono ancora solo con la vecchia password.", n)
	}
	return ""
}

// DecryptCopy returns the archive inside a copy chosen by the user. An encrypted copy is opened with the key
// in use, or else with the password given for it; ErrNeedPassword asks for that password.
func (s *Store) DecryptCopy(raw []byte, password string) (json.RawMessage, error) {
	s.mu.Lock()
	keys := s.keys
	s.mu.Unlock()
	if f, ok := parseSealed(raw); ok {
		var plain []byte
		var err error = ErrNeedPassword
		if keys != nil {
			plain, err = keys.openFile(f)
		}
		if err != nil {
			if password == "" {
				return nil, ErrNeedPassword
			}
			k, kerr := unlockHeader(f, password)
			if kerr != nil {
				return nil, kerr
			}
			if plain, err = k.openFile(f); err != nil {
				return nil, err
			}
		}
		raw = plain
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || !isObject(env.DB) {
		return nil, errors.New("il file scelto non è una copia dell'archivio")
	}
	return env.DB, nil
}
