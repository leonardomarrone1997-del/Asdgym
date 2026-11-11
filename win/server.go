package main

import (
	"bytes"
	"crypto/subtle"
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
	".html":  "text/html; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".ico":   "image/x-icon",
	".woff2": "font/woff2",
	".txt":   "text/plain; charset=utf-8",
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
	autoExit   bool

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
	}, nil
}

// Done is closed when every window has been closed (only with autoExit).
func (s *Server) Done() <-chan struct{} { return s.done }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.handleIndex)
	mux.HandleFunc("GET /__apri", s.handleOpen)
	mux.HandleFunc("GET /api/stato", s.handleState)
	mux.HandleFunc("POST /api/salva", s.handleSave)
	mux.HandleFunc("GET /api/registro", s.handleRegistro)
	mux.HandleFunc("POST /api/vivo", s.handleAlive)
	mux.HandleFunc("POST /api/chiudi", s.handleBye)
	mux.HandleFunc("POST /api/apri-cartella", s.handleOpenFolder)
	mux.HandleFunc("GET /", s.handleStatic)
	return s.guard(mux)
}

// guard keeps other web pages away from the archive: only this origin, and a secret token for the data.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set(appHeader, "1")
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")

		// A page on another site that points a name at 127.0.0.1 arrives with its own Host.
		if r.Host != s.host {
			http.Error(w, "host non ammesso", http.StatusForbidden)
			return
		}
		if o := r.Header.Get("Origin"); o != "" && o != "http://"+s.host {
			http.Error(w, "origine non ammessa", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			got := r.Header.Get(tokenHeader)
			if r.URL.Path == "/api/chiudi" { // sent while the page closes, when headers cannot be set
				got = r.URL.Query().Get("t")
			}
			if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
				http.Error(w, "non autorizzato", http.StatusUnauthorized)
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", contentTypes[".html"])
	w.Write(s.index)
}

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

func (s *Server) handleState(w http.ResponseWriter, r *http.Request) {
	rev, db, salvato := s.store.State()
	if db == nil {
		db = json.RawMessage("null")
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rev": rev, "db": db, "salvato": salvato, "cartella": s.store.Dir(), "versione": s.version,
	})
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Rev      int64           `json:"rev"`
		DB       json.RawMessage `json:"db"`
		Registro []Entry         `json:"registro"`
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || json.Unmarshal(body, &req) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Richiesta non valida: l'archivio non è stato modificato."})
		return
	}
	rev, warning, err := s.store.Save(req.Rev, req.DB, req.Registro)
	switch {
	case errors.Is(err, ErrConflict):
		writeJSON(w, http.StatusConflict, map[string]any{"errore": "L'archivio è stato modificato da un'altra finestra. Ricarico i dati: ripeti l'ultima modifica.", "rev": rev})
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": err.Error(), "rev": rev})
	default:
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
	if id := clientID(r); id != "" {
		s.mu.Lock()
		s.clients[id] = time.Now()
		s.seen = true
		s.mu.Unlock()
	}
	w.WriteHeader(http.StatusNoContent)
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
	if !s.autoExit {
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
