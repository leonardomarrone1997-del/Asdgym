package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Access from other devices (a phone on the gym Wi-Fi, or over Tailscale).
//
// The program keeps listening on 127.0.0.1 for its own window. When the network access is switched on it also listens
// on the network, always over HTTPS, and every request from outside this computer needs the password of the gym:
// a login page, a session cookie, a limit on wrong guesses. The settings live in a small file next to the data
// (rete.json) and are about this computer, not about the archive: a copy of the archive never carries them.

const (
	reteFile        = "rete.json"
	retePortDefault = 47816
	sessionTTL      = 14 * 24 * time.Hour
	maxFails        = 5 // wrong passwords in a row from one address before it is made to wait
	certDays        = 800
	certFile        = "rete-cert.pem" // a certificate given by the user (for example from "tailscale cert")
	keyFile         = "rete-key.pem"
	selfCertFile    = "rete-autofirmato-cert.pem"
	selfKeyFile     = "rete-autofirmato-key.pem"
)

type reteConfig struct {
	Attiva    bool     `json:"attiva"`
	Porta     int      `json:"porta"`
	Sale      string   `json:"sale,omitempty"`
	Hash      string   `json:"hash,omitempty"`
	Iter      int      `json:"iter,omitempty"`
	HostExtra []string `json:"hostExtra,omitempty"`
}

// ReteStato is what the page shows in Settings.
type ReteStato struct {
	Attiva      bool     `json:"attiva"`
	Porta       int      `json:"porta"`
	HaPassword  bool     `json:"haPassword"`
	InAscolto   bool     `json:"inAscolto"`
	Indirizzi   []string `json:"indirizzi"`
	Certificato string   `json:"certificato"` // "autofirmato", "fornito" or ""
	Errore      string   `json:"errore"`
	Sessioni    int      `json:"sessioni"`
}

type tentativi struct {
	n     int
	until time.Time
}

// Rete owns the network listener, the password and the sessions of the devices that logged in.
type Rete struct {
	mu       sync.Mutex
	dir      string
	cfg      reteConfig
	ln       net.Listener
	srv      *http.Server
	port     int
	kind     string
	errMsg   string
	leaf     []byte // PEM of the certificate in use, for /certificato
	names    []string
	sessions map[string]time.Time
	fails    map[string]*tentativi
	now      func() time.Time
	addrs    func() []net.IP // this computer's addresses (replaced in tests)
	hostname string
}

// OpenRete reads the settings of this computer, if there are any.
func OpenRete(dir string) *Rete {
	r := &Rete{dir: dir, sessions: map[string]time.Time{}, fails: map[string]*tentativi{}, now: time.Now, addrs: localIPs}
	r.hostname, _ = os.Hostname()
	r.cfg.Porta = retePortDefault
	if raw, err := os.ReadFile(filepath.Join(dir, reteFile)); err == nil {
		var c reteConfig
		if json.Unmarshal(raw, &c) == nil {
			if c.Porta <= 0 || c.Porta > 65535 {
				c.Porta = retePortDefault
			}
			r.cfg = c
		}
	}
	return r
}

func (r *Rete) save() error {
	raw, _ := json.MarshalIndent(r.cfg, "", " ")
	return writeAtomic(filepath.Join(r.dir, reteFile), raw)
}

// Attiva reports whether the network access is on (not whether the listener managed to start).
func (r *Rete) Attiva() bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg.Attiva
}

func localIPs() []net.IP {
	var out []net.IP
	ifs, _ := net.InterfaceAddrs()
	for _, a := range ifs {
		ipn, ok := a.(*net.IPNet)
		if !ok || ipn.IP.IsLoopback() || ipn.IP.IsLinkLocalUnicast() || ipn.IP.To4() == nil {
			continue
		}
		out = append(out, ipn.IP)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}

/* ---------- password ---------- */

func (r *Rete) hasPassword() bool { return r.cfg.Hash != "" }

func hashPassword(pass string, salt []byte, iter int) string {
	k, err := deriveKey(pass, salt, iter)
	if err != nil {
		return ""
	}
	return base64.StdEncoding.EncodeToString(k)
}

func (r *Rete) setPassword(pass string) error {
	if err := checkPassword(pass); err != nil {
		return err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	r.cfg.Sale, r.cfg.Iter = base64.StdEncoding.EncodeToString(salt), kdfIterations
	r.cfg.Hash = hashPassword(pass, salt, r.cfg.Iter)
	return nil
}

// Verifica checks a password against the stored hash.
func (r *Rete) Verifica(pass string) bool {
	r.mu.Lock()
	c := r.cfg
	r.mu.Unlock()
	if c.Hash == "" {
		return false
	}
	salt, err := base64.StdEncoding.DecodeString(c.Sale)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashPassword(pass, salt, c.Iter)), []byte(c.Hash)) == 1
}

/* ---------- sessions and wrong guesses ---------- */

func newID() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// NuovaSessione opens a session for a device that gave the right password.
func (r *Rete) NuovaSessione() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := newID()
	r.sessions[id] = r.now().Add(sessionTTL)
	return id
}

// SessioneValida says whether the cookie belongs to a live session, and keeps it alive while it is used.
func (r *Rete) SessioneValida(id string) bool {
	if id == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	exp, ok := r.sessions[id]
	if !ok || !r.now().Before(exp) {
		delete(r.sessions, id)
		return false
	}
	r.sessions[id] = r.now().Add(sessionTTL)
	return true
}

func (r *Rete) Esci(id string) {
	r.mu.Lock()
	delete(r.sessions, id)
	r.mu.Unlock()
}

func (r *Rete) EsciTutti() {
	r.mu.Lock()
	r.sessions = map[string]time.Time{}
	r.mu.Unlock()
}

// Attesa returns how long an address still has to wait before it may try again (0 = it may).
func (r *Rete) Attesa(ip string) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t := r.fails[ip]; t != nil && r.now().Before(t.until) {
		return t.until.Sub(r.now())
	}
	return 0
}

// Fallito records a wrong password: from the fifth one in a row the address waits one minute, then twice as long each time, up to 15 minutes.
func (r *Rete) Fallito(ip string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.fails[ip]
	if t == nil {
		t = &tentativi{}
		r.fails[ip] = t
	}
	t.n++
	if t.n == maxFails {
		logAvviso("rete", "password sbagliata %d volte di fila da un dispositivo: deve aspettare", maxFails)
	}
	if t.n >= maxFails {
		w := time.Minute << uint(t.n-maxFails)
		if w > 15*time.Minute || w <= 0 {
			w = 15 * time.Minute
		}
		t.until = r.now().Add(w)
	}
}

func (r *Rete) Riuscito(ip string) {
	r.mu.Lock()
	delete(r.fails, ip)
	r.mu.Unlock()
}

// HostOK limits the names a remote request may use: an address, the name of this computer, ".local", Tailscale names and those added by hand.
// A web page of another site that points its own name at this computer is refused.
func (r *Rete) HostOK(host string) bool {
	h := host
	if hh, _, err := net.SplitHostPort(host); err == nil {
		h = hh
	}
	h = strings.ToLower(strings.Trim(h, "[]"))
	if net.ParseIP(h) != nil {
		return true
	}
	r.mu.Lock()
	extra, name, names := r.cfg.HostExtra, strings.ToLower(r.hostname), r.names
	r.mu.Unlock()
	if h == name || h == name+".local" || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".ts.net") {
		return h != "" && h != ".local" && h != ".ts.net"
	}
	for _, x := range append(append([]string{}, extra...), names...) {
		if strings.EqualFold(x, h) {
			return true
		}
	}
	return false
}

/* ---------- certificate ---------- */

type fileCert struct {
	mu        sync.Mutex
	cert, key string
	mod       time.Time
	cur       *tls.Certificate
}

func (f *fileCert) get(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fi, err := os.Stat(f.cert)
	if err == nil && (f.cur == nil || fi.ModTime() != f.mod) { // a renewed certificate is picked up without a restart
		c, lerr := tls.LoadX509KeyPair(f.cert, f.key)
		if lerr != nil {
			if f.cur != nil {
				return f.cur, nil
			}
			return nil, lerr
		}
		f.cur, f.mod = &c, fi.ModTime()
	}
	if f.cur == nil {
		return nil, errors.New("certificato non disponibile")
	}
	return f.cur, nil
}

func leafNames(pemData []byte) []string {
	b, _ := pem.Decode(pemData)
	if b == nil {
		return nil
	}
	c, err := x509.ParseCertificate(b.Bytes)
	if err != nil {
		return nil
	}
	return c.DNSNames
}

// selfSigned makes (or keeps) a certificate for this computer's addresses, valid for 800 days; it is made again when an address is missing from it or it is about to expire.
func (r *Rete) selfSigned() (certPath, keyPath string, err error) {
	certPath, keyPath = filepath.Join(r.dir, selfCertFile), filepath.Join(r.dir, selfKeyFile)
	ips := append([]net.IP{net.ParseIP("127.0.0.1")}, r.addrs()...)
	names := []string{"localhost"}
	if r.hostname != "" {
		names = append(names, r.hostname)
	}
	if raw, rerr := os.ReadFile(certPath); rerr == nil {
		if b, _ := pem.Decode(raw); b != nil {
			if c, perr := x509.ParseCertificate(b.Bytes); perr == nil && c.NotAfter.After(r.now().Add(30*24*time.Hour)) {
				ok := true
				for _, ip := range ips {
					found := false
					for _, cip := range c.IPAddresses {
						found = found || cip.Equal(ip)
					}
					ok = ok && found
				}
				if _, kerr := os.Stat(keyPath); ok && kerr == nil {
					return certPath, keyPath, nil
				}
			}
		}
	}
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	tpl := x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "Gym Art Segreteria", Organization: []string{"A.S.D. Gym Art Avezzano"}},
		NotBefore: r.now().Add(-time.Hour), NotAfter: r.now().Add(certDays * 24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true, DNSNames: names, IPAddresses: ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, &tpl, &tpl, &priv.PublicKey, priv)
	if err != nil {
		return "", "", err
	}
	kb, _ := x509.MarshalECPrivateKey(priv)
	if err := writeAtomic(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})); err != nil {
		return "", "", err
	}
	if err := writeAtomic(keyPath, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb})); err != nil {
		return "", "", err
	}
	return certPath, keyPath, nil
}

// Certificato returns the certificate in use (PEM), so that a phone can be told to trust it.
func (r *Rete) Certificato() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.leaf
}

/* ---------- listener ---------- */

// Avvia starts listening on the network with the given handler. Failure is not fatal: the reason is kept for the page.
func (r *Rete) Avvia(h http.Handler) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
	r.errMsg = ""
	if !r.cfg.Attiva || !r.hasPassword() {
		return
	}
	var certPath, keyPath string
	if _, e1 := os.Stat(filepath.Join(r.dir, certFile)); e1 == nil {
		if _, e2 := os.Stat(filepath.Join(r.dir, keyFile)); e2 == nil {
			certPath, keyPath, r.kind = filepath.Join(r.dir, certFile), filepath.Join(r.dir, keyFile), "fornito"
		}
	}
	if certPath == "" {
		var err error
		if certPath, keyPath, err = r.selfSigned(); err != nil {
			r.errMsg = "Non riesco a preparare il certificato: " + err.Error()
			logErrore("rete", "%s", r.errMsg)
			return
		}
		r.kind = "autofirmato"
	}
	fc := &fileCert{cert: certPath, key: keyPath}
	if _, err := fc.get(nil); err != nil {
		r.errMsg = "Certificato non valido: " + err.Error()
		logErrore("rete", "%s", r.errMsg)
		return
	}
	r.leaf, _ = os.ReadFile(certPath)
	r.names = leafNames(r.leaf)
	ln, err := net.Listen("tcp", ":"+strconv.Itoa(r.cfg.Porta))
	if err != nil {
		r.errMsg = fmt.Sprintf("Non riesco ad ascoltare sulla porta %d: %v. Un'altra copia del programma o un altro programma la sta usando.", r.cfg.Porta, err)
		logErrore("rete", "%s", r.errMsg)
		return
	}
	r.port = ln.Addr().(*net.TCPAddr).Port
	r.ln = tls.NewListener(ln, &tls.Config{GetCertificate: fc.get, MinVersion: tls.VersionTLS12})
	r.srv = &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	go r.srv.Serve(r.ln)
	logInfo("rete", "accesso dal telefono acceso: porta %d, certificato %s", r.port, r.kind)
}

func (r *Rete) stopLocked() {
	if r.srv != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		r.srv.Shutdown(ctx)
		cancel()
		r.srv.Close()
	}
	r.srv, r.ln, r.port, r.kind, r.leaf = nil, nil, 0, "", nil
}

// Ferma stops listening on the network and ends every session.
func (r *Rete) Ferma() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
	r.sessions = map[string]time.Time{}
}

// Stato describes the network access for the page.
func (r *Rete) Stato() ReteStato {
	r.mu.Lock()
	defer r.mu.Unlock()
	st := ReteStato{Attiva: r.cfg.Attiva, Porta: r.cfg.Porta, HaPassword: r.hasPassword(), InAscolto: r.srv != nil, Certificato: r.kind, Errore: r.errMsg, Sessioni: len(r.sessions), Indirizzi: []string{}}
	if r.srv != nil {
		for _, ip := range r.addrs() {
			st.Indirizzi = append(st.Indirizzi, "https://"+ip.String()+":"+strconv.Itoa(r.port))
		}
		if r.hostname != "" {
			st.Indirizzi = append(st.Indirizzi, "https://"+r.hostname+":"+strconv.Itoa(r.port))
		}
		for _, n := range r.names {
			if n != "localhost" && !strings.EqualFold(n, r.hostname) {
				st.Indirizzi = append(st.Indirizzi, "https://"+n+":"+strconv.Itoa(r.port))
			}
		}
	}
	return st
}

// Configura changes the network settings. Switching on needs a password: the one already set or a new one.
// Changing or removing a password that exists needs the current one.
func (r *Rete) Configura(attiva bool, attuale, nuova string, porta int, h http.Handler) error {
	r.mu.Lock()
	if porta != 0 && (porta < 1024 || porta > 65535) {
		r.mu.Unlock()
		return errors.New("la porta deve essere tra 1024 e 65535")
	}
	cfg := r.cfg
	if nuova != "" {
		if r.hasPassword() {
			r.mu.Unlock()
			if !r.Verifica(attuale) {
				return ErrWrongPassword
			}
			r.mu.Lock()
		}
		if err := r.setPassword(nuova); err != nil {
			r.cfg = cfg
			r.mu.Unlock()
			return err
		}
		r.sessions = map[string]time.Time{} // a new password sends every device back to the login
	}
	if attiva && !r.hasPassword() {
		r.cfg = cfg
		r.mu.Unlock()
		return errors.New("scegli prima una password di almeno 8 caratteri")
	}
	if porta != 0 {
		r.cfg.Porta = porta
	}
	r.cfg.Attiva = attiva
	err := r.save()
	r.mu.Unlock()
	if err != nil {
		return fmt.Errorf("non riesco a salvare le impostazioni di rete: %w", err)
	}
	if attiva {
		r.Avvia(h)
	} else {
		r.Ferma()
		logInfo("rete", "accesso dal telefono spento")
	}
	return nil
}

// fingerprint is shown next to the certificate so that it can be compared with the one the phone reports.
func fingerprint(pemData []byte) string {
	b, _ := pem.Decode(pemData)
	if b == nil {
		return ""
	}
	sum := sha256.Sum256(b.Bytes)
	parts := make([]string, 0, 32)
	for _, x := range sum {
		parts = append(parts, fmt.Sprintf("%02X", x))
	}
	return strings.Join(parts, ":")
}
