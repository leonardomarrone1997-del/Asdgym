package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	tokenHeader = "X-Gymart-Token"
	// Marks our own answers, so a second launch can tell this program from another one using the port.
	appHeader = "X-Gymart"
	maxBody   = 32 << 20
	// A window says goodbye when it closes. One that just stops pinging may be asleep (a minimised
	// window, a suspended computer), so it is given up only after a long while.
	clientStale = 12 * time.Hour
	emptyGrace  = 4 * time.Second // a reload closes the page and opens it again
	startGrace  = 3 * time.Minute
	sleepGap    = 10 * time.Second // ticks further apart than this mean the computer was suspended
)

// Explicit types: on Windows the system table can map .js to text/plain, which the browser refuses to run.
var contentTypes = map[string]string{
	".html":        "text/html; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".woff2":       "font/woff2",
	".webmanifest": "application/manifest+json",
	".txt":         "text/plain; charset=utf-8",
}

// Server serves the page and the archive to this computer only.
type Server struct {
	store   *Store
	token   string
	host    string // "127.0.0.1:port", the only Host accepted
	static  fs.FS
	index   []byte
	version string

	openWindow func()
	openFolder func() error
	pickFolder func() (string, error)
	scanImage  func() ([]byte, error) // the scanner window (Windows); nil elsewhere
	mirror     *Mirror
	rete       *Rete
	autoExit   bool
	isLocal    func(*http.Request) bool // replaced in tests; by default the address of the caller decides
	failDelay  time.Duration            // pause after a wrong password
	locali     map[string]bool          // cookies of the windows the program opened itself
	codes      map[string]time.Time     // one-use launch codes

	agg *Aggiornamenti

	mu         sync.Mutex
	clients    map[string]time.Time
	seen       bool
	emptySince time.Time
	lastOpen   time.Time
	started    time.Time
	done       chan struct{}
	doneOnce   sync.Once
}

// NewServer wires the handlers. index.html must contain the __TOKEN__ placeholder.
func NewServer(store *Store, static fs.FS, host, token, version string) (*Server, error) {
	index, err := fs.ReadFile(static, "index.html")
	if err != nil {
		return nil, err
	}
	if !bytes.Contains(index, []byte("__TOKEN__")) {
		return nil, errors.New("index.html senza segnaposto del token")
	}
	return &Server{
		store: store, token: token, host: host, static: static, version: version,
		index:   bytes.ReplaceAll(index, []byte("__TOKEN__"), []byte(token)),
		clients: map[string]time.Time{}, started: time.Now(), done: make(chan struct{}),
		rete: OpenRete(store.Dir()), agg: nuoviAggiornamenti(store.Dir(), version), failDelay: 600 * time.Millisecond, locali: map[string]bool{}, codes: map[string]time.Time{},
	}, nil
}

// Done is closed when every window has been closed (only with autoExit).
func (s *Server) Done() <-chan struct{} { return s.done }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /__avvio", s.handleLaunch)
	mux.HandleFunc("GET /login", s.handleLoginPage)
	mux.HandleFunc("POST /login", s.handleLogin)
	mux.HandleFunc("POST /logout", s.handleLogout)
	mux.HandleFunc("GET /certificato", s.handleCert)
	mux.HandleFunc("GET /api/rete", s.handleReteGet)
	mux.HandleFunc("POST /api/rete", s.handleRetePost)
	mux.HandleFunc("POST /api/rete/avvio", s.handleReteAvvio)
	mux.HandleFunc("POST /api/rete/esci-tutti", s.handleReteEsciTutti)
	mux.HandleFunc("GET /__apri", s.handleOpen)
	mux.HandleFunc("GET /api/stato", s.handleState)
	mux.HandleFunc("POST /api/salva", s.handleSave)
	mux.HandleFunc("GET /api/registro", s.handleRegistro)
	mux.HandleFunc("POST /api/vivo", s.handleAlive)
	mux.HandleFunc("POST /api/chiudi", s.handleBye)
	mux.HandleFunc("POST /api/esci-programma", s.handleExit)
	mux.HandleFunc("GET /api/aggiornamenti", s.handleAggStato)
	mux.HandleFunc("POST /api/aggiornamenti/controlla", s.handleAggControlla)
	mux.HandleFunc("POST /api/aggiornamenti/scarica", s.handleAggScarica)
	mux.HandleFunc("POST /api/aggiornamenti/installa", s.handleAggInstalla)
	mux.HandleFunc("POST /api/aggiornamenti/impostazioni", s.handleAggImposta)
	mux.HandleFunc("POST /api/apri-cartella", s.handleOpenFolder)
	mux.HandleFunc("POST /api/sblocca", s.handleUnlock)
	mux.HandleFunc("POST /api/password", s.handlePassword)
	mux.HandleFunc("GET /api/copia", s.handleCopy)
	mux.HandleFunc("POST /api/decifra", s.handleDecrypt)
	mux.HandleFunc("GET /api/copie2", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"copie2": s.mirrorStatus()})
	})
	mux.HandleFunc("POST /api/copie2", s.handleMirrorSet)
	mux.HandleFunc("POST /api/copie2/adesso", s.handleMirrorNow)
	mux.HandleFunc("POST /api/scegli-cartella", s.handlePickFolder)
	mux.HandleFunc("GET /api/sicurezza", s.handleSafety)
	mux.HandleFunc("POST /api/sicurezza/adesso", s.handleSafetyNow)
	mux.HandleFunc("POST /api/sicurezza/controlla", s.handleSafetyCheck)
	mux.HandleFunc("POST /api/sicurezza/letto", s.handleRecoverySeen)
	mux.HandleFunc("GET /api/giornaliere", s.handleBackups)
	mux.HandleFunc("GET /api/giornaliere/archivio", s.handleBackupArchive)
	mux.HandleFunc("POST /api/documento", s.handleDocumentoPost)
	mux.HandleFunc("GET /api/documento/{file}", s.handleDocumentoGet)
	mux.HandleFunc("DELETE /api/documento/{file}", s.handleDocumentoDelete)
	mux.HandleFunc("POST /api/scansiona", s.handleScansiona)
	mux.HandleFunc("GET /api/logo", s.handleLogoGet)
	mux.HandleFunc("POST /api/logo", s.handleLogoPost)
	mux.HandleFunc("DELETE /api/logo", s.handleLogoDelete)
	mux.HandleFunc("GET /", s.handleStatic)
	return s.guard(mux)
}

func readStatic(f fs.FS, name string) ([]byte, error) { return fs.ReadFile(f, name) }

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	ct, ok := contentTypes[path.Ext(name)]
	if !ok || name == "index.html" || !fs.ValidPath(name) {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(s.static, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", ct)
	w.Write(data)
}

// handleOpen lets a second launch of the program show a window of the one already running.
func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	ok := s.openWindow != nil && time.Since(s.lastOpen) > 2*time.Second
	if ok {
		s.lastOpen = time.Now()
	}
	s.mu.Unlock()
	if ok {
		s.openWindow()
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) mirrorStatus() MirrorStatus {
	if s.mirror == nil {
		return MirrorStatus{}
	}
	return s.mirror.Status()
}

func (s *Server) kickMirror() {
	if s.mirror != nil {
		s.mirror.Kick()
	}
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	local := s.local(r)
	if s.store.Locked() { // nothing about the data leaves before the password
		writeJSON(w, http.StatusOK, map[string]any{"bloccato": true, "cartella": s.store.Dir(), "versione": s.version})
		return
	}
	rev, db, salvato := s.store.State()
	if db == nil {
		db = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rev": rev, "db": db, "salvato": salvato, "cartella": s.store.Dir(), "versione": s.version,
		"protetto": s.store.Protected(), "copie2": s.mirrorStatus(), "sicurezza": s.store.Safety(), "sceltaCartella": s.pickFolder != nil && local, "scanner": s.scanImage != nil && local, "logo": s.logoInfo(), "remoto": !local,
	})
}

func readJSON(r *http.Request, v any) bool {
	body, err := io.ReadAll(r.Body)
	return err == nil && json.Unmarshal(body, v) == nil
}

func badRequest(w http.ResponseWriter) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Richiesta non valida."})
}

// storeError answers for the errors every data request can meet.
func storeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrLocked):
		writeJSON(w, http.StatusLocked, map[string]any{"errore": "L'archivio è protetto: serve la password.", "bloccato": true})
	case errors.Is(err, ErrWrongPassword):
		time.Sleep(600 * time.Millisecond) // slows down guessing
		writeJSON(w, http.StatusUnauthorized, map[string]any{"errore": "Password errata."})
	case errors.Is(err, ErrNeedPassword):
		writeJSON(w, http.StatusUnauthorized, map[string]any{"errore": "Questa copia è protetta da una password diversa da quella in uso.", "servePassword": true})
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"errore": "L'archivio è stato modificato da un'altra finestra. Ricarico i dati: ripeti l'ultima modifica."})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": err.Error()})
	}
}

func (s *Server) handleUnlock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if err := s.store.Unlock(req.Password); err != nil {
		storeError(w, err)
		return
	}
	s.kickMirror()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handlePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Attuale string `json:"attuale"`
		Nuova   string `json:"nuova"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if req.Nuova != "" {
		if err := checkPassword(req.Nuova); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "La nuova password deve avere almeno 8 caratteri."})
			return
		}
	}
	warning, err := s.store.SetPassword(req.Attuale, req.Nuova)
	if err != nil {
		storeError(w, err)
		return
	}
	s.kickMirror()
	writeJSON(w, http.StatusOK, map[string]any{"protetto": s.store.Protected(), "avviso": warning})
}

// handleCopy hands out the archive file as it is on disk: the safety copy the user downloads.
func (s *Server) handleCopy(w http.ResponseWriter, r *http.Request) {
	if s.store.Locked() {
		storeError(w, ErrLocked)
		return
	}
	raw, err := s.store.ArchiveBytes()
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"errore": "Non c'è ancora un archivio da copiare."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"testo": string(raw), "protetto": s.store.Protected()})
}

// handleDecrypt reads a copy chosen by the user, so the page can show what it holds before restoring it.
func (s *Server) handleDecrypt(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Testo    string `json:"testo"`
		Password string `json:"password"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if s.store.Locked() {
		storeError(w, ErrLocked)
		return
	}
	db, err := s.store.DecryptCopy([]byte(req.Testo), req.Password)
	switch {
	case errors.Is(err, ErrWrongPassword), errors.Is(err, ErrNeedPassword):
		storeError(w, err)
	case err != nil:
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": err.Error()})
	default:
		writeJSON(w, http.StatusOK, map[string]any{"db": db})
	}
}

func (s *Server) handleMirrorSet(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Cartella string `json:"cartella"`
	}
	if !readJSON(r, &req) || s.mirror == nil {
		badRequest(w)
		return
	}
	if err := s.mirror.Set(req.Cartella); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": err.Error()})
		return
	}
	s.mirror.CopyNow() // the outcome is in the status
	writeJSON(w, http.StatusOK, map[string]any{"copie2": s.mirror.Status()})
}

func (s *Server) handleMirrorNow(w http.ResponseWriter, r *http.Request) {
	if s.mirror == nil {
		badRequest(w)
		return
	}
	if err := s.mirror.CopyNow(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": err.Error(), "copie2": s.mirror.Status()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"copie2": s.mirror.Status()})
}

func (s *Server) handlePickFolder(w http.ResponseWriter, r *http.Request) {
	if s.pickFolder == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"errore": "Scrivi il percorso della cartella a mano."})
		return
	}
	dir, err := s.pickFolder()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco ad aprire la finestra di scelta: scrivi il percorso della cartella a mano."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cartella": dir}) // empty: the user closed the window
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rev      int64           `json:"rev"`
		DB       json.RawMessage `json:"db"`
		Registro []Entry         `json:"registro"`
		Copia    bool            `json:"copia"`
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || json.Unmarshal(body, &req) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Richiesta non valida: l'archivio non è stato modificato."})
		return
	}
	rev, warning, err := s.store.Save(req.Rev, req.DB, req.Registro, req.Copia)
	switch {
	case errors.Is(err, ErrLocked):
		storeError(w, err)
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"errore": "L'archivio è stato modificato da un'altra finestra. Ricarico i dati: ripeti l'ultima modifica.", "rev": rev})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": err.Error(), "rev": rev})
	default:
		s.kickMirror()
		_, _, salvato := s.store.State()
		writeJSON(w, http.StatusOK, map[string]any{"rev": rev, "salvato": salvato, "avviso": warning})
	}
}

func (s *Server) handleRegistro(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limite"))
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	rows, err := s.store.Registro(limit)
	if errors.Is(err, ErrLocked) {
		storeError(w, err)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a leggere il registro: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"righe": rows})
}

func (s *Server) handleOpenFolder(w http.ResponseWriter, r *http.Request) {
	if s.openFolder == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"errore": "Apri la cartella a mano: " + s.store.Dir()})
		return
	}
	if err := s.openFolder(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco ad aprire la cartella: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func clientID(r *http.Request) string {
	id := r.URL.Query().Get("id")
	if len(id) == 0 || len(id) > 64 {
		return ""
	}
	return id
}

func (s *Server) handleAlive(w http.ResponseWriter, r *http.Request) {
	// Only the windows of this computer decide when the program may stop: a phone that vanishes must not keep it open.
	if id := clientID(r); id != "" && s.local(r) {
		s.mu.Lock()
		s.clients[id] = time.Now()
		s.seen = true
		s.mu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleExit closes the program on request of the window of this computer ("Chiudi il programma"): the answer goes out first, then the program stops.
func (s *Server) handleExit(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		writeJSON(w, http.StatusForbidden, map[string]any{"errore": "Il programma si chiude solo dal computer su cui gira."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	go func() {
		time.Sleep(400 * time.Millisecond)
		s.doneOnce.Do(func() { close(s.done) })
	}()
}

func (s *Server) handleBye(w http.ResponseWriter, r *http.Request) {
	if id := clientID(r); id != "" {
		s.mu.Lock()
		delete(s.clients, id)
		s.mu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
}

// Watch closes Done when no window is left. It returns when Done is closed.
func (s *Server) Watch() {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	prev := time.Now()
	for {
		select {
		case <-s.done:
			return
		case now := <-tick.C:
			if now.Round(0).Sub(prev.Round(0)) > sleepGap { // wall clock: the other one may stop while suspended
				s.afterSleep(now)
			}
			prev = now
			if s.shouldExit(now) {
				s.doneOnce.Do(func() { close(s.done) })
				return
			}
		}
	}
}

// afterSleep gives every window a fresh start: after a suspension their pings are late, not missing.
func (s *Server) afterSleep(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id := range s.clients {
		s.clients[id] = now
	}
	s.emptySince = time.Time{}
	s.started = now
}

func (s *Server) shouldExit(now time.Time) bool {
	if !s.autoExit || s.keepAlive() {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, last := range s.clients {
		if now.Sub(last) > clientStale {
			delete(s.clients, id)
		}
	}
	if len(s.clients) > 0 {
		s.emptySince = time.Time{}
		return false
	}
	if !s.seen {
		return now.Sub(s.started) > startGrace // the window never appeared
	}
	if s.emptySince.IsZero() {
		s.emptySince = now
		return false
	}
	return now.Sub(s.emptySince) >= emptyGrace
}

/* ---------- safety copies ---------- */

func (s *Server) handleSafety(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"sicurezza": s.store.Safety(), "copie2": s.mirrorStatus()})
}

// handleSafetyNow makes a snapshot now (checked after writing) and brings the second folder up to date.
func (s *Server) handleSafetyNow(w http.ResponseWriter, r *http.Request) {
	if s.store.Locked() {
		storeError(w, ErrLocked)
		return
	}
	name, _, err := s.store.DailyBackup(true)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "La copia non è riuscita: " + err.Error(), "sicurezza": s.store.Safety()})
		return
	}
	res := map[string]any{"nome": name, "sicurezza": s.store.Safety()}
	if s.mirror != nil {
		if err := s.mirror.CopyNow(); err != nil {
			res["avviso"] = err.Error()
		}
		res["copie2"] = s.mirror.Status()
	}
	writeJSON(w, http.StatusOK, res)
}

// handleSafetyCheck reads every copy back, here and in the second folder.
func (s *Server) handleSafetyCheck(w http.ResponseWriter, r *http.Request) {
	res := map[string]any{"locali": s.store.CheckBackups()}
	if s.mirror != nil && s.mirror.Status().Cartella != "" {
		rm, err := s.mirror.Check()
		res["seconda"] = rm
		if err != nil {
			res["secondaErrore"] = err.Error()
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleRecoverySeen(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DismissRecovery(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleBackups(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"copie": s.store.Backups()})
}

// handleBackupArchive hands out the archive of a daily snapshot, checked, so that the page can show what it holds before restoring it.
func (s *Server) handleBackupArchive(w http.ResponseWriter, r *http.Request) {
	if s.store.Locked() {
		storeError(w, ErrLocked)
		return
	}
	raw, err := s.store.BackupArchive(r.URL.Query().Get("nome"))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Questa copia non si può usare: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"testo": string(raw)})
}

// Maintain keeps the daily snapshot and the second folder up to date while the program stays open for days:
// a new day gets its snapshot even if nobody saves, and a second folder that was away is tried again.
func (s *Server) Maintain(every time.Duration) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-tick.C:
			if s.store.Locked() {
				continue
			}
			_, created, _ := s.store.DailyBackup(false)
			if s.mirror != nil && s.mirror.Status().Cartella != "" {
				if st := s.mirror.Status(); created || st.Errore != "" {
					s.mirror.Kick()
				}
			}
		}
	}
}
