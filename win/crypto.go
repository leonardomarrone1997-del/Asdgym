package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// Protection with a password.
//
// A random data key encrypts everything on disk (AES-256-GCM). The password never encrypts data directly:
// it only wraps the data key (PBKDF2-HMAC-SHA256, then AES-256-GCM). So changing the password rewrites one
// small header, not the data, and every encrypted file carries its own header: a copy taken out of the
// folder can still be opened with the password that was in use when it was made.

const (
	sealedMark = "cifrato"
	aadKey     = "gymart chiave v1"
	aadFile    = "gymart archivio v1"
	aadLine    = "gymart registro v1"
	minPassLen = 8
)

// kdfIterations is the work factor for new headers. Tests lower it; files remember their own.
var kdfIterations = 600_000

// ErrWrongPassword means the password does not open the header it was tried on.
var ErrWrongPassword = errors.New("password errata")

var errNotSealed = errors.New("il file non è cifrato")

// sealedFile is an encrypted archive (or a copy of one) as stored on disk.
type sealedFile struct {
	Gymart string `json:"gymart"`
	V      int    `json:"v"`
	KDF    string `json:"kdf"`
	Iter   int    `json:"iter"`
	Sale   string `json:"sale"`
	Chiave string `json:"chiave"` // nonce + data key, wrapped with the password
	Dati   string `json:"dati"`   // nonce + archive, encrypted with the data key
}

// keyring holds the data key and the header that wraps it with the current password.
type keyring struct {
	dek  []byte
	iter int
	salt []byte
	wrap []byte
}

var b64 = base64.StdEncoding

func gcm(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// seal returns nonce + ciphertext. aad ties the box to its purpose, so one kind cannot be passed off as another.
func seal(key, plain []byte, aad string) ([]byte, error) {
	g, err := gcm(key)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return g.Seal(nonce, nonce, plain, []byte(aad)), nil
}

func unseal(key, box []byte, aad string) ([]byte, error) {
	g, err := gcm(key)
	if err != nil {
		return nil, err
	}
	if len(box) < g.NonceSize()+g.Overhead() {
		return nil, errors.New("dati cifrati incompleti")
	}
	return g.Open(nil, box[:g.NonceSize()], box[g.NonceSize():], []byte(aad))
}

func deriveKey(password string, salt []byte, iter int) ([]byte, error) {
	return pbkdf2.Key(sha256.New, password, salt, iter, 32)
}

func checkPassword(password string) error {
	if len([]rune(password)) < minPassLen {
		return fmt.Errorf("la password deve avere almeno %d caratteri", minPassLen)
	}
	return nil
}

// newKeyring makes a fresh data key and wraps it with the password.
func newKeyring(password string) (*keyring, error) {
	k := &keyring{dek: make([]byte, 32)}
	if _, err := rand.Read(k.dek); err != nil {
		return nil, err
	}
	if err := k.rewrap(password); err != nil {
		return nil, err
	}
	return k, nil
}

// rewrap wraps the same data key with another password: what is already encrypted stays readable.
func (k *keyring) rewrap(password string) error {
	if err := checkPassword(password); err != nil {
		return err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return err
	}
	kek, err := deriveKey(password, salt, kdfIterations)
	if err != nil {
		return err
	}
	wrap, err := seal(kek, k.dek, aadKey)
	if err != nil {
		return err
	}
	k.iter, k.salt, k.wrap = kdfIterations, salt, wrap
	return nil
}

// parseSealed reports whether raw is an encrypted file and returns its parts.
func parseSealed(raw []byte) (*sealedFile, bool) {
	var f sealedFile
	if json.Unmarshal(raw, &f) != nil || f.Gymart != sealedMark {
		return nil, false
	}
	return &f, true
}

// unlockHeader opens the data key of an encrypted file with a password.
func unlockHeader(f *sealedFile, password string) (*keyring, error) {
	if f.V != 1 || f.KDF != "pbkdf2-sha256" || f.Iter < 1000 || f.Iter > 5_000_000 {
		return nil, errors.New("file cifrato in un formato che questa versione non conosce")
	}
	salt, err1 := b64.DecodeString(f.Sale)
	wrap, err2 := b64.DecodeString(f.Chiave)
	if err1 != nil || err2 != nil {
		return nil, errors.New("file cifrato danneggiato")
	}
	kek, err := deriveKey(password, salt, f.Iter)
	if err != nil {
		return nil, err
	}
	dek, err := unseal(kek, wrap, aadKey)
	if err != nil {
		return nil, ErrWrongPassword
	}
	return &keyring{dek: dek, iter: f.Iter, salt: salt, wrap: wrap}, nil
}

// sealFile encrypts an archive and puts the current header in front of it.
func (k *keyring) sealFile(plain []byte) ([]byte, error) {
	box, err := seal(k.dek, plain, aadFile)
	if err != nil {
		return nil, err
	}
	return json.Marshal(sealedFile{Gymart: sealedMark, V: 1, KDF: "pbkdf2-sha256", Iter: k.iter,
		Sale: b64.EncodeToString(k.salt), Chiave: b64.EncodeToString(k.wrap), Dati: b64.EncodeToString(box)})
}

// openFile decrypts an archive made with this data key, whatever password its header was written for.
func (k *keyring) openFile(f *sealedFile) ([]byte, error) {
	box, err := b64.DecodeString(f.Dati)
	if err != nil {
		return nil, errors.New("file cifrato danneggiato")
	}
	plain, err := unseal(k.dek, box, aadFile)
	if err != nil {
		return nil, errors.New("questo file è stato cifrato con un'altra chiave")
	}
	return plain, nil
}

// reheader gives an encrypted file the current header without touching its data.
func (k *keyring) reheader(f *sealedFile) ([]byte, error) {
	if _, err := k.openFile(f); err != nil {
		return nil, err
	}
	g := *f
	g.Iter, g.Sale, g.Chiave = k.iter, b64.EncodeToString(k.salt), b64.EncodeToString(k.wrap)
	return json.Marshal(g)
}

// sealedLine is one encrypted line of the change log.
type sealedLine struct {
	C string `json:"c"`
}

func (k *keyring) sealLine(plain []byte) ([]byte, error) {
	box, err := seal(k.dek, plain, aadLine)
	if err != nil {
		return nil, err
	}
	return json.Marshal(sealedLine{C: b64.EncodeToString(box)})
}

// openLine returns the plain line, or errNotSealed if the line was never encrypted.
func (k *keyring) openLine(line []byte) ([]byte, error) {
	var l sealedLine
	if json.Unmarshal(line, &l) != nil || l.C == "" {
		return nil, errNotSealed
	}
	box, err := b64.DecodeString(l.C)
	if err != nil {
		return nil, err
	}
	return unseal(k.dek, box, aadLine)
}

func isSealedLine(line []byte) bool {
	var l sealedLine
	return json.Unmarshal(line, &l) == nil && l.C != ""
}
