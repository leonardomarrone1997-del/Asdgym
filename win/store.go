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
	copyEvery  = 30 * time.Minute
	keepCopies = 100
)

// ErrConflict means the caller's revision is not the one on disk: it must reload before saving.
var ErrConflict = errors.New("l'archivio è stato modificato da un'altra finestra: ricarica i dati")

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
// It does not interpret the archive: the page owns its shape.
type Store struct {
	mu       sync.Mutex
	dir      string
	rev      int64
	db       json.RawMessage // nil until the first save
	salvato  string
	stamp    fileStamp
	lastCopy time.Time
	now      func() time.Time
}

// OpenStore prepares the folder and loads the archive if there is one.
// A damaged archive is an error: it is never replaced by an empty one.
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
	if err := s.load(); err != nil {
		return nil, err
	}
	s.lastCopy = s.newestCopy()
	return s, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path(archiveName))
	if errors.Is(err, os.ErrNotExist) {
		s.rev, s.db, s.salvato, s.stamp = 0, nil, "", fileStamp{}
		return nil
	}
	if err != nil {
		return fmt.Errorf("non riesco a leggere l'archivio: %w", err)
	}
	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil || !isObject(env.DB) {
		return fmt.Errorf("l'archivio %s è danneggiato e non è stato toccato. Nella cartella %q ci sono le copie precedenti", s.path(archiveName), filepath.Join(s.dir, copiesDir))
	}
	s.rev, s.db, s.salvato = env.Rev, env.DB, env.Salvato
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

// State returns the current revision, the archive (nil if none yet) and when it was last saved.
func (s *Store) State() (int64, json.RawMessage, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rev, s.db, s.salvato
}

// Save replaces the archive if rev is the current revision, then appends the entries to the change log.
// forceCopy takes a copy of the archive first whatever the time of the last one: for changes that replace
// many records at once (an import, a restore). It returns the new revision. A non-empty warning means the
// archive was saved but the log was not.
func (s *Store) Save(rev int64, db json.RawMessage, entries []Entry, forceCopy bool) (newRev int64, warning string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !isObject(db) {
		return s.rev, "", errors.New("dati non validi: l'archivio non è stato modificato")
	}
	// Another program (or a second copy of this one) may have written the file.
	if stampOf(s.path(archiveName)) != s.stamp {
		if lerr := s.load(); lerr != nil {
			return s.rev, "", lerr
		}
		return s.rev, "", ErrConflict
	}
	if rev != s.rev {
		return s.rev, "", ErrConflict
	}
	if s.db != nil && (forceCopy || s.now().Sub(s.lastCopy) >= copyEvery) {
		if cerr := s.copyArchive(); cerr != nil {
			return s.rev, "", fmt.Errorf("non riesco a fare la copia di sicurezza, quindi non salvo: %w", cerr)
		}
	}

	now := s.now()
	env := envelope{Rev: s.rev + 1, Salvato: now.Format(time.RFC3339), DB: db}
	out, err := json.MarshalIndent(env, "", " ")
	if err != nil {
		return s.rev, "", err
	}
	if err := writeAtomic(s.path(archiveName), out); err != nil {
		return s.rev, "", fmt.Errorf("non riesco a salvare l'archivio: %w", err)
	}
	s.rev, s.db, s.salvato = env.Rev, db, env.Salvato
	s.stamp = stampOf(s.path(archiveName))

	if len(entries) > 0 {
		if lerr := s.appendLog(entries, now); lerr != nil {
			warning = "Dati salvati, ma non sono riuscito ad aggiornare il registro delle modifiche: " + lerr.Error()
		}
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
		w.Write(line)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		return err
	}
	return f.Sync()
}

// Registro returns the newest entries first, at most limit of them.
func (s *Store) Registro(limit int) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.Open(s.path(registroName))
	if errors.Is(err, os.ErrNotExist) {
		return []Entry{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var all []Entry
	r := bufio.NewReader(f)
	for {
		line, err := r.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			var e Entry
			if json.Unmarshal(line, &e) == nil {
				all = append(all, e)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
	}
	out := make([]Entry, 0, limit)
	for i := len(all) - 1; i >= 0 && len(out) < limit; i-- {
		out = append(out, all[i])
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
