package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeDocumentName(t *testing.T) {
	valid := []string{"note", "note.md", "中文标题"}
	for _, name := range valid {
		if got, err := safeDocumentName(name); err != nil || got != name {
			t.Fatalf("safeDocumentName(%q) = %q, %v; want %q, nil", name, got, err, name)
		}
	}

	invalid := []string{"", ".", "..", "../escape", "dir/note", `dir\note`}
	for _, name := range invalid {
		if _, err := safeDocumentName(name); err == nil {
			t.Fatalf("safeDocumentName(%q) succeeded; want error", name)
		}
	}
}

func TestPathWithin(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "docs")
	if !pathWithin(root, filepath.Join(root, "nested", "note.md")) {
		t.Fatal("expected nested path to be inside root")
	}
	if pathWithin(root, filepath.Join(root, "..", "escape.md")) {
		t.Fatal("expected parent path to be outside root")
	}
}

func TestPathAllowed(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	app := &App{allowed: make(map[string]struct{})}
	app.setDocumentRoot(root)

	if !app.pathAllowed(filepath.Join(root, "note.md")) {
		t.Fatal("expected document root path to be allowed")
	}
	if app.pathAllowed(filepath.Join(outside, "note.md")) {
		t.Fatal("expected outside path to be denied")
	}

	allowedFile := filepath.Join(outside, "allowed.md")
	app.allowFile(allowedFile)
	if !app.pathAllowed(allowedFile) {
		t.Fatal("expected explicitly allowed file to be allowed")
	}
}

func TestAtomicWriteFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "note.md")

	if err := atomicWriteFile(path, []byte("first"), 0644); err != nil {
		t.Fatalf("initial atomic write failed: %v", err)
	}
	if err := atomicWriteFile(path, []byte("second"), 0644); err != nil {
		t.Fatalf("replacement atomic write failed: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if string(data) != "second" {
		t.Fatalf("file content = %q; want %q", data, "second")
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read temp dir: %v", err)
	}
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".tmp-") {
			t.Fatalf("temporary file left behind: %s", entry.Name())
		}
	}
}

func TestBeforeCloseGuard(t *testing.T) {
	app := &App{}
	app.SetPendingChanges(1, "note.md")
	if !app.beforeClose(nil) {
		t.Fatal("expected close to be prevented while changes are pending")
	}
	app.SetPendingChanges(0, "")
	if app.beforeClose(nil) {
		t.Fatal("expected close to be allowed when nothing is pending")
	}
}

func TestRecoveryState(t *testing.T) {
	db, err := NewDB(t.TempDir())
	if err != nil {
		t.Fatalf("NewDB: %v", err)
	}
	defer db.Close()
	app := &App{db: db}

	payload := `{"content":"unsaved","transactionID":7}`
	if err := app.SaveRecoveryState(payload); err != nil {
		t.Fatalf("SaveRecoveryState: %v", err)
	}
	loaded, err := app.LoadRecoveryState()
	if err != nil {
		t.Fatalf("LoadRecoveryState: %v", err)
	}
	if loaded != payload {
		t.Fatalf("recovery payload = %q; want %q", loaded, payload)
	}
	if err := app.ClearRecoveryState(); err != nil {
		t.Fatalf("ClearRecoveryState: %v", err)
	}
	loaded, err = app.LoadRecoveryState()
	if err != nil {
		t.Fatalf("LoadRecoveryState after clear: %v", err)
	}
	if loaded != "" {
		t.Fatalf("recovery payload after clear = %q; want empty", loaded)
	}
}
