package main

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// Il logo della palestra: un solo file "logo.png", "logo.jpg" o "logo.webp" nella cartella dei dati. Si sceglie dal computer;
// su ogni dispositivo si decide poi come mostrarlo (nel menu, come sfondo sfocato).
const maxLogo = 4 << 20

var logoTipi = []string{"png", "jpg", "webp"}
var logoMime = map[string]string{"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}

// tipoLogo riconosce il tipo dal contenuto. Niente SVG: potrebbe portare del codice.
func tipoLogo(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "png"
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "jpg"
	case len(b) > 12 && bytes.Equal(b[0:4], []byte("RIFF")) && bytes.Equal(b[8:12], []byte("WEBP")):
		return "webp"
	}
	return ""
}

// logoCorrente restituisce il percorso e il tipo del logo, o "" se non c'è.
func (s *Server) logoCorrente() (string, string) {
	for _, t := range logoTipi {
		p := filepath.Join(s.store.Dir(), "logo."+t)
		if _, err := os.Stat(p); err == nil {
			return p, t
		}
	}
	return "", ""
}

// logoInfo è quello che sa la pagina: il tipo e un numero che cambia a ogni logo nuovo (per non vedere quello vecchio in memoria).
func (s *Server) logoInfo() any {
	p, t := s.logoCorrente()
	if p == "" {
		return nil
	}
	st, err := os.Stat(p)
	if err != nil {
		return nil
	}
	return map[string]any{"tipo": t, "v": st.ModTime().UnixNano() / 1e6}
}

func (s *Server) handleLogoGet(w http.ResponseWriter, r *http.Request) {
	p, t := s.logoCorrente()
	if p == "" {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", logoMime[t])
	w.Header().Set("Content-Disposition", "inline")
	w.Write(b)
}

// POST /api/logo: il corpo è l'immagine. Solo dal computer della segreteria.
func (s *Server) handleLogoPost(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		http.Error(w, "disponibile solo dal computer della segreteria", http.StatusForbidden)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxLogo+1))
	if err != nil || len(b) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Non riesco a leggere il file."})
		return
	}
	if len(b) > maxLogo {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"errore": "Il logo è troppo grande (massimo 4 MB)."})
		return
	}
	t := tipoLogo(b)
	if t == "" {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]any{"errore": "Il logo deve essere un'immagine PNG, JPEG o WebP."})
		return
	}
	dir := s.store.Dir()
	tmp := filepath.Join(dir, "logo."+t+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		os.Remove(tmp)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a salvare il logo: " + err.Error()})
		return
	}
	if err := os.Rename(tmp, filepath.Join(dir, "logo."+t)); err != nil {
		os.Remove(tmp)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a salvare il logo: " + err.Error()})
		return
	}
	for _, x := range logoTipi { // un solo logo alla volta: gli altri si tolgono solo quando quello nuovo è al suo posto
		if x != t {
			os.Remove(filepath.Join(dir, "logo."+x))
		}
	}
	info, _ := s.logoInfo().(map[string]any)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "tipo": t, "v": strconv.FormatInt(toInt64(info["v"]), 10)})
}

func toInt64(v any) int64 {
	if n, ok := v.(int64); ok {
		return n
	}
	return 0
}

func (s *Server) handleLogoDelete(w http.ResponseWriter, r *http.Request) {
	if !s.local(r) {
		http.Error(w, "disponibile solo dal computer della segreteria", http.StatusForbidden)
		return
	}
	for _, t := range logoTipi {
		if err := os.Remove(filepath.Join(s.store.Dir(), "logo."+t)); err != nil && !errors.Is(err, os.ErrNotExist) {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a togliere il logo: " + err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
