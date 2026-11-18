package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

const retePass = "palestra-2026"
const remoteHost = "192.168.1.5:47816"

// reteServer is a server whose network access is on (without a real listener) and which never waits after a wrong password.
func reteServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	srv, h := newTestServer(t)
	srv.failDelay = 0
	srv.rete.cfg.Attiva = true
	if err := srv.rete.setPassword(retePass); err != nil {
		t.Fatal(err)
	}
	return srv, h
}

func rcall(method, target, body string) call {
	return call{method: method, target: target, body: body, host: remoteHost, remote: true}
}

func login(t *testing.T, h http.Handler, pass string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"password": pass})
	return do(h, rcall("POST", "/login", string(b)))
}

func sessionCookie(t *testing.T, r *http.Response) string {
	t.Helper()
	for _, c := range r.Cookies() {
		if c.Name == cookieRete && c.Value != "" {
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.MaxAge <= 0 {
				t.Fatalf("session cookie: %+v", c)
			}
			return c.Name + "=" + c.Value
		}
	}
	t.Fatal("no session cookie")
	return ""
}

func TestRemoteIsRefusedWhileNetworkAccessIsOff(t *testing.T) {
	_, h := newTestServer(t)
	for _, target := range []string{"/", "/login", "/api/stato", "/app.js", "/certificato"} {
		if r := do(h, rcall("GET", target, "")); r.StatusCode != 403 {
			t.Errorf("%s: %d", target, r.StatusCode)
		}
	}
}

func TestLoginSessionAndWhatARemoteDeviceMayDo(t *testing.T) {
	srv, h := reteServer(t)
	if r := do(h, rcall("GET", "/login", "")); r.StatusCode != 200 || !strings.Contains(text(r), "Password") {
		t.Fatalf("login page: %d", r.StatusCode)
	}
	if r := do(h, rcall("GET", "/", "")); r.StatusCode != 303 || r.Header.Get("Location") != "/login" {
		t.Fatalf("index without login: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	c := rcall("GET", "/api/stato", "")
	c.token = testToken
	if r := do(h, c); r.StatusCode != 401 {
		t.Fatalf("data without a session, even with the token: %d", r.StatusCode)
	}
	if r := login(t, h, "sbagliata-di-sicuro"); r.StatusCode != 401 {
		t.Fatalf("wrong password: %d", r.StatusCode)
	}
	if r := login(t, h, ""); r.StatusCode != 401 {
		t.Fatalf("empty password: %d", r.StatusCode)
	}
	ok := login(t, h, retePass)
	if ok.StatusCode != 200 {
		t.Fatalf("right password: %d", ok.StatusCode)
	}
	ck := sessionCookie(t, ok)

	idx := rcall("GET", "/", "")
	idx.cookie = ck
	if r := do(h, idx); r.StatusCode != 200 || !strings.Contains(text(r), testToken) {
		t.Fatalf("index with a session: %d", r.StatusCode)
	}
	// the session alone is not enough for the data: the token is needed too
	api := rcall("GET", "/api/stato", "")
	api.cookie = ck
	if r := do(h, api); r.StatusCode != 401 {
		t.Fatalf("session without token: %d", r.StatusCode)
	}
	api.token = testToken
	r := do(h, api)
	st := jsonBody(t, r)
	if r.StatusCode != 200 || st["remoto"] != true || st["sceltaCartella"] != false {
		t.Fatalf("state for a remote device: %d %v", r.StatusCode, st)
	}
	// saving works from the phone
	save := rcall("POST", "/api/salva", `{"rev":0,"db":{"allieve":[]}}`)
	save.cookie, save.token = ck, testToken
	if r := do(h, save); r.StatusCode != 200 {
		t.Fatalf("save from a remote device: %d", r.StatusCode)
	}
	// what belongs to the computer of the secretary is closed to the phone
	for _, p := range []string{"/api/copia", "/api/rete", "/api/password", "/api/apri-cartella", "/api/copie2", "/api/scegli-cartella", "/api/sblocca", "/api/decifra", "/api/rete/esci-tutti", "/api/sicurezza/adesso", "/api/sicurezza/controlla", "/api/sicurezza/letto", "/api/giornaliere", "/api/giornaliere/archivio"} {
		for _, m := range []string{"GET", "POST"} {
			x := rcall(m, p, `{}`)
			x.cookie, x.token = ck, testToken
			if r := do(h, x); r.StatusCode != 403 {
				t.Errorf("%s %s from a phone: %d", m, p, r.StatusCode)
			}
		}
	}
	// logout ends the session
	out := rcall("POST", "/logout", "")
	out.cookie = ck
	do(h, out)
	if r := do(h, idx); r.StatusCode != 303 {
		t.Fatalf("index after logout: %d", r.StatusCode)
	}
	if srv.rete.Stato().Sessioni != 0 {
		t.Fatal("session kept after logout")
	}
}

func TestWrongPasswordsSlowDownTheAddressNotTheOthers(t *testing.T) {
	srv, h := reteServer(t)
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	srv.rete.now = func() time.Time { return now }
	for i := 0; i < maxFails; i++ {
		if r := login(t, h, "no"+strconv.Itoa(i)); r.StatusCode != 401 {
			t.Fatalf("try %d: %d", i, r.StatusCode)
		}
	}
	r := login(t, h, retePass) // even the right one has to wait now
	if r.StatusCode != 429 || r.Header.Get("Retry-After") == "" || !strings.Contains(text(r), "Troppi tentativi") {
		t.Fatalf("locked: %d", r.StatusCode)
	}
	other := rcall("POST", "/login", `{"password":"`+retePass+`"}`)
	other.remote = true
	// another device is not affected: same handler, other address
	other2 := other
	other2.method = "POST"
	req := httpRequestFrom("10.0.0.7:5555", "/login", `{"password":"`+retePass+`"}`)
	if rec := serve(h, req); rec.Code != 200 {
		t.Fatalf("another address: %d", rec.Code)
	}
	now = now.Add(61 * time.Second)
	if r := login(t, h, retePass); r.StatusCode != 200 {
		t.Fatalf("after the wait: %d", r.StatusCode)
	}
	// the waiting grows: failing again right after a wait doubles it
	for i := 0; i < maxFails; i++ {
		login(t, h, "no")
	}
	now = now.Add(61 * time.Second)
	if r := login(t, h, "ancora-no"); r.StatusCode != 401 {
		t.Fatalf("one more wrong try after the wait: %d", r.StatusCode)
	}
	if w := srv.rete.Attesa("192.168.1.50"); w < 100*time.Second {
		t.Fatalf("second lock too short: %v", w)
	}
}

func TestHostsAndOriginsFromTheNetwork(t *testing.T) {
	srv, h := reteServer(t)
	srv.rete.hostname = "SEGRETERIA-PC"
	for host, want := range map[string]int{
		"192.168.1.5:47816": 200, "100.101.102.103:47816": 200, "[fd7a:115c::1]:47816": 200,
		"segreteria-pc:47816": 200, "segreteria-pc.local:47816": 200, "pc.tail1234.ts.net:47816": 200,
		"cattivo.example:47816": 403, "evil.com": 403, "": 403, ".local": 403,
	} {
		c := call{method: "GET", target: "/login", host: host, remote: true}
		if host == "" {
			c.host = " "
		}
		if r := do(h, c); r.StatusCode != want {
			t.Errorf("host %q: %d, want %d", host, r.StatusCode, want)
		}
	}
	srv.rete.cfg.HostExtra = []string{"gym.example.org"}
	if r := do(h, call{method: "GET", target: "/login", host: "gym.example.org", remote: true}); r.StatusCode != 200 {
		t.Errorf("host added by hand: %d", r.StatusCode)
	}
	c := rcall("POST", "/login", `{"password":"x"}`)
	c.origin = "https://cattivo.example"
	if r := do(h, c); r.StatusCode != 403 {
		t.Errorf("foreign origin: %d", r.StatusCode)
	}
	c.origin = "https://" + remoteHost
	if r := do(h, c); r.StatusCode != 401 {
		t.Errorf("own origin: %d", r.StatusCode)
	}
	// from this computer, the network host names are not accepted
	if r := do(h, call{method: "GET", target: "/login", host: remoteHost}); r.StatusCode != 403 {
		t.Errorf("local request with a network Host: %d", r.StatusCode)
	}
}

func TestSessionsExpire(t *testing.T) {
	srv, h := reteServer(t)
	now := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	srv.rete.now = func() time.Time { return now }
	ck := sessionCookie(t, login(t, h, retePass))
	idx := rcall("GET", "/", "")
	idx.cookie = ck
	now = now.Add(sessionTTL - time.Hour)
	if r := do(h, idx); r.StatusCode != 200 {
		t.Fatalf("used before it expires: %d", r.StatusCode)
	}
	now = now.Add(sessionTTL - time.Hour) // using it renewed it
	if r := do(h, idx); r.StatusCode != 200 {
		t.Fatalf("renewed by use: %d", r.StatusCode)
	}
	now = now.Add(sessionTTL + time.Hour)
	if r := do(h, idx); r.StatusCode != 303 {
		t.Fatalf("not used for two weeks: %d", r.StatusCode)
	}
}

func TestConfigureNetworkAccess(t *testing.T) {
	dir := t.TempDir()
	srv, h := newTestServer(t)
	_ = dir
	r := srv.rete
	r.addrs = func() []net.IP { return []net.IP{net.ParseIP("192.168.1.5")} }
	free := freePort(t)
	if err := r.Configura(true, "", "", free, h); err == nil || !strings.Contains(err.Error(), "password") {
		t.Fatalf("switching on without a password: %v", err)
	}
	if err := r.Configura(true, "", "corta", free, h); err == nil {
		t.Fatal("a short password was accepted")
	}
	if err := r.Configura(true, "", retePass, 80, h); err == nil {
		t.Fatal("a port below 1024 was accepted")
	}
	if r.Attiva() || r.Stato().InAscolto {
		t.Fatal("refused settings were kept")
	}
	if err := r.Configura(true, "", retePass, free, h); err != nil {
		t.Fatal(err)
	}
	defer r.Ferma()
	st := r.Stato()
	if !st.Attiva || !st.InAscolto || !st.HaPassword || st.Porta != free || st.Certificato != "autofirmato" || st.Errore != "" {
		t.Fatalf("state: %+v", st)
	}
	if len(st.Indirizzi) == 0 || st.Indirizzi[0] != "https://192.168.1.5:"+strconv.Itoa(free) {
		t.Fatalf("addresses: %v", st.Indirizzi)
	}
	// the file holds a hash, never the password
	raw, _ := os.ReadFile(filepath.Join(srv.store.Dir(), reteFile))
	if strings.Contains(string(raw), retePass) || !strings.Contains(string(raw), `"hash"`) {
		t.Fatalf("rete.json: %s", raw)
	}
	again := OpenRete(srv.store.Dir())
	if !again.Verifica(retePass) || again.Verifica("altra-password") || !again.Attiva() || again.cfg.Porta != free {
		t.Fatal("settings not read back")
	}
	// changing the password needs the current one, and sends every device back to the login
	r.NuovaSessione()
	if err := r.Configura(true, "non-la-so", "nuova-password-1", 0, h); err != ErrWrongPassword {
		t.Fatalf("change with a wrong current password: %v", err)
	}
	if err := r.Configura(true, retePass, "nuova-password-1", 0, h); err != nil {
		t.Fatal(err)
	}
	if !r.Verifica("nuova-password-1") || r.Verifica(retePass) || r.Stato().Sessioni != 0 {
		t.Fatal("password change not applied")
	}
	// switching off stops listening and ends sessions
	if err := r.Configura(false, "", "", 0, h); err != nil {
		t.Fatal(err)
	}
	if st := r.Stato(); st.Attiva || st.InAscolto || !st.HaPassword {
		t.Fatalf("after switching off: %+v", st)
	}
	if c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(free), time.Second); err == nil {
		c.Close()
		t.Fatal("still listening")
	}
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

func TestNetworkListenerSpeaksTLSWithOwnCertificate(t *testing.T) {
	srv, h := newTestServer(t)
	srv.isLocal = func(*http.Request) bool { return false } // the test client is on this computer: pretend it is not
	r := srv.rete
	ips := []net.IP{net.ParseIP("192.168.1.5")}
	r.addrs = func() []net.IP { return ips }
	port := freePort(t)
	if err := r.Configura(true, "", retePass, port, h); err != nil {
		t.Fatal(err)
	}
	defer r.Ferma()
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(r.Certificato()) {
		t.Fatal("no certificate")
	}
	cl := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, ServerName: "127.0.0.1"}}}
	resp, err := cl.Get("https://127.0.0.1:" + strconv.Itoa(port) + "/login")
	if err != nil {
		t.Fatalf("TLS request: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(body), "Password") || resp.TLS == nil {
		t.Fatalf("login over TLS: %d", resp.StatusCode)
	}
	if resp.Header.Get("Strict-Transport-Security") == "" {
		t.Fatal("no HSTS on a network answer")
	}
	// plain HTTP on that port is not answered as a web page
	if c, err := (&http.Client{Timeout: 2 * time.Second}).Get("http://127.0.0.1:" + strconv.Itoa(port) + "/login"); err == nil {
		b, _ := io.ReadAll(c.Body)
		c.Body.Close()
		if c.StatusCode == 200 && strings.Contains(string(b), "Password") {
			t.Fatal("the login page was served without TLS")
		}
	}
	// /certificato gives the same certificate
	cr, err := cl.Get("https://127.0.0.1:" + strconv.Itoa(port) + "/certificato")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(cr.Body)
	cr.Body.Close()
	if string(got) != string(r.Certificato()) || cr.Header.Get("Content-Type") != "application/x-x509-ca-cert" {
		t.Fatalf("certificate download: %d %s", cr.StatusCode, cr.Header.Get("Content-Type"))
	}
	if fp := fingerprint(r.Certificato()); len(fp) != 95 {
		t.Fatalf("fingerprint: %q", fp)
	}
	// the certificate is kept between runs, and made again when this computer gets a new address
	first := string(r.Certificato())
	r.Avvia(h)
	if string(r.Certificato()) != first {
		t.Fatal("the certificate was made again without a reason")
	}
	ips = []net.IP{net.ParseIP("192.168.1.5"), net.ParseIP("10.9.8.7")}
	r.Avvia(h)
	if string(r.Certificato()) == first {
		t.Fatal("a new address needs a new certificate")
	}
	b, _ := pemFirst(r.Certificato())
	found := false
	for _, ip := range b.IPAddresses {
		found = found || ip.String() == "10.9.8.7"
	}
	if !found || b.NotAfter.Sub(time.Now()) < 700*24*time.Hour {
		t.Fatalf("certificate: %v %v", b.IPAddresses, b.NotAfter)
	}
}

func pemFirst(p []byte) (*x509.Certificate, error) {
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(p)
	blk, _ := pem.Decode(p)
	return x509.ParseCertificate(blk.Bytes)
}

func TestProvidedCertificateIsUsedAndNewDatesPickedUp(t *testing.T) {
	srv, h := newTestServer(t)
	srv.isLocal = func(*http.Request) bool { return false }
	r := srv.rete
	r.addrs = func() []net.IP { return nil }
	dir := srv.store.Dir()
	// a certificate "given by the user": make one with our own function, then copy it under the names the program looks for
	c, k, err := r.selfSigned()
	if err != nil {
		t.Fatal(err)
	}
	cb, _ := os.ReadFile(c)
	kb, _ := os.ReadFile(k)
	os.WriteFile(filepath.Join(dir, certFile), cb, 0o600)
	os.WriteFile(filepath.Join(dir, keyFile), kb, 0o600)
	os.Remove(c)
	os.Remove(k)
	port := freePort(t)
	if err := r.Configura(true, "", retePass, port, h); err != nil {
		t.Fatal(err)
	}
	defer r.Ferma()
	if st := r.Stato(); st.Certificato != "fornito" || !st.InAscolto {
		t.Fatalf("state: %+v", st)
	}
	if _, err := os.Stat(c); err == nil {
		t.Fatal("a self-signed certificate was made although one was provided")
	}
	if r := (&Rete{}); r.Attiva() {
		t.Fatal("a nil-like Rete is active")
	}
}

func TestPortInUseIsReportedNotFatal(t *testing.T) {
	srv, h := newTestServer(t)
	srv.rete.addrs = func() []net.IP { return nil }
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	port := l.Addr().(*net.TCPAddr).Port
	if err := srv.rete.Configura(true, "", retePass, port, h); err != nil {
		t.Fatalf("the settings are saved even if the port is busy: %v", err)
	}
	st := srv.rete.Stato()
	if !st.Attiva || st.InAscolto || !strings.Contains(st.Errore, "porta") {
		t.Fatalf("state: %+v", st)
	}
}

func TestProgramStaysOpenWhileNetworkAccessIsOn(t *testing.T) {
	srv, h := reteServer(t)
	srv.autoExit = true
	do(h, call{method: "POST", target: "/api/vivo?id=a", token: testToken})
	do(h, call{method: "POST", target: "/api/chiudi?id=a&t=" + testToken})
	if srv.shouldExit(time.Now().Add(time.Hour)) {
		t.Fatal("closing the window must not stop a program that serves the phones")
	}
	srv.rete.cfg.Attiva = false
	srv.shouldExit(time.Now().Add(time.Hour)) // starts the grace period
	if !srv.shouldExit(time.Now().Add(time.Hour + emptyGrace + time.Second)) {
		t.Fatal("without network access the program stops when the window closes")
	}
}

func TestNetworkSettingsOnlyFromThisComputer(t *testing.T) {
	srv, h := newTestServer(t)
	srv.rete.addrs = func() []net.IP { return nil }
	post := func(body string) *http.Response {
		return do(h, call{method: "POST", target: "/api/rete", token: testToken, body: body})
	}
	if r := post(`{"attiva":true}`); r.StatusCode != 400 || !strings.Contains(text(r), "password") {
		t.Fatalf("no password: %d", r.StatusCode)
	}
	port := freePort(t)
	r := post(`{"attiva":true,"nuova":"` + retePass + `","porta":` + strconv.Itoa(port) + `}`)
	st := jsonBody(t, r)
	if r.StatusCode != 200 || st["stato"].(map[string]any)["inAscolto"] != true {
		t.Fatalf("switch on: %d %v", r.StatusCode, st)
	}
	defer srv.rete.Ferma()
	g := do(h, call{method: "GET", target: "/api/rete", token: testToken})
	if gs := jsonBody(t, g); g.StatusCode != 200 || gs["impronta"] == "" || gs["avvioDisponibile"] != false {
		t.Fatalf("status: %d %v", g.StatusCode, gs)
	}
	if r := post(`{"attiva":false}`); r.StatusCode != 200 || jsonBody(t, r)["stato"].(map[string]any)["inAscolto"] != false {
		t.Fatalf("switch off: %d", r.StatusCode)
	}
	if r := post(`{"attiva":true,"nuova":"un-altra-password","attuale":"sbagliata"}`); r.StatusCode != 401 {
		t.Fatalf("password change with a wrong one: %d", r.StatusCode)
	}
	if r := do(h, call{method: "POST", target: "/api/rete/avvio", token: testToken, body: `{"attiva":true}`}); r.StatusCode != http.StatusNotImplemented {
		t.Fatalf("start with Windows where there is none: %d", r.StatusCode)
	}
}

func httpRequestFrom(remote, target, body string) *http.Request {
	r, _ := http.NewRequest("POST", target, strings.NewReader(body))
	r.RemoteAddr, r.Host = remote, remoteHost
	r.RequestURI = target
	return r
}

func serve(h http.Handler, r *http.Request) *responseRec {
	rec := &responseRec{header: http.Header{}, Code: 200}
	h.ServeHTTP(rec, r)
	return rec
}

type responseRec struct {
	header http.Header
	Code   int
	body   strings.Builder
}

func (r *responseRec) Header() http.Header         { return r.header }
func (r *responseRec) WriteHeader(c int)           { r.Code = c }
func (r *responseRec) Write(b []byte) (int, error) { return r.body.Write(b) }

func TestPhonesDoNotKeepTheProgramOpen(t *testing.T) {
	srv, h := reteServer(t)
	srv.autoExit = true
	c := rcall("POST", "/api/vivo?id=telefono", "")
	c.token = testToken
	c.cookie = sessionCookieFor(t, srv)
	if r := do(h, c); r.StatusCode != 204 {
		t.Fatalf("heartbeat from a phone: %d", r.StatusCode)
	}
	srv.mu.Lock()
	n := len(srv.clients)
	srv.mu.Unlock()
	if n != 0 {
		t.Fatalf("a phone was counted as a window: %d", n)
	}
}

func sessionCookieFor(t *testing.T, srv *Server) string {
	t.Helper()
	return cookieRete + "=" + srv.rete.NuovaSessione()
}
