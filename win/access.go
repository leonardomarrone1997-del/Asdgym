package main

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	cookieLocale = "gymart_l"
	cookieRete   = "gymart_s"
	codeTTL      = 10 * time.Minute
)

// Requests that only make sense on this computer, or that must never be allowed from a phone.
var soloLocale = map[string]bool{
	"/api/apri-cartella": true, "/api/scegli-cartella": true, "/api/copie2": true, "/api/copie2/adesso": true,
	"/api/password": true, "/api/sblocca": true, "/api/decifra": true, "/api/copia": true,
	"/api/sicurezza/adesso": true, "/api/sicurezza/controlla": true, "/api/sicurezza/letto": true, "/api/giornaliere": true, "/api/giornaliere/archivio": true,
	"/api/rete": true, "/api/rete/avvio": true, "/api/rete/esci-tutti": true, "/api/scansiona": true, "/api/esci-programma": true,
	"/api/aggiornamenti/controlla": true, "/api/aggiornamenti/scarica": true, "/api/aggiornamenti/installa": true, "/api/aggiornamenti/impostazioni": true,
	"/api/suoni": true, "/api/controllo": true,
}

// local says whether the request comes from this computer.
func (s *Server) local(r *http.Request) bool {
	if s.isLocal != nil {
		return s.isLocal(r)
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func cookieValue(r *http.Request, name string) string {
	if c, err := r.Cookie(name); err == nil {
		return c.Value
	}
	return ""
}

func setCookie(w http.ResponseWriter, r *http.Request, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil, MaxAge: maxAge})
}

// LaunchURL makes a one-use address for opening the page from this computer. The page is not handed to anyone
// who merely asks for it: only to the browser window the program itself opened with this address.
func (s *Server) LaunchURL() string {
	code := newID()
	s.mu.Lock()
	s.codes[code] = time.Now().Add(codeTTL)
	s.mu.Unlock()
	return "http://" + s.host + "/__avvio?c=" + code
}

func (s *Server) handleLaunch(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("c")
	s.mu.Lock()
	exp, ok := s.codes[code]
	delete(s.codes, code)
	for k, t := range s.codes {
		if time.Now().After(t) {
			delete(s.codes, k)
		}
	}
	var id string
	if ok && time.Now().Before(exp) {
		id = newID()
		s.locali[id] = true
	}
	s.mu.Unlock()
	if id == "" {
		http.Error(w, "Questo collegamento è scaduto o già usato. Apri Gym Art Segreteria dal programma.", http.StatusForbidden)
		return
	}
	setCookie(w, r, cookieLocale, id, 0)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// authenticated: a window opened by the program, or a device that logged in.
func (s *Server) authenticated(r *http.Request) bool {
	if s.local(r) {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.locali[cookieValue(r, cookieLocale)]
	}
	return s.rete != nil && s.rete.SessioneValida(cookieValue(r, cookieRete))
}

// guard keeps strangers away from the archive.
//   - From this computer: only the Host of the program's own address, and a secret token for the data.
//   - From the network: only while the network access is on, only known host names, and a logged-in session.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set(appHeader, "1")
		h.Set("Cache-Control", "no-store")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")

		local := s.local(r)
		if local {
			// A page on another site that points a name at 127.0.0.1 arrives with its own Host.
			if r.Host != s.host {
				http.Error(w, "host non ammesso", http.StatusForbidden)
				return
			}
			if o := r.Header.Get("Origin"); o != "" && o != "http://"+s.host {
				http.Error(w, "origine non ammessa", http.StatusForbidden)
				return
			}
		} else {
			if !s.rete.Attiva() || !s.rete.HostOK(r.Host) {
				http.Error(w, "host non ammesso", http.StatusForbidden)
				return
			}
			h.Set("Strict-Transport-Security", "max-age=31536000")
			if o := r.Header.Get("Origin"); o != "" && o != "https://"+r.Host {
				http.Error(w, "origine non ammessa", http.StatusForbidden)
				return
			}
		}
		p := r.URL.Path
		if (p == "/__avvio" || p == "/__apri") && !local {
			http.Error(w, "non disponibile", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(p, "/api/") {
			if soloLocale[p] && !local {
				http.Error(w, "disponibile solo dal computer della segreteria", http.StatusForbidden)
				return
			}
			got := r.Header.Get(tokenHeader)
			if p == "/api/chiudi" || (r.Method == http.MethodGet && (strings.HasPrefix(p, "/api/documento/") || strings.HasPrefix(p, "/api/assistenza/") || p == "/api/logo")) { // sent while the page closes, or opened by a link: no headers can be set
				got = r.URL.Query().Get("t")
			}
			if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
				http.Error(w, "non autorizzato", http.StatusUnauthorized)
				return
			}
			if !local && !s.authenticated(r) {
				http.Error(w, "accesso scaduto: rientra con la password", http.StatusUnauthorized)
				return
			}
		}
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if !s.authenticated(r) {
		if s.local(r) {
			http.Error(w, "Apri Gym Art Segreteria dal programma: questa pagina non si apre da un indirizzo digitato.", http.StatusForbidden)
			return
		}
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}
	w.Header().Set("Content-Type", contentTypes[".html"])
	w.Write(s.index)
}

func (s *Server) handleLoginPage(w http.ResponseWriter, r *http.Request) {
	if s.authenticated(r) && !s.local(r) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
		return
	}
	data, err := readStatic(s.static, "login.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentTypes[".html"])
	w.Write(data)
}

func remoteIP(r *http.Request) string {
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.local(r) {
		writeJSON(w, http.StatusNotFound, map[string]any{"errore": "Dal computer della segreteria non serve il login."})
		return
	}
	ip := remoteIP(r)
	if wait := s.rete.Attesa(ip); wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"errore": "Troppi tentativi. Riprova tra " + attesaTesto(wait) + ".", "attesa": int(wait.Seconds()) + 1})
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if !s.rete.Verifica(req.Password) {
		s.rete.Fallito(ip)
		time.Sleep(s.failDelay)
		writeJSON(w, http.StatusUnauthorized, map[string]any{"errore": "Password errata."})
		return
	}
	s.rete.Riuscito(ip)
	setCookie(w, r, cookieRete, s.rete.NuovaSessione(), int(sessionTTL.Seconds()))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func attesaTesto(d time.Duration) string {
	if d >= time.Minute {
		return strconv.Itoa(int(d.Minutes())+1) + " minuti"
	}
	return strconv.Itoa(int(d.Seconds())+1) + " secondi"
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if id := cookieValue(r, cookieRete); id != "" {
		s.rete.Esci(id)
	}
	setCookie(w, r, cookieRete, "", -1)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleCert hands out the certificate of the program, to be trusted on a phone. It carries no secret.
func (s *Server) handleCert(w http.ResponseWriter, r *http.Request) {
	pem := s.rete.Certificato()
	if len(pem) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/x-x509-ca-cert")
	w.Header().Set("Content-Disposition", `attachment; filename="gym-art-segreteria.crt"`)
	w.Write(pem)
}

/* ---------- settings of the network access (this computer only) ---------- */

func (s *Server) reteStatus() map[string]any {
	st := s.rete.Stato()
	out := map[string]any{"stato": st, "impronta": fingerprint(s.rete.Certificato()), "avvioWindows": false, "avvioDisponibile": leggiAvvio != nil}
	if leggiAvvio != nil {
		out["avvioWindows"] = leggiAvvio()
	}
	return out
}

func (s *Server) handleReteGet(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.reteStatus())
}

func (s *Server) handleRetePost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Attiva  bool   `json:"attiva"`
		Attuale string `json:"attuale"`
		Nuova   string `json:"nuova"`
		Porta   int    `json:"porta"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if err := s.rete.Configura(req.Attiva, req.Attuale, req.Nuova, req.Porta, s.Handler()); err != nil {
		switch {
		case errors.Is(err, ErrWrongPassword):
			time.Sleep(s.failDelay)
			writeJSON(w, http.StatusUnauthorized, map[string]any{"errore": "La password attuale non è giusta."})
		default:
			writeJSON(w, http.StatusBadRequest, map[string]any{"errore": errCapital(err.Error())})
		}
		return
	}
	writeJSON(w, http.StatusOK, s.reteStatus())
}

func errCapital(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:] + "."
}

func (s *Server) handleReteAvvio(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Attiva bool `json:"attiva"`
	}
	if !readJSON(r, &req) {
		badRequest(w)
		return
	}
	if impostaAvvio == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{"errore": "L'avvio con Windows è disponibile solo su Windows."})
		return
	}
	if err := impostaAvvio(req.Attiva); err != nil {
		logAvviso("avvio-windows", "non riesco a cambiare l'avvio con Windows: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"errore": "Non riesco a cambiare l'avvio con Windows: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, s.reteStatus())
}

func (s *Server) handleReteEsciTutti(w http.ResponseWriter, r *http.Request) {
	s.rete.EsciTutti()
	writeJSON(w, http.StatusOK, s.reteStatus())
}

// keepAlive: while the network access is on the program stays open even if its window is closed.
func (s *Server) keepAlive() bool { return s.rete != nil && s.rete.Attiva() }

var _ = json.Marshal
