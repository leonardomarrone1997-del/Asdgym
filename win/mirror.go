package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	localConfigName = "impostazioni-pc.json"
	mirrorKeep      = 30
)

var mirrorFile = regexp.MustCompile(`^gymart-\d{8}\.json$`)

// MirrorStatus is what the page shows about the second folder.
type MirrorStatus struct {
	Cartella string `json:"cartella"`
	Ultima   string `json:"ultima"` // last copy that succeeded, RFC 3339
	Errore   string `json:"errore"` // why the last attempt failed, if it did
}

// Mirror keeps a copy of the archive in a second folder chosen by the user (a USB stick, an external disk):
// one file per day, rewritten at every save of that day, the last 30 days kept. The copy is the archive file
// as it is on disk, so it is encrypted when the archive is. A folder that cannot be reached never stops a save.
type Mirror struct {
	cfgPath string
	dataDir string
	source  func() ([]byte, error)
	now     func() time.Time

	mu     sync.Mutex // guards status
	status MirrorStatus

	work    sync.Mutex // one copy at a time
	kick    chan struct{}
	pending sync.WaitGroup // copies asked for and not finished yet
}

// OpenMirror reads the folder chosen on this computer, if any, and starts the background copier.
func OpenMirror(dataDir string, source func() ([]byte, error)) *Mirror {
	m := &Mirror{cfgPath: filepath.Join(dataDir, localConfigName), dataDir: dataDir, source: source, now: time.Now, kick: make(chan struct{}, 1)}
	if raw, err := os.ReadFile(m.cfgPath); err == nil {
		var cfg struct {
			Cartella string `json:"cartellaCopie"`
			Ultima   string `json:"ultimaCopia"`
		}
		if json.Unmarshal(raw, &cfg) == nil {
			m.status.Cartella, m.status.Ultima = cfg.Cartella, cfg.Ultima
		}
	}
	go func() {
		for range m.kick {
			m.CopyNow()
			m.pending.Done()
		}
	}()
	return m
}

func (m *Mirror) saveConfig() error {
	m.mu.Lock()
	raw, _ := json.MarshalIndent(map[string]string{"cartellaCopie": m.status.Cartella, "ultimaCopia": m.status.Ultima}, "", " ")
	m.mu.Unlock()
	return writeAtomic(m.cfgPath, raw)
}

// Status returns the folder, the time of the last good copy and the last error.
func (m *Mirror) Status() MirrorStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.status
}

// Set chooses the second folder (empty: none). The folder must be writable now.
func (m *Mirror) Set(dir string) error {
	dir = strings.TrimSpace(dir)
	if dir != "" {
		if !filepath.IsAbs(dir) {
			return errors.New("scrivi il percorso completo della cartella, per esempio E:\\Copie Gym Art")
		}
		dir = filepath.Clean(dir)
		if rel, err := filepath.Rel(m.dataDir, dir); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return errors.New("scegli una cartella diversa da quella dei dati, meglio se su un altro disco o su una chiavetta")
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("non riesco a creare la cartella: %w", err)
		}
		probe, err := os.CreateTemp(dir, ".prova-*")
		if err != nil {
			return fmt.Errorf("non riesco a scrivere nella cartella: %w", err)
		}
		probe.Close()
		os.Remove(probe.Name())
	}
	m.mu.Lock()
	if dir != m.status.Cartella {
		m.status = MirrorStatus{Cartella: dir}
	}
	m.mu.Unlock()
	return m.saveConfig()
}

// Kick asks for a copy soon, without waiting for it.
func (m *Mirror) Kick() {
	m.pending.Add(1)
	select {
	case m.kick <- struct{}{}:
	default: // one is already waiting: it will copy the newest archive
		m.pending.Done()
	}
}

// Flush waits for the copies that were asked for.
func (m *Mirror) Flush() { m.pending.Wait() }

// CopyNow writes today's copy. With no folder chosen, or no archive yet, it does nothing.
func (m *Mirror) CopyNow() error {
	m.work.Lock()
	defer m.work.Unlock()
	dir := m.Status().Cartella
	if dir == "" {
		return nil
	}
	data, err := m.source()
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	now := m.now()
	if err == nil {
		err = os.MkdirAll(dir, 0o700)
	}
	if err == nil {
		err = writeAtomic(filepath.Join(dir, "gymart-"+now.Format("20060102")+".json"), data)
	}
	m.mu.Lock()
	if err != nil {
		m.status.Errore = "Non riesco a scrivere nella cartella " + dir + ": " + err.Error()
	} else {
		m.status.Ultima, m.status.Errore = now.Format(time.RFC3339), ""
	}
	m.mu.Unlock()
	if err != nil {
		return errors.New(m.Status().Errore)
	}
	m.prune(dir)
	return m.saveConfig()
}

func (m *Mirror) prune(dir string) {
	items, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var names []string
	for _, it := range items {
		if !it.IsDir() && mirrorFile.MatchString(it.Name()) {
			names = append(names, it.Name())
		}
	}
	sort.Strings(names)
	for i := 0; i < len(names)-mirrorKeep; i++ {
		os.Remove(filepath.Join(dir, names[i]))
	}
}
