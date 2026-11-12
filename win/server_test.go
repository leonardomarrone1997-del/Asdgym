package main

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

const testHost = "127.0.0.1:47815"
const testToken = "segreto-di-prova"

func newTestServer(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	static := fstest.MapFS{
		"index.html": {Data: []byte(`<meta name="gymart-token" content="__TOKEN__">`)},
		"app.js":     {Data: []byte(`console.log(1)`)},
		"segreto.go": {Data: []byte(`package x`)},
	}
	srv, err := NewServer(mustOpen(t, t.TempDir()), static, testHost, testToken, "prova")
	if err != nil {
		t.Fatal(err)
	}
	return srv, srv.Handler()
}

type call struct {
	method, target, body, host, token, origin string
}

func do(h http.Handler, c call) *http.Response {
	req := httptest.NewRequest(c.method, c.target, strings.NewReader(c.body))
	req.Host = c.host
	if c.host == "" {
		req.Host = testHost
	}
	if c.token != "" {
		req.Header.Set(tokenHeader, c.token)
	}
	if c.origin != "" {
		req.Header.Set("Origin", c.origin)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

func text(r *http.Response) string { b, _ := io.ReadAll(r.Body); return string(b) }

func TestIndexCarriesTokenAndStaticTypes(t *testing.T) {
	_, h := newTestServer(t)
	r := do(h, call{method: "GET", target: "/"})
	if r.StatusCode != 200 || !strings.Contains(text(r), testToken) || !strings.HasPrefix(r.Header.Get("Content-Type"), "text/html") {
		t.Fatalf("index: %d %s", r.StatusCode, r.Header.Get("Content-Type"))
	}
	r = do(h, call{method: "GET", target: "/app.js"})
	if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), "text/javascript") {
		t.Fatalf("app.js: %d %s", r.StatusCode, r.Header.Get("Content-Type"))
	}
	for _, target := range []string{"/segreto.go", "/index.html", "/manca.js"} {
		if r := do(h, call{method: "GET", target: target}); r.StatusCode != 404 {
			t.Fatalf("%s: %d", target, r.StatusCode)
		}
	}
	// a path that climbs out is cleaned by the router and never served
	if r := do(h, call{method: "GET", target: "/../store.go"}); r.StatusCode == 200 {
		t.Fatalf("/../store.go was served")
	}
}

func TestGuardRejectsStrangers(t *testing.T) {
	_, h := newTestServer(t)
	cases := []struct {
		name string
		c    call
		want int
	}{
		{"no token", call{method: "GET", target: "/api/stato"}, 401},
		{"wrong token", call{method: "GET", target: "/api/stato", token: "altro"}, 401},
		{"other host (DNS rebinding)", call{method: "GET", target: "/api/stato", token: testToken, host: "cattivo.example:47815"}, 403},
		{"localhost alias", call{method: "GET", target: "/", host: "localhost:47815"}, 403},
		{"other origin", call{method: "POST", target: "/api/salva", token: testToken, origin: "https://cattivo.example", body: `{}`}, 403},
		{"token in query is not enough for data", call{method: "GET", target: "/api/stato?t=" + testToken}, 401},
		{"good", call{method: "GET", target: "/api/stato", token: testToken, origin: "http://" + testHost}, 200},
	}
	for _, tc := range cases {
		if r := do(h, tc.c); r.StatusCode != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, r.StatusCode, tc.want)
		}
	}
}

func TestSaveStateRegistroRoundTrip(t *testing.T) {
	srv, h := newTestServer(t)
	r := do(h, call{method: "GET", target: "/api/stato", token: testToken})
	var st struct {
		Rev      int64
		DB       json.RawMessage
		Cartella string
	}
	if err := json.Unmarshal([]byte(text(r)), &st); err != nil || st.Rev != 0 || string(st.DB) != "null" || st.Cartella == "" {
		t.Fatalf("empty state: %+v (%v)", st, err)
	}

	body := `{"rev":0,"db":{"allieve":[{"id":"0001","name":"Rossi Maria"}]},"registro":[{"allieva":"Rossi Maria","operazione":"Nuova allieva"}]}`
	r = do(h, call{method: "POST", target: "/api/salva", token: testToken, body: body})
	if r.StatusCode != 200 || !strings.Contains(text(r), `"rev":1`) {
		t.Fatalf("save: %d", r.StatusCode)
	}
	// the same revision again is a conflict, and nothing is written
	r = do(h, call{method: "POST", target: "/api/salva", token: testToken, body: body})
	if r.StatusCode != 409 {
		t.Fatalf("second save with a stale revision: %d", r.StatusCode)
	}
	r = do(h, call{method: "POST", target: "/api/salva", token: testToken, body: `{"rev":1,"db":[1,2]}`})
	if r.StatusCode != 500 && r.StatusCode != 400 {
		t.Fatalf("archive that is not an object: %d", r.StatusCode)
	}
	r = do(h, call{method: "POST", target: "/api/salva", token: testToken, body: `non json`})
	if r.StatusCode != 400 {
		t.Fatalf("garbage: %d", r.StatusCode)
	}

	r = do(h, call{method: "GET", target: "/api/stato", token: testToken})
	if s := text(r); !strings.Contains(s, `"rev":1`) || !strings.Contains(s, `Rossi Maria`) {
		t.Fatalf("state after save: %s", s)
	}
	if names := srv.store.copyNames(); len(names) != 0 {
		t.Fatalf("no copy expected yet: %v", names)
	}
	// "copia": true keeps the archive as it was, whatever the time of the last copy
	r = do(h, call{method: "POST", target: "/api/salva", token: testToken, body: `{"rev":1,"db":{"allieve":[]},"copia":true}`})
	if r.StatusCode != 200 {
		t.Fatalf("save with a forced copy: %d", r.StatusCode)
	}
	if names := srv.store.copyNames(); len(names) != 1 {
		t.Fatalf("forced copy: %v", names)
	}
	r = do(h, call{method: "GET", target: "/api/registro", token: testToken})
	if s := text(r); strings.Count(s, `"operazione":"Nuova allieva"`) != 1 {
		t.Fatalf("registro: %s", s)
	}
}

func TestExitsWhenLastWindowCloses(t *testing.T) {
	srv, h := newTestServer(t)
	srv.autoExit = true
	t0 := time.Now()

	if srv.shouldExit(t0.Add(time.Minute)) {
		t.Fatal("must wait for the first window")
	}
	if !srv.shouldExit(t0.Add(startGrace + time.Second)) {
		t.Fatal("must give up if no window ever appears")
	}

	do(h, call{method: "POST", target: "/api/vivo?id=a", token: testToken})
	do(h, call{method: "POST", target: "/api/vivo?id=b", token: testToken})
	if srv.shouldExit(time.Now()) {
		t.Fatal("two windows open")
	}
	do(h, call{method: "POST", target: "/api/chiudi?id=a&t=" + testToken})
	if srv.shouldExit(time.Now()) {
		t.Fatal("one window still open")
	}
	if r := do(h, call{method: "POST", target: "/api/chiudi?id=b&t=sbagliato"}); r.StatusCode != 401 {
		t.Fatalf("closing needs the token: %d", r.StatusCode)
	}
	do(h, call{method: "POST", target: "/api/chiudi?id=b&t=" + testToken})
	now := time.Now()
	if srv.shouldExit(now) {
		t.Fatal("a reload must have time to come back")
	}
	// a reload: the page comes back within the grace period
	do(h, call{method: "POST", target: "/api/vivo?id=c", token: testToken})
	if srv.shouldExit(now.Add(emptyGrace + time.Second)) {
		t.Fatal("the page came back")
	}
	// a window that stops answering (crash) is forgotten
	if srv.shouldExit(time.Now().Add(clientStale + time.Second)) {
		t.Fatal("first tick after the window vanished only starts the grace period")
	}
	if !srv.shouldExit(time.Now().Add(clientStale + emptyGrace + 2*time.Second)) {
		t.Fatal("must exit after the last window is gone")
	}
}

func TestSuspensionDoesNotCloseTheProgram(t *testing.T) {
	srv, h := newTestServer(t)
	srv.autoExit = true
	do(h, call{method: "POST", target: "/api/vivo?id=a", token: testToken})
	// the computer sleeps for a day: on waking the window's ping is late, not missing
	wake := time.Now().Add(24 * time.Hour)
	srv.afterSleep(wake)
	if srv.shouldExit(wake) || srv.shouldExit(wake.Add(emptyGrace+time.Second)) {
		t.Fatal("the program must wait for the window to ping again after a suspension")
	}
	// without that, the same wake-up would have dropped the window
	srv2, h2 := newTestServer(t)
	srv2.autoExit = true
	do(h2, call{method: "POST", target: "/api/vivo?id=a", token: testToken})
	srv2.shouldExit(wake)
	if !srv2.shouldExit(wake.Add(emptyGrace + time.Second)) {
		t.Fatal("the test no longer shows what afterSleep prevents")
	}
}

func TestOpenIsRateLimitedAndMarked(t *testing.T) {
	srv, h := newTestServer(t)
	opened := 0
	srv.openWindow = func() { opened++ }
	for i := 0; i < 3; i++ {
		r := do(h, call{method: "GET", target: "/__apri"})
		if r.Header.Get(appHeader) != "1" {
			t.Fatal("answers must be marked")
		}
	}
	if opened != 1 {
		t.Fatalf("opened %d windows", opened)
	}
}

var _ fs.FS = fstest.MapFS{}

func jsonBody(t *testing.T, r *http.Response) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(text(r)), &m); err != nil {
		t.Fatalf("not JSON: %v", err)
	}
	return m
}

func TestPasswordFlowOverHTTP(t *testing.T) {
	srv, h := newTestServer(t)
	post := func(target, body string) *http.Response {
		return do(h, call{method: "POST", target: target, token: testToken, body: body})
	}
	if r := post("/api/password", `{"attuale":"","nuova":"prima-password"}`); r.StatusCode == 200 {
		t.Fatal("an empty archive was protected")
	}
	post("/api/salva", `{"rev":0,"db":{"allieve":[{"id":"0001","name":"Rossi Maria"}]},"registro":[{"allieva":"Rossi Maria","operazione":"Nuova allieva"}]}`)
	if r := post("/api/password", `{"attuale":"","nuova":"corta"}`); r.StatusCode != 400 {
		t.Fatalf("short password: %d", r.StatusCode)
	}
	if r := post("/api/password", `{"attuale":"","nuova":"prima-password"}`); r.StatusCode != 200 || jsonBody(t, r)["protetto"] != true {
		t.Fatalf("protect: %d", r.StatusCode)
	}
	st := jsonBody(t, do(h, call{method: "GET", target: "/api/stato", token: testToken}))
	if st["protetto"] != true || st["bloccato"] != nil {
		t.Fatalf("state after protecting: %v", st)
	}
	// the downloadable copy is the encrypted file
	copia := jsonBody(t, do(h, call{method: "GET", target: "/api/copia", token: testToken}))
	testo, _ := copia["testo"].(string)
	if copia["protetto"] != true || strings.Contains(testo, "Rossi") || !strings.Contains(testo, `"gymart":"cifrato"`) {
		t.Fatalf("copy: %v", copia)
	}
	// and it can be read back for a restore without typing the password again
	body, _ := json.Marshal(map[string]string{"testo": testo})
	if r := post("/api/decifra", string(body)); r.StatusCode != 200 || !strings.Contains(text(r), "Rossi Maria") {
		t.Fatalf("decrypt own copy: %d", r.StatusCode)
	}

	// a restart: the same folder opens locked
	locked, err := NewServer(mustOpen(t, srv.store.Dir()), fstest.MapFS{"index.html": {Data: []byte("__TOKEN__")}}, testHost, testToken, "prova")
	if err != nil {
		t.Fatal(err)
	}
	lh := locked.Handler()
	lpost := func(target, body string) *http.Response {
		return do(lh, call{method: "POST", target: target, token: testToken, body: body})
	}
	st = jsonBody(t, do(lh, call{method: "GET", target: "/api/stato", token: testToken}))
	if st["bloccato"] != true || st["db"] != nil || st["rev"] != nil {
		t.Fatalf("locked state leaks data: %v", st)
	}
	for _, c := range []call{
		{method: "POST", target: "/api/salva", body: `{"rev":0,"db":{}}`},
		{method: "GET", target: "/api/registro"},
		{method: "GET", target: "/api/copia"},
		{method: "POST", target: "/api/decifra", body: `{"testo":"{}"}`},
		{method: "POST", target: "/api/password", body: `{"attuale":"prima-password","nuova":""}`},
	} {
		c.token = testToken
		if r := do(lh, c); r.StatusCode != http.StatusLocked {
			t.Fatalf("%s %s while locked: %d", c.method, c.target, r.StatusCode)
		}
	}
	if r := lpost("/api/sblocca", `{"password":"non-questa-qui"}`); r.StatusCode != 401 {
		t.Fatalf("wrong password: %d", r.StatusCode)
	}
	if r := lpost("/api/sblocca", `{"password":"prima-password"}`); r.StatusCode != 200 {
		t.Fatalf("unlock: %d", r.StatusCode)
	}
	st = jsonBody(t, do(lh, call{method: "GET", target: "/api/stato", token: testToken}))
	if st["rev"] != float64(1) || st["protetto"] != true {
		t.Fatalf("state after unlock: %v", st)
	}
	if r := do(lh, call{method: "GET", target: "/api/registro", token: testToken}); !strings.Contains(text(r), "Nuova allieva") {
		t.Fatal("log not readable after unlock")
	}
	// change, then remove
	if r := lpost("/api/password", `{"attuale":"sbagliata-ancora","nuova":"seconda-password"}`); r.StatusCode != 401 {
		t.Fatalf("change with a wrong current password: %d", r.StatusCode)
	}
	if r := lpost("/api/password", `{"attuale":"prima-password","nuova":"seconda-password"}`); r.StatusCode != 200 {
		t.Fatalf("change: %d", r.StatusCode)
	}
	if r := lpost("/api/password", `{"attuale":"seconda-password","nuova":""}`); r.StatusCode != 200 || jsonBody(t, r)["protetto"] != false {
		t.Fatalf("remove: %d", r.StatusCode)
	}
	copia = jsonBody(t, do(lh, call{method: "GET", target: "/api/copia", token: testToken}))
	if s, _ := copia["testo"].(string); !strings.Contains(s, "Rossi Maria") {
		t.Fatal("the copy is still encrypted after removing the password")
	}
}

func TestSecondFolderOverHTTP(t *testing.T) {
	srv, h := newTestServer(t)
	srv.mirror = OpenMirror(srv.store.Dir(), srv.store.ArchiveBytes)
	post := func(target, body string) *http.Response {
		return do(h, call{method: "POST", target: target, token: testToken, body: body})
	}
	dir := filepath.Join(t.TempDir(), "chiavetta")
	body, _ := json.Marshal(map[string]string{"cartella": dir})
	if r := post("/api/copie2", `{"cartella":"relativa"}`); r.StatusCode != 400 {
		t.Fatalf("relative folder: %d", r.StatusCode)
	}
	if r := post("/api/copie2", string(body)); r.StatusCode != 200 {
		t.Fatalf("set folder: %d %s", r.StatusCode, text(r))
	}
	post("/api/salva", `{"rev":0,"db":{"allieve":[{"id":"0001","name":"Rossi Maria"}]}}`)
	srv.mirror.Flush()
	items, _ := os.ReadDir(dir)
	if len(items) != 1 || !strings.HasPrefix(items[0].Name(), "gymart-") {
		t.Fatalf("no copy after a save: %v", items)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, items[0].Name()))
	if !strings.Contains(string(raw), "Rossi Maria") {
		t.Fatalf("copy content: %s", raw)
	}
	st := jsonBody(t, do(h, call{method: "GET", target: "/api/stato", token: testToken}))
	c2, _ := st["copie2"].(map[string]any)
	if c2["cartella"] != dir || c2["ultima"] == "" || c2["errore"] != "" {
		t.Fatalf("status: %v", st["copie2"])
	}
	// with a password, the copy in the second folder is encrypted as well
	post("/api/password", `{"attuale":"","nuova":"prima-password"}`)
	srv.mirror.Flush()
	raw, _ = os.ReadFile(filepath.Join(dir, items[0].Name()))
	if strings.Contains(string(raw), "Rossi") || !strings.Contains(string(raw), `"gymart":"cifrato"`) {
		t.Fatalf("the second copy is not encrypted: %.80s", raw)
	}
	// the folder goes away: saving still works, and the failure is reported
	os.RemoveAll(dir)
	os.WriteFile(dir, []byte("x"), 0o600)
	if r := post("/api/salva", `{"rev":1,"db":{"allieve":[]}}`); r.StatusCode != 200 {
		t.Fatalf("a save must not depend on the second folder: %d", r.StatusCode)
	}
	srv.mirror.Flush()
	if r := post("/api/copie2/adesso", ``); r.StatusCode != 500 || !strings.Contains(text(r), "Non riesco a scrivere") {
		t.Fatalf("copy now on a missing folder: %d", r.StatusCode)
	}
	if r := post("/api/scegli-cartella", ``); r.StatusCode != http.StatusNotImplemented {
		t.Fatalf("folder dialog where there is none: %d", r.StatusCode)
	}
	srv.pickFolder = func() (string, error) { return `E:\Copie`, nil }
	if r := post("/api/scegli-cartella", ``); r.StatusCode != 200 || !strings.Contains(text(r), `E:\\Copie`) {
		t.Fatalf("folder dialog: %d %s", r.StatusCode, text(r))
	}
}
