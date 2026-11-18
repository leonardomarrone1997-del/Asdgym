package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const localConfigName = "impostazioni-pc.json"

// MirrorStatus is what the page shows about the second folder.
type MirrorStatus struct {
	Cartella    string `json:"cartella"`
	Ultima      string `json:"ultima"`      // last copy that succeeded and was read back, RFC 3339
	Errore      string `json:"errore"`      // why the last attempt failed, if it did
	Giornaliere int    `json:"giornaliere"` // daily snapshots in the second folder
	Avviso      string `json:"avviso"`      // a reason to doubt that this folder protects anything
}

// Mirror keeps the second copy in a folder chosen by the user (a USB stick, an external disk, a folder that a cloud service
// synchronises): "ultima" holds the newest archive and log, "giornaliere" the daily snapshots, with the same checks and the same
// retention as the local ones. Every file is read back after it is written. A folder that cannot be reached never stops a save.
type Mirror struct {
	cfgPath string
	dataDir string
	st      *Store
	now     func() time.Time

	mu     sync.Mutex // guards status
	status MirrorStatus

	work    sync.Mutex // one copy at a time
	kick    chan struct{}
	pending sync.WaitGroup // copies asked for and not finished yet
}

// OpenMirror reads the folder chosen on this computer, if any, and starts the background copier.
func OpenMirror(dataDir string, st *Store) *Mirror {
	m := &Mirror{cfgPath: filepath.Join(dataDir, localConfigName), dataDir: dataDir, st: st, now: time.Now, kick: make(chan struct{}, 1)}
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
	st := m.status
	m.mu.Unlock()
	if st.Cartella != "" {
		st.Giornaliere = len(snapshotNames(filepath.Join(st.Cartella, dailyDir)))
		if v := filepath.VolumeName(m.dataDir); v != "" && strings.EqualFold(v, filepath.VolumeName(st.Cartella)) {
			st.Avviso = "Questa cartella è sullo stesso disco dei dati: se il disco si rompe, si perde tutto insieme. Scegli una chiavetta, un disco esterno o una cartella sincronizzata (OneDrive, Google Drive)."
		}
	}
	return st
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

// CopyNow brings the second folder up to date: the newest archive and log, then every daily snapshot it lacks.
// With no folder chosen, or no archive yet, it does nothing.
func (m *Mirror) CopyNow() error {
	m.work.Lock()
	defer m.work.Unlock()
	dir := m.Status().Cartella
	if dir == "" {
		return nil
	}
	arch, reg, man, ok, err := m.st.liveFiles()
	if err == nil && !ok {
		return nil
	}
	now := m.now()
	var problems []string
	if err == nil {
		err = m.writeLatest(dir, arch, reg, man)
	}
	if err != nil {
		problems = append(problems, err.Error())
	} else if perr := m.syncDaily(dir); perr != nil {
		problems = append(problems, perr.Error())
	}
	m.mu.Lock()
	if len(problems) > 0 {
		m.status.Errore = "Non riesco ad aggiornare la cartella " + dir + ": " + problems[0]
	} else {
		m.status.Ultima, m.status.Errore = now.Format(time.RFC3339), ""
	}
	failed := m.status.Errore
	m.mu.Unlock()
	if failed != "" {
		return errors.New(failed)
	}
	return m.saveConfig()
}

// writeLatest keeps "ultima" equal to the live files. Nothing is written when it already is.
func (m *Mirror) writeLatest(dir string, arch, reg []byte, man Manifest) error {
	if old, err := readManifest(filepath.Join(dir, mirrorLatest)); err == nil && old.ArchivioSHA == man.ArchivioSHA && old.RegistroSHA == man.RegistroSHA && verifySnapshot(filepath.Join(dir, mirrorLatest)) == nil {
		return nil
	}
	man.Nome, man.Motivo = mirrorLatest, "ultima"
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	return replaceSnapshot(dir, mirrorLatest, arch, reg, man)
}

// syncDaily copies the daily snapshots the second folder lacks (or has differently) and applies the same retention.
func (m *Mirror) syncDaily(dir string) error {
	root := filepath.Join(dir, dailyDir)
	var first error
	for _, n := range snapshotNames(m.st.dailyPath()) {
		src, dst := m.st.dailyPath(n), filepath.Join(root, n)
		lm, err := readManifest(src)
		if err != nil {
			continue
		}
		if rm, err := readManifest(dst); err == nil && rm.ArchivioSHA == lm.ArchivioSHA && rm.RegistroSHA == lm.RegistroSHA {
			continue
		}
		if err := verifySnapshot(src); err != nil { // a local snapshot that no longer checks is not copied
			if first == nil {
				first = fmt.Errorf("la copia giornaliera %s non risulta integra: %w", n, err)
			}
			continue
		}
		arch, err1 := os.ReadFile(filepath.Join(src, archiveName))
		reg, err2 := os.ReadFile(filepath.Join(src, registroName))
		if err1 != nil || err2 != nil {
			continue
		}
		if err := os.MkdirAll(root, 0o700); err != nil {
			return err
		}
		if err := replaceSnapshot(root, n, arch, reg, lm); err != nil && first == nil {
			first = err
		}
	}
	for _, n := range retentionPlan(snapshotNames(root), m.now()) {
		os.RemoveAll(filepath.Join(root, n))
	}
	return first
}

// Check reads every copy in the second folder back and compares it with its manifest.
func (m *Mirror) Check() (CheckResult, error) {
	dir := m.Status().Cartella
	r := CheckResult{Errori: []string{}}
	if dir == "" {
		return r, errors.New("non c'è una seconda cartella")
	}
	if _, err := os.Stat(dir); err != nil {
		return r, fmt.Errorf("non raggiungo la cartella %s: %w", dir, err)
	}
	check := func(label, path string) {
		r.Controllate++
		if err := verifySnapshot(path); err != nil {
			r.Errori = append(r.Errori, label+": "+err.Error())
		}
	}
	if _, err := os.Stat(filepath.Join(dir, mirrorLatest)); err == nil {
		check("ultima copia", filepath.Join(dir, mirrorLatest))
	} else {
		r.Controllate++
		r.Errori = append(r.Errori, "manca l'ultima copia")
	}
	for _, n := range snapshotNames(filepath.Join(dir, dailyDir)) {
		check(n, filepath.Join(dir, dailyDir, n))
	}
	return r, nil
}
