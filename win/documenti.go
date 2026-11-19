package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

// I documenti (per ora i certificati medici scansionati o fotografati) stanno come file nella cartella "documenti" accanto all'archivio:
// nell'archivio ci sono solo i dati che li descrivono. Il nome del file lo sceglie il programma (mai chi lo manda) e il tipo si riconosce dal contenuto.
const (
	documentiDir = "documenti"
	maxDocumento = 15 << 20
)

var (
	reDocumento = regexp.MustCompile(`^doc-[0-9a-f]{16}\.(pdf|jpg|png)$`)
	docTipi     = map[string]string{"pdf": "application/pdf", "jpg": "image/jpeg", "png": "image/png"}

	// ErrScansioneAnnullata: la finestra dello scanner è stata chiusa senza scansionare.
	ErrScansioneAnnullata = errors.New("scansione annullata")
	// ErrNessunoScanner: Windows non trova uno scanner (spento, scollegato, senza driver).
	ErrNessunoScanner = errors.New("nessuno scanner trovato")
)

// tipoDocumento riconosce il tipo dal contenuto: "pdf", "jpg", "png" oppure "".
func tipoDocumento(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return "pdf"
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return "jpg"
	case bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}):
		return "png"
	}
	return ""
}

func (s *Server) cartellaDocumenti() string { return filepath.Join(s.store.Dir(), documentiDir) }

// scriviDocumento salva il file con un nome nuovo e lo rilegge per essere sicuri. Restituisce il nome e il tipo.
func (s *Server) scriviDocumento(b []byte) (string, string, error) {
	tipo := tipoDocumento(b)
	if tipo == "" {
		return "", "", errors.New("Sono ammessi solo file PDF, JPEG e PNG.")
	}
	var r [8]byte
	if _, err := rand.Read(r[:]); err != nil {
		return "", "", err
	}
	nome := "doc-" + hex.EncodeToString(r[:]) + "." + tipo
	dir := s.cartellaDocumenti()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", fmt.Errorf("non riesco a preparare la cartella dei documenti: %w", err)
	}
	tmp := filepath.Join(dir, nome+".tmp")
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		os.Remove(tmp)
		return "", "", fmt.Errorf("non riesco a salvare il documento: %w", err)
	}
	if err := os.Rename(tmp, filepath.Join(dir, nome)); err != nil {
		os.Remove(tmp)
		return "", "", fmt.Errorf("non riesco a salvare il documento: %w", err)
	}
	if got, err := os.ReadFile(filepath.Join(dir, nome)); err != nil || !bytes.Equal(got, b) {
		os.Remove(filepath.Join(dir, nome))
		return "", "", errors.New("il documento salvato non corrisponde a quello ricevuto: riprova")
	}
	return nome, tipo, nil
}

func rispostaDocumento(nome, tipo string, dimensione int) map[string]any {
	return map[string]any{"file": nome, "tipo": tipo, "dimensione": dimensione}
}

// POST /api/documento: il corpo è il file (da un file scelto, da una foto del telefono).
func (s *Server) handleDocumentoPost(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxDocumento+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Non riesco a leggere il file."})
		return
	}
	if len(b) > maxDocumento {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"errore": "Il file è troppo grande (massimo 15 MB)."})
		return
	}
	if len(b) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Il file è vuoto."})
		return
	}
	nome, tipo, err := s.scriviDocumento(b)
	if err != nil {
		code := http.StatusInternalServerError
		if tipoDocumento(b) == "" {
			code = http.StatusUnsupportedMediaType
		}
		writeJSON(w, code, map[string]any{"errore": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rispostaDocumento(nome, tipo, len(b)))
}

// GET /api/documento/{file}: il file, da aprire in una scheda. Il token arriva nell'indirizzo (un collegamento non può mandare intestazioni).
func (s *Server) handleDocumentoGet(w http.ResponseWriter, r *http.Request) {
	nome := r.PathValue("file")
	if !reDocumento.MatchString(nome) {
		http.NotFound(w, r)
		return
	}
	b, err := os.ReadFile(filepath.Join(s.cartellaDocumenti(), nome))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", docTipi[nome[len(nome)-3:]])
	w.Header().Set("Content-Disposition", `inline; filename="`+nome+`"`)
	w.Write(b)
}

// DELETE /api/documento/{file}: toglie il file (i dati che lo descrivono li toglie la pagina, con il suo salvataggio).
func (s *Server) handleDocumentoDelete(w http.ResponseWriter, r *http.Request) {
	nome := r.PathValue("file")
	if !reDocumento.MatchString(nome) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"errore": "Nome del documento non valido."})
		return
	}
	if err := os.Remove(filepath.Join(s.cartellaDocumenti(), nome)); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a togliere il file: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// POST /api/scansiona (solo dal computer): apre la finestra dello scanner e salva la scansione come un documento.
func (s *Server) handleScansiona(w http.ResponseWriter, r *http.Request) {
	if s.scanImage == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"errore": "Lo scanner si usa dal programma solo su Windows: scegli un file già scansionato."})
		return
	}
	b, err := s.scanImage()
	switch {
	case errors.Is(err, ErrScansioneAnnullata):
		writeJSON(w, http.StatusOK, map[string]any{"annullata": true})
		return
	case errors.Is(err, ErrNessunoScanner):
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"errore": "Non trovo nessuno scanner. Controlla che sia acceso e collegato (o in rete), poi riprova; oppure scegli un file già scansionato."})
		return
	case err != nil:
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "La scansione non è riuscita. Puoi scegliere un file già scansionato."})
		return
	}
	if len(b) > maxDocumento {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"errore": "La scansione è troppo grande (massimo 15 MB): riprova con una risoluzione più bassa."})
		return
	}
	nome, tipo, err := s.scriviDocumento(b)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "La scansione non è riuscita: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, rispostaDocumento(nome, tipo, len(b)))
}
