//go:build windows

package main

// Prove su Windows vero (1.29.0): partono solo con GYMART_PROVE_WINDOWS=1, sul computer Windows delle prove di GitHub
// (Actions › Prove › Run workflow, casella «Windows»). Aprono finestre e programmi veri: non vanno fatte su un computer in uso.

import (
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"testing/fstest"
	"time"
	"unsafe"
)

func soloSuWindowsVero(t *testing.T) {
	t.Helper()
	if os.Getenv("GYMART_PROVE_WINDOWS") != "1" {
		t.Skip("solo con GYMART_PROVE_WINDOWS=1 (apre finestre e programmi veri)")
	}
}

var (
	procGetWindowTextW = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("GetWindowTextW")
	procPostMessageW   = syscall.NewLazyDLL(dllSistema("user32.dll")).NewProc("PostMessageW")
)

// finestraConTitolo: the visible Edge window (Chrome_WidgetWin_1) whose title is titolo, and its process.
func finestraConTitolo(titolo string) (uintptr, uint32) {
	var trovata uintptr
	var suo uint32
	cb := syscall.NewCallback(func(hwnd, _ uintptr) uintptr {
		if v, _, _ := procIsWindowVisible.Call(hwnd); v == 0 {
			return 1
		}
		var cls [64]uint16
		n, _, _ := procGetClassNameW.Call(hwnd, uintptr(unsafe.Pointer(&cls[0])), uintptr(len(cls)))
		if syscall.UTF16ToString(cls[:n]) != "Chrome_WidgetWin_1" {
			return 1
		}
		var tit [256]uint16
		m, _, _ := procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&tit[0])), uintptr(len(tit)))
		if !strings.HasPrefix(syscall.UTF16ToString(tit[:m]), titolo) {
			return 1
		}
		procGetWindowThreadProcessId.Call(hwnd, uintptr(unsafe.Pointer(&suo)))
		trovata = hwnd
		return 0
	})
	procEnumWindows.Call(cb, 0)
	return trovata, suo
}

func aspetta(t *testing.T, quanto time.Duration, cosa string, ok func() bool) {
	t.Helper()
	for fine := time.Now().Add(quanto); time.Now().Before(fine); time.Sleep(200 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatalf("dopo %s: %s", quanto, cosa)
}

func rettangoloDi(h uintptr) rettangolo {
	var r rettangolo
	procGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r
}

// The real window in the real Edge: the first time a size in proportion to the screen (maximized on a small one), the page reached
// through localhost on 127.0.0.1, and the next time the window as it was left, remembered by Edge.
func TestVeroFinestraEdge(t *testing.T) {
	soloSuWindowsVero(t)
	t.Setenv("LocalAppData", t.TempDir()) // a new profile of the window, as on a computer that never opened the program
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	host := ln.Addr().String()
	static := fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><title>Gym Art Segreteria</title><meta name="gymart-token" content="__TOKEN__"><body>prova`)}}
	srv, err := NewServer(mustOpen(t, t.TempDir()), static, host, "segreto", "prova")
	if err != nil {
		t.Fatal(err)
	}
	visto := make(chan string, 20)
	h := srv.Handler()
	go http.Serve(ln, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case visto <- r.Host + r.URL.Path:
		default:
		}
		h.ServeHTTP(w, r)
	}))
	area := areaDiLavoro()
	ap := aperturaFinestra(area)
	t.Logf("area di lavoro %+v, prima apertura %+v", area, ap)
	if area.W < areaMinimaW {
		t.Fatalf("area di lavoro non letta: %+v", area)
	}

	if err := openWindow(srv.LaunchURL()); err != nil {
		t.Fatal(err)
	}
	var hw uintptr
	var pid uint32
	aspetta(t, 40*time.Second, "la finestra «Gym Art Segreteria» non compare", func() bool { hw, pid = finestraConTitolo("Gym Art Segreteria"); return hw != 0 })
	t.Cleanup(func() {
		exec.Command(sistema(`System32\taskkill.exe`), "/PID", strconv.Itoa(int(pid)), "/T", "/F").Run()
	})
	strada := []string{}
	for len(visto) > 0 {
		strada = append(strada, <-visto)
	}
	t.Logf("richieste: %v", strada)
	if len(strada) < 3 || !strings.HasPrefix(strada[0], "localhost:") || !strings.HasSuffix(strada[0], "/__finestra") || !strings.HasSuffix(strada[1], "/__avvio") || strings.HasPrefix(strada[1], "localhost") {
		t.Fatalf("la finestra deve passare da localhost/__finestra a 127.0.0.1/__avvio: %v", strada)
	}
	if ap.Ingrandisci {
		aspetta(t, 25*time.Second, "la finestra non è stata ingrandita", func() bool { return ingrandita(hw) })
	} else {
		time.Sleep(2 * time.Second)
		r := rettangoloDi(hw)
		t.Logf("finestra %+v", r)
		if d := int(r.Right-r.Left) - ap.W; d < -24 || d > 24 {
			t.Errorf("larga %d, voluta %d", r.Right-r.Left, ap.W)
		}
	}
	prima := ingrandita(hw)
	t.Logf("ingrandita: %v, finestra %+v", prima, rettangoloDi(hw))

	// closed as a person does: Edge writes down where the window was
	const wmClose = 0x0010
	procPostMessageW.Call(hw, wmClose, 0, 0)
	aspetta(t, 30*time.Second, "la finestra non si chiude", func() bool { h2, _ := finestraConTitolo("Gym Art Segreteria"); return h2 == 0 })
	profilo := filepath.Join(os.Getenv("LocalAppData"), "GymArtSegreteria", "Finestra")
	aspetta(t, 30*time.Second, "Edge non ha scritto la finestra in Preferences", func() bool { return edgeRicordaFinestra(profilo) })
	if b, err := os.ReadFile(filepath.Join(profilo, "Default", "Preferences")); err == nil {
		s := string(b)
		if i := strings.Index(s, nomeFinestraEdge); i >= 0 {
			t.Logf("Preferences: …%s…", s[i:min(len(s), i+260)])
		}
	}
	time.Sleep(3 * time.Second) // Edge finishes closing

	// the second time: no size from the program, Edge puts it back as it was
	if err := openWindow(srv.LaunchURL()); err != nil {
		t.Fatal(err)
	}
	aspetta(t, 40*time.Second, "la finestra non ricompare", func() bool { hw, pid = finestraConTitolo("Gym Art Segreteria"); return hw != 0 })
	time.Sleep(3 * time.Second)
	t.Logf("seconda volta: ingrandita %v, finestra %+v", ingrandita(hw), rettangoloDi(hw))
	if ingrandita(hw) != prima {
		t.Errorf("Edge non l'ha rimessa com'era: ingrandita %v, prima %v", ingrandita(hw), prima)
	}
	procPostMessageW.Call(hw, wmClose, 0, 0)
	aspetta(t, 30*time.Second, "la finestra non si chiude", func() bool { h2, _ := finestraConTitolo("Gym Art Segreteria"); return h2 == 0 })
}

// 1.26.2 on real Windows: the program finds the older copy that holds the port with netstat, checks its name with tasklist
// and stops it with taskkill; a program with another name is never stopped.
func TestVeroChiudiCopiaAperta(t *testing.T) {
	soloSuWindowsVero(t)
	dir := t.TempDir()
	exe := filepath.Join(dir, "GymArtSegreteria-prova.exe")
	if out, err := exec.Command("go", "build", "-o", exe, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	porta := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	cmd := exec.Command(exe, "-senza-finestra", "-porta", strconv.Itoa(porta), "-dati", filepath.Join(dir, "dati"))
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Kill() })
	aspetta(t, 30*time.Second, "il programma non risponde", func() bool { nostro, _ := copiaAperta(porta); return nostro })
	nostro, ver := copiaAperta(porta)
	t.Logf("copia aperta: %v %q", nostro, ver)
	if ver != version {
		t.Errorf("versione %q, voluta %q", ver, version)
	}
	if err := chiudiCopiaAperta(porta); err != nil {
		t.Fatal(err)
	}
	fatto := make(chan error, 1)
	go func() { fatto <- cmd.Wait() }()
	select {
	case <-fatto:
	case <-time.After(15 * time.Second):
		t.Fatal("il programma è ancora aperto")
	}
	aspetta(t, 15*time.Second, "la porta non si libera", func() bool {
		l, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(porta))
		if err == nil {
			l.Close()
		}
		return err == nil
	})

	// someone else on the port: refused, nothing is stopped
	altro, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer altro.Close()
	if err := chiudiCopiaAperta(altro.Addr().(*net.TCPAddr).Port); err == nil {
		t.Fatal("ha chiuso un programma che non è Gym Art Segreteria (o se stesso)")
	} else {
		t.Logf("porta di un altro: %v", err)
	}
}

// 1.29.0 on real Windows: the program installs itself in its own folder with the icons (in folders of the test) and the entry in
// «App» of Windows (under a key of the test), then takes everything away again; nothing of the data.
func TestVeroInstallazione(t *testing.T) {
	soloSuWindowsVero(t)
	dir := t.TempDir()
	t.Setenv("LocalAppData", dir)
	desktop, programmi := filepath.Join(dir, "Desktop"), filepath.Join(dir, "Programmi")
	for _, d := range []string{desktop, programmi} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("GYMART_CARTELLE", desktop+"\n"+programmi)
	vecchia := chiaveApp
	chiaveApp = vecchia + "-prova"
	t.Cleanup(func() { regCmd("delete", chiaveApp, "/f").Run(); chiaveApp = vecchia })

	// the real folders of this user, where the icons go when the test does not choose them
	vere, err := powershell(psCartelle+`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($cartelle -join "`+"`"+`n")))`, map[string]string{"GYMART_CARTELLE": ""})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("cartelle vere dei collegamenti: %q", vere)
	for _, c := range strings.Split(strings.TrimSpace(vere), "\n") {
		if fi, err := os.Stat(c); err != nil || !fi.IsDir() {
			t.Errorf("cartella dei collegamenti che non c'è: %q", c)
		}
	}

	in := nuovoInstallatore("", "9.8.7")
	if in.cartella != filepath.Join(dir, "Programs", cartellaProgramma) {
		t.Fatalf("cartella: %q", in.cartella)
	}
	var partito string
	in.riavvia = func(exe string, args []string) error { partito = exe; return nil } // the test program is not the real one: it is not started
	in.avvio = func(string) error { return nil }                                     // the start with Windows of this computer is not touched
	if st := in.Stato(); st.Stato != instDaInstallare {
		t.Fatalf("stato: %+v", st)
	}
	if err := in.Installa(); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(in.cartella, nomeEseguibile)
	if partito != dest {
		t.Fatalf("riparte da %q", partito)
	}
	if err := controllaEseguibile(dest); err != nil {
		t.Fatal(err)
	}
	bersaglio := func(lnk string) string {
		out, err := powershell(`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((New-Object -ComObject WScript.Shell).CreateShortcut($env:GYMART_LNK).TargetPath))`, map[string]string{"GYMART_LNK": lnk})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	for _, d := range []string{desktop, programmi} {
		lnk := filepath.Join(d, "Gym Art Segreteria.lnk")
		if got := bersaglio(lnk); !strings.EqualFold(got, dest) {
			t.Errorf("%s porta a %q", lnk, got)
		}
	}
	out, err := regCmd("query", chiaveApp).CombinedOutput()
	t.Logf("voce in App:\n%s", out)
	if err != nil || !strings.Contains(string(out), "9.8.7") || !strings.Contains(string(out), "-disinstalla") || !strings.Contains(string(out), "Gym Art Segreteria") {
		t.Fatalf("voce in App: %v", err)
	}
	if st := (&Installatore{exe: dest, versione: "9.8.7", cartella: in.cartella}).Stato(); st.Stato != instInstallato {
		t.Fatalf("quello installato: %+v", st)
	}
	// a shortcut with the same name that goes elsewhere is not ours: it stays
	estraneo := filepath.Join(dir, "Altro")
	os.MkdirAll(estraneo, 0o755)
	if _, err := powershell(`$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:GYMART_LNK); $l.TargetPath = $env:SystemRoot + '\notepad.exe'; $l.Save(); [Convert]::ToBase64String([byte[]]@(111,107))`,
		map[string]string{"GYMART_LNK": filepath.Join(estraneo, "Gym Art Segreteria.lnk")}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GYMART_CARTELLE", desktop+"\n"+programmi+"\n"+estraneo)

	if err := rimuoviInstallazione(dest, in.cartella); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{desktop, programmi} {
		if _, err := os.Stat(filepath.Join(d, "Gym Art Segreteria.lnk")); !os.IsNotExist(err) {
			t.Errorf("collegamento rimasto in %s", d)
		}
	}
	if _, err := os.Stat(filepath.Join(estraneo, "Gym Art Segreteria.lnk")); err != nil {
		t.Error("ha tolto un collegamento che non era suo")
	}
	if regCmd("query", chiaveApp).Run() == nil {
		t.Error("voce in App rimasta")
	}
	aspetta(t, 20*time.Second, "i file del programma installato non si cancellano", func() bool { _, err := os.Stat(in.cartella); return os.IsNotExist(err) })
}
