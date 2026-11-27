//go:build windows

package main

// Prove su Windows vero (1.29.0): partono solo con GYMART_PROVE_WINDOWS=1, sul computer Windows delle prove di GitHub
// (Actions › Prove › Run workflow, casella «Windows»). Aprono finestre e programmi veri: non vanno fatte su un computer in uso.

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
		if got := bersaglio(lnk); !stessoFile(got, dest) { // Windows writes the long path («runneradmin»), the test has the short one («RUNNER~1»)
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
	// an old copy on the «Desktop» of the test: found, and moved to the real Recycle Bin
	copiaVecchia := filepath.Join(desktop, "Gym Art - Copia", "GymArtSegreteria.exe")
	if err := os.MkdirAll(filepath.Dir(copiaVecchia), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := copiaFile(dest, copiaVecchia); err != nil {
		t.Fatal(err)
	}
	// the version written in the file (the resources of the exe, as Explorer shows them): the test program has the program's resources
	if v := versioneFile(dest); v != version {
		t.Fatalf("versione letta dal file: %q, voluta %q", v, version)
	}
	if v := versioneFile(filepath.Join(os.Getenv("SystemRoot"), "notepad.exe")); v == "" || v == version {
		t.Errorf("versione di notepad: %q", v)
	}
	installata := &Installatore{exe: dest, versione: "9.8.7", cartella: in.cartella, dove: func() []string { return []string{desktop} }, cestina: nelCestino, versioneDi: versioneFile}
	if st := installata.StatoCompleto(); len(st.AltreCopie) != 1 || !stessoFile(st.AltreCopie[0].Percorso, copiaVecchia) {
		t.Fatalf("altre copie: %+v", st.AltreCopie)
	}
	if st := (&Installatore{exe: dest, versione: "1.0.0", cartella: in.cartella, dove: installata.dove, versioneDi: versioneFile}).StatoCompleto(); len(st.AltreCopie) != 0 {
		t.Fatalf("una copia più nuova di quella installata non è «vecchia»: %+v", st.AltreCopie)
	}
	if err := installata.Cestina(installata.StatoCompleto().AltreCopie[0].Percorso); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(copiaVecchia); !os.IsNotExist(err) {
		t.Fatal("la copia copiaVecchia è ancora lì")
	}
	t.Logf("cartelle dell'utente: %q", cartelleUtente())
	if len(cartelleUtente()) != 2 {
		t.Errorf("Desktop e Download: %q", cartelleUtente())
	}
	// a shortcut with the same name that goes elsewhere is not ours: it stays
	estraneo := filepath.Join(dir, "Altro")
	os.MkdirAll(estraneo, 0o755)
	if _, err := powershell(`$l = (New-Object -ComObject WScript.Shell).CreateShortcut($env:GYMART_LNK); $l.TargetPath = $env:SystemRoot + '\notepad.exe'; $l.Save(); [Convert]::ToBase64String([byte[]]@(111,107))`,
		map[string]string{"GYMART_LNK": filepath.Join(estraneo, "Gym Art Segreteria.lnk")}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GYMART_CARTELLE", desktop+"\n"+programmi+"\n"+estraneo)

	// the start with Windows written with the long path of the file (the test has the short one, «RUNNER~1»): it goes too
	lungo := make([]uint16, 1024)
	breve, _ := syscall.UTF16PtrFromString(dest)
	n, err := syscall.GetLongPathName(breve, &lungo[0], uint32(len(lungo)))
	if err != nil || n == 0 {
		t.Fatalf("percorso lungo: %v", err)
	}
	t.Logf("installato: %s, percorso lungo: %s", dest, syscall.UTF16ToString(lungo[:n]))
	if out, err := regCmd("add", runKey, "/v", "GymArtSegreteria", "/t", "REG_SZ", "/d", `"`+syscall.UTF16ToString(lungo[:n])+`" -senza-finestra`, "/f").CombinedOutput(); err != nil {
		t.Fatalf("avvio con Windows: %v %s", err, out)
	}
	t.Cleanup(func() { regCmd("delete", runKey, "/v", "GymArtSegreteria", "/f").Run() })

	if err := rimuoviInstallazione(dest, in.cartella); err != nil {
		t.Fatal(err)
	}
	if regCmd("query", runKey, "/v", "GymArtSegreteria").Run() == nil {
		t.Error("l'avvio con Windows del programma disinstallato è rimasto")
	}
	if err := cancellaDopo(dest, in.cartella); err != nil {
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

// 1.29.0 (review): after an installation, an update or «Chiudi il programma» the program closes its own window (Edge refuses window.close()
// to a page that changed page), and only that: a window of another Edge with the same title stays. The window then opens again at once.
func TestVeroChiudiFinestre(t *testing.T) {
	soloSuWindowsVero(t)
	t.Setenv("LocalAppData", t.TempDir())
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	static := fstest.MapFS{"index.html": {Data: []byte(`<!doctype html><title>Gym Art Segreteria</title><meta name="gymart-token" content="__TOKEN__"><body>prova`)}}
	srv, err := NewServer(mustOpen(t, t.TempDir()), static, ln.Addr().String(), "segreto", "prova")
	if err != nil {
		t.Fatal(err)
	}
	go http.Serve(ln, srv.Handler())
	// another Edge, with a profile of its own, showing a page with the same title: it is not the program's
	altro := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(`<!doctype html><title>Gym Art Segreteria (un'altra finestra)</title><body>non sono il programma`))
	}))
	defer altro.Close()
	var edge string
	for _, p := range browserPaths() {
		if _, err := os.Stat(p); err == nil {
			edge = p
			break
		}
	}
	if edge == "" {
		t.Fatal("Edge non c'è")
	}
	estranea := exec.Command(edge, "--no-first-run", "--user-data-dir="+t.TempDir(), "--app="+altro.URL)
	if err := estranea.Start(); err != nil {
		t.Fatal(err)
	}
	quante := func() int {
		n := 0
		elenco.Lock()
		elenco.tutte = elenco.tutte[:0]
		procEnumWindows.Call(elencaFinestreCallback, 0)
		n = len(elenco.tutte)
		elenco.Unlock()
		return n
	}
	aspetta(t, 40*time.Second, "la finestra dell'altro Edge non compare", func() bool { return quante() == 1 })
	var altroPid uint32
	if h, pid := finestraConTitolo("Gym Art Segreteria (un'altra"); h != 0 {
		altroPid = pid
	}
	t.Cleanup(func() {
		exec.Command(sistema(`System32\taskkill.exe`), "/PID", strconv.Itoa(int(altroPid)), "/T", "/F").Run()
	})

	if err := openWindow(srv.LaunchURL()); err != nil {
		t.Fatal(err)
	}
	aspetta(t, 40*time.Second, "la finestra del programma non compare", func() bool { return quante() == 2 })
	profilo := profiloFinestra()
	f, processi := finestreDelProgramma(profilo)
	t.Logf("finestre del programma: %d, processi %v; riga di comando: %.300s", len(f), processi, rigaDiComando(processi[0]))
	if len(f) != 1 || len(processi) != 1 || processi[0] == altroPid {
		t.Fatalf("finestre del programma %v, processi %v (l'altro Edge è %d)", f, processi, altroPid)
	}
	inizio := time.Now()
	chiudiFinestre()
	t.Logf("chiusa in %s", time.Since(inizio).Round(time.Millisecond))
	if f, _ := finestreDelProgramma(profilo); len(f) != 0 {
		t.Fatal("la finestra del programma è ancora aperta")
	}
	if quante() != 1 {
		t.Fatal("anche la finestra dell'altro Edge si è chiusa")
	}
	if h, _ := syscall.OpenProcess(syscall.SYNCHRONIZE, false, processi[0]); h != 0 {
		ev, _ := syscall.WaitForSingleObject(h, 0)
		syscall.CloseHandle(h)
		if ev != syscall.WAIT_OBJECT_0 {
			t.Error("l'Edge del programma non ha finito di chiudersi")
		}
	}
	// the program that starts next opens its window at once (it does not hand it to an Edge that is closing)
	if err := openWindow(srv.LaunchURL()); err != nil {
		t.Fatal(err)
	}
	aspetta(t, 40*time.Second, "la finestra non si riapre dopo la chiusura", func() bool { f, _ := finestreDelProgramma(profilo); return len(f) == 1 })
	chiudiFinestre()
	if f, _ := finestreDelProgramma(profilo); len(f) != 0 {
		t.Fatal("la seconda finestra non si è chiusa")
	}
}

// The real program, the .exe built as for the gym (no console window), on real Windows: it starts from a «Download» folder and says its
// version; after the yes it installs itself (folder, version file, icons, entry in Apps) and the installed one takes its place on the same
// port; a second start of the downloaded file opens the installed one. What the person would do, without the windows.
func TestVeroExe(t *testing.T) {
	soloSuWindowsVero(t)
	tmp := t.TempDir()
	// no -dati: with a data folder chosen by hand the program is «portable» and rightly does not offer to install itself. The data go
	// where the person's go, Documents\Gym Art Segreteria, of a test user
	utente, la, scaricati := filepath.Join(tmp, "utente"), filepath.Join(tmp, "LocalAppData"), filepath.Join(tmp, "Download")
	dati := filepath.Join(utente, "Documents", dataFolder)
	desktop, start := filepath.Join(tmp, "Desktop"), filepath.Join(tmp, "Start")
	for _, d := range []string{utente, la, scaricati, desktop, start} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	exe := filepath.Join(scaricati, "GymArtSegreteria.exe")
	build := exec.Command("go", "build", "-trimpath", "-ldflags", "-H=windowsgui -s -w", "-o", exe, ".")
	build.Env = append(os.Environ(), "CGO_ENABLED=0")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("compilazione: %v %s", err, out)
	}
	fi, _ := os.Stat(exe)
	t.Logf("programma: %d KB, versione nel file %q", fi.Size()/1024, versioneFile(exe))
	if v := versioneFile(exe); v != version {
		t.Fatalf("versione scritta nel file: %q, voluta %q", v, version)
	}
	t.Setenv("LocalAppData", la)
	t.Setenv("USERPROFILE", utente)
	t.Setenv("GYMART_CARTELLE", desktop+"\n"+start)
	t.Setenv("GYMART_AGGIORNAMENTI_NO_AUTO", "1")
	installato := filepath.Join(la, "Programs", cartellaProgramma, nomeEseguibile)
	ferma := func() { // the programs started from the installed file, whatever their port
		ps := `Get-Process GymArtSegreteria -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:GYMART_EXE -or $_.Path -eq $env:GYMART_SCARICATO } | Stop-Process -Force; [Convert]::ToBase64String([byte[]]@(111,107))`
		powershell(ps, map[string]string{"GYMART_EXE": installato, "GYMART_SCARICATO": exe})
	}
	t.Cleanup(func() { ferma(); regCmd("delete", chiaveApp, "/f").Run(); time.Sleep(time.Second) })

	cmd := exec.Command(exe, "-senza-finestra", "-porta", "0")
	uscita, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	righe := make(chan string, 20)
	go func() {
		sc := bufio.NewScanner(uscita)
		for sc.Scan() {
			righe <- sc.Text()
		}
		close(righe)
	}()
	var avvio string
	for fine := time.After(60 * time.Second); avvio == ""; {
		select {
		case r, ok := <-righe:
			if !ok {
				t.Fatal("il programma si è fermato senza dire il suo indirizzo")
			}
			t.Logf("programma: %s", r)
			if strings.HasPrefix(r, "Apri: ") {
				avvio = strings.TrimPrefix(r, "Apri: ")
			}
		case <-fine:
			t.Fatal("il programma non dice il suo indirizzo entro un minuto")
		}
	}
	m := regexp.MustCompile(`^http://127\.0\.0\.1:(\d+)/`).FindStringSubmatch(avvio)
	if m == nil {
		t.Fatalf("indirizzo: %q", avvio)
	}
	base := "http://127.0.0.1:" + m[1]
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar, Timeout: 30 * time.Second}
	resp, err := c.Get(avvio) // as the window does: the one-use code, then the page with its token
	if err != nil {
		t.Fatal(err)
	}
	pagina, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.Header.Get(versioneHeader) != version {
		t.Fatalf("versione detta dal programma: %q", resp.Header.Get(versioneHeader))
	}
	tm := regexp.MustCompile(`name="gymart-token" content="([^"]+)"`).FindSubmatch(pagina)
	if tm == nil {
		t.Fatalf("pagina senza token (%d): %.200s", resp.StatusCode, pagina)
	}
	chiedi := func(metodo, percorso, corpo string) map[string]any {
		t.Helper()
		req, _ := http.NewRequest(metodo, base+percorso, strings.NewReader(corpo))
		req.Header.Set(tokenHeader, string(tm[1]))
		req.Header.Set("Content-Type", "application/json")
		r, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		var j map[string]any
		json.NewDecoder(r.Body).Decode(&j)
		if r.StatusCode != 200 {
			t.Fatalf("%s %s: %d %v", metodo, percorso, r.StatusCode, j)
		}
		return j
	}
	if st := chiedi("GET", "/api/installazione", ""); st["stato"] != instDaInstallare || st["versione"] != version {
		t.Fatalf("stato prima: %v", st)
	}
	if j := chiedi("POST", "/api/installazione", `{"fai":"installa"}`); j["riparte"] != true {
		t.Fatalf("installa: %v", j)
	}
	finito := make(chan error, 1)
	go func() { finito <- cmd.Wait() }()
	select {
	case err := <-finito:
		t.Logf("il programma scaricato si è chiuso (%v)", err)
	case <-time.After(30 * time.Second):
		t.Fatal("il programma scaricato non lascia il posto a quello installato")
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(installato), fileInstallazione))
	if err != nil || !strings.Contains(string(b), `"`+version+`"`) {
		t.Fatalf("versione installata: %v %s", err, b)
	}
	if v := versioneFile(installato); v != version {
		t.Fatalf("programma installato: versione %q", v)
	}
	for _, d := range []string{desktop, start} {
		if _, err := os.Stat(filepath.Join(d, "Gym Art Segreteria.lnk")); err != nil {
			t.Errorf("icona mancante in %s", d)
		}
	}
	if out, err := regCmd("query", chiaveApp, "/v", "DisplayVersion").CombinedOutput(); err != nil || !strings.Contains(string(out), version) {
		t.Fatalf("voce in App: %v %s", err, out)
	}
	// the installed program on the same port, with the same version
	aspetta(t, 40*time.Second, "il programma installato non risponde sullo stesso indirizzo", func() bool {
		r, err := http.Get(base + "/__versione")
		if err != nil {
			return false
		}
		r.Body.Close()
		return r.Header.Get(versioneHeader) == version
	})
	diario := func() string { b, _ := os.ReadFile(filepath.Join(dati, "diario-tecnico.log")); return string(b) }
	aspetta(t, 10*time.Second, "il diario non dice che è partito quello installato", func() bool {
		return strings.Contains(diario(), "dalla cartella del programma installato")
	})
	if strings.Contains(diario(), "dopo un aggiornamento") {
		t.Error("il diario chiama l'installazione un aggiornamento")
	}
	t.Logf("diario:\n%s", diario())

	// the downloaded file, opened again: it starts the installed one in its place and goes away
	quanti := func() int {
		out, err := powershell(`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]@(Get-Process GymArtSegreteria -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:GYMART_EXE }).Count))`, map[string]string{"GYMART_EXE": installato})
		if err != nil {
			t.Fatal(err)
		}
		n, _ := strconv.Atoi(strings.TrimSpace(out))
		return n
	}
	if n := quanti(); n != 1 {
		t.Fatalf("programmi installati che girano: %d", n)
	}
	di := exec.Command(exe, "-senza-finestra", "-porta", "0")
	if err := di.Start(); err != nil {
		t.Fatal(err)
	}
	fatto := make(chan error, 1)
	go func() { fatto <- di.Wait() }()
	select {
	case err := <-fatto:
		if err != nil {
			t.Fatalf("la copia scaricata: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("la copia scaricata non apre quello installato al suo posto")
	}
	aspetta(t, 30*time.Second, "il programma installato non è partito al posto della copia", func() bool { return quanti() == 2 })
}
