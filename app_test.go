package main

import (
	"encoding/base64"
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

func TestAcceptDroppedDocumentAllowsParentDirectory(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	if err := os.WriteFile(path, []byte("# note"), 0644); err != nil {
		t.Fatalf("write dropped document: %v", err)
	}

	app := &App{allowed: make(map[string]struct{})}
	document, err := app.AcceptDroppedDocument(path)
	if err != nil {
		t.Fatalf("AcceptDroppedDocument: %v", err)
	}

	dir := filepath.Dir(document.Path)
	if _, err := app.ListDocuments(dir); err != nil {
		t.Fatalf("ListDocuments after drop: %v", err)
	}
	if _, err := app.ListDocumentTree(dir); err != nil {
		t.Fatalf("ListDocumentTree after drop: %v", err)
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

func TestWriteImageAsset(t *testing.T) {
	root := t.TempDir()
	documentPath := filepath.Join(root, "notes", "note.md")
	if err := os.MkdirAll(filepath.Dir(documentPath), 0755); err != nil {
		t.Fatalf("create document dir: %v", err)
	}
	if err := os.WriteFile(documentPath, []byte("# note"), 0644); err != nil {
		t.Fatalf("write document: %v", err)
	}

	app := &App{allowed: make(map[string]struct{})}
	app.setDocumentRoot(root)
	payload := base64.StdEncoding.EncodeToString([]byte("image-bytes"))

	first, err := app.WriteImageAsset(documentPath, "assets", "cover.png", payload)
	if err != nil {
		t.Fatalf("WriteImageAsset first: %v", err)
	}
	if first != "./assets/cover.png" {
		t.Fatalf("first relative path = %q; want %q", first, "./assets/cover.png")
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "assets", "cover.png")); err != nil {
		t.Fatalf("image was not written beside document: %v", err)
	}

	second, err := app.WriteImageAsset(documentPath, "assets", "cover.png", payload)
	if err != nil {
		t.Fatalf("WriteImageAsset second: %v", err)
	}
	if second != "./assets/cover-1.png" {
		t.Fatalf("second relative path = %q; want %q", second, "./assets/cover-1.png")
	}

	if _, err := app.WriteImageAsset(documentPath, "../outside", "cover.png", payload); err == nil {
		t.Fatal("expected traversal image directory to fail")
	}
	if _, err := app.WriteImageAsset(documentPath, "assets", "cover.txt", payload); err == nil {
		t.Fatal("expected unsupported image extension to fail")
	}
	if _, err := app.WriteImageAsset(documentPath, "assets", "cover.png", "not-base64"); err == nil {
		t.Fatal("expected invalid base64 to fail")
	}
	if _, err := app.WriteImageAsset(documentPath, "assets", "cover.png", ""); err == nil {
		t.Fatal("expected empty image to fail")
	}
	oversized := strings.Repeat("A", ((20*1024*1024+3)/3)*4)
	if _, err := app.WriteImageAsset(documentPath, "assets", "large.png", oversized); err == nil {
		t.Fatal("expected oversized image to fail")
	}
}

func TestReadImageAsset(t *testing.T) {
	root := t.TempDir()
	documentPath := filepath.Join(root, "notes", "note.md")
	assetPath := filepath.Join(root, "notes", "assets", "logo.png")
	directImagePath := filepath.Join(root, "notes", "direct.png")
	customImagePath := filepath.Join(root, "notes", "media", "figures", "custom.png")
	if err := os.MkdirAll(filepath.Dir(assetPath), 0755); err != nil {
		t.Fatalf("create asset dir: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(customImagePath), 0755); err != nil {
		t.Fatalf("create custom asset dir: %v", err)
	}
	if err := os.WriteFile(documentPath, []byte("# note"), 0644); err != nil {
		t.Fatalf("write document: %v", err)
	}
	imageBytes := []byte("image-bytes")
	if err := os.WriteFile(assetPath, imageBytes, 0644); err != nil {
		t.Fatalf("write image: %v", err)
	}
	if err := os.WriteFile(directImagePath, imageBytes, 0644); err != nil {
		t.Fatalf("write direct image: %v", err)
	}
	if err := os.WriteFile(customImagePath, imageBytes, 0644); err != nil {
		t.Fatalf("write custom image: %v", err)
	}

	app := &App{allowed: make(map[string]struct{})}
	app.setDocumentRoot(root)
	expected := "data:image/png;base64," + base64.StdEncoding.EncodeToString(imageBytes)

	for _, source := range []string{"./assets/logo.png", "assets/logo.png", "logo.png"} {
		got, err := app.ReadImageAsset(documentPath, "assets", source)
		if err != nil {
			t.Fatalf("ReadImageAsset(%q): %v", source, err)
		}
		if got != expected {
			t.Fatalf("ReadImageAsset(%q) = %q; want %q", source, got, expected)
		}
	}

	for _, testCase := range []struct {
		imageDir string
		source   string
	}{
		{imageDir: "assets", source: "direct.png"},
		{imageDir: "media/figures", source: "custom.png"},
		{imageDir: "assets", source: assetPath},
	} {
		got, err := app.ReadImageAsset(documentPath, testCase.imageDir, testCase.source)
		if err != nil {
			t.Fatalf("ReadImageAsset(%q, %q): %v", testCase.imageDir, testCase.source, err)
		}
		if got != expected {
			t.Fatalf("ReadImageAsset(%q, %q) = %q; want %q", testCase.imageDir, testCase.source, got, expected)
		}
	}

	if _, err := app.ReadImageAsset(documentPath, "assets", "../../outside.png"); err == nil {
		t.Fatal("expected image path outside document root to fail")
	}
	if _, err := app.ReadImageAsset(documentPath, "../outside", "logo.png"); err == nil {
		t.Fatal("expected traversal image directory to fail")
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

func TestUserThemes(t *testing.T) {
	app := &App{configDir: t.TempDir()}
	dir, err := app.GetThemesDirectory()
	if err != nil {
		t.Fatalf("GetThemesDirectory: %v", err)
	}
	if !strings.HasSuffix(dir, filepath.Join("", "themes")) {
		t.Fatalf("theme directory = %q; want themes suffix", dir)
	}

	content := `{"schemaVersion":1,"id":"custom-theme","name":"Custom","variants":{"light":{"tokens":{"bgPage":"#ffffff"}}}}`
	if err := app.SaveUserTheme("custom-theme", content); err != nil {
		t.Fatalf("SaveUserTheme: %v", err)
	}
	themes, err := app.ListUserThemes()
	if err != nil {
		t.Fatalf("ListUserThemes: %v", err)
	}
	if themes["custom-theme"] != content {
		t.Fatalf("saved theme content = %q; want %q", themes["custom-theme"], content)
	}

	if err := app.SaveUserTheme("../escape", content); err == nil {
		t.Fatal("expected unsafe theme id to fail")
	}
	if err := app.SaveUserTheme("invalid-json", "not-json"); err == nil {
		t.Fatal("expected invalid JSON to fail")
	}

	if err := app.DeleteUserTheme("custom-theme"); err != nil {
		t.Fatalf("DeleteUserTheme: %v", err)
	}
	themes, err = app.ListUserThemes()
	if err != nil {
		t.Fatalf("ListUserThemes after delete: %v", err)
	}
	if _, exists := themes["custom-theme"]; exists {
		t.Fatal("expected theme to be deleted")
	}
}

func TestUserPlugins(t *testing.T) {
	app := &App{configDir: t.TempDir()}
	dir, err := app.GetUserPluginsDirectory()
	if err != nil {
		t.Fatalf("GetUserPluginsDirectory: %v", err)
	}
	if !strings.HasSuffix(dir, filepath.Join("", "plugins")) {
		t.Fatalf("plugin directory = %q; want plugins suffix", dir)
	}

	content := `{"schemaVersion":1,"id":"custom-plugin","name":"Custom Plugin","version":"1.0.0","entry":"ctx => {}"}`
	if err := app.SaveUserPlugin("custom-plugin", content); err != nil {
		t.Fatalf("SaveUserPlugin: %v", err)
	}
	plugins, err := app.ListUserPlugins()
	if err != nil {
		t.Fatalf("ListUserPlugins: %v", err)
	}
	if plugins["custom-plugin"] != content {
		t.Fatalf("saved plugin content = %q; want %q", plugins["custom-plugin"], content)
	}

	if err := app.SaveUserPlugin("../escape", content); err == nil {
		t.Fatal("expected unsafe plugin id to fail")
	}
	if err := app.SaveUserPlugin("invalid-json", "not-json"); err == nil {
		t.Fatal("expected invalid plugin JSON to fail")
	}

	if err := app.DeleteUserPlugin("custom-plugin"); err != nil {
		t.Fatalf("DeleteUserPlugin: %v", err)
	}
	plugins, err = app.ListUserPlugins()
	if err != nil {
		t.Fatalf("ListUserPlugins after delete: %v", err)
	}
	if _, exists := plugins["custom-plugin"]; exists {
		t.Fatal("expected plugin to be deleted")
	}
}
