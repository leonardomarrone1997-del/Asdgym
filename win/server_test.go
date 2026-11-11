package main

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
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
	_, h := newTestServer(t)
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
