package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx       context.Context
	configDir string
	db        *DB
	mu        sync.RWMutex
	docDir    string
	allowed   map[string]struct{}
	closeMu   sync.Mutex
	pending   int
	pendingID string
}

type Document struct {
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Size     int64      `json:"size"`
	ModTime  string     `json:"modTime"`
	IsDir    bool       `json:"isDir"`
	Children []Document `json:"children,omitempty"`
}

type AppState struct {
	DocumentDir string   `json:"documentDir"`
	OpenDocs    []string `json:"openDocs"`
}

type FileDocument struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	Revision    int64  `json:"revision"`
	ContentHash string `json:"contentHash"`
	Changed     bool   `json:"changed"`
}

func NewApp() *App {
	configDir, _ := os.UserConfigDir()
	configDir = filepath.Join(configDir, "md-editor-desktop")
	os.MkdirAll(configDir, 0755)
	db, err := NewDB(configDir)
	if err != nil {
		println("DB init error:", err.Error())
	}
	return &App{
		configDir: configDir,
		db:        db,
		allowed:   make(map[string]struct{}),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if a.db == nil {
		return
	}
	if dir, err := a.db.GetState("documentDir"); err == nil && dir != "" {
		a.setDocumentRoot(dir)
	}
	if recent, err := a.db.ListRecentFiles(200); err == nil {
		for _, doc := range recent {
			a.allowFile(doc.Path)
		}
	}
}

func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		a.db.Close()
	}
}

func canonicalPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return filepath.Clean(resolved), nil
	}
	parent := filepath.Dir(abs)
	if resolvedParent, err := filepath.EvalSymlinks(parent); err == nil {
		return filepath.Clean(filepath.Join(resolvedParent, filepath.Base(abs))), nil
	}
	return filepath.Clean(abs), nil
}

func contentHash(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func pathWithin(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func (a *App) setDocumentRoot(dir string) {
	if dir == "" {
		return
	}
	root, err := canonicalPath(dir)
	if err != nil {
		return
	}
	a.mu.Lock()
	a.docDir = root
	a.mu.Unlock()
}

func (a *App) allowFile(path string) {
	if path == "" {
		return
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return
	}
	a.mu.Lock()
	a.allowed[canonical] = struct{}{}
	a.mu.Unlock()
}

func (a *App) pathAllowed(path string) bool {
	if path == "" {
		return false
	}
	canonical, err := canonicalPath(path)
	if err != nil {
		return false
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	if _, ok := a.allowed[canonical]; ok {
		return true
	}
	return a.docDir != "" && pathWithin(a.docDir, canonical)
}

func (a *App) requireAllowedPath(path string) error {
	if !a.pathAllowed(path) {
		return fmt.Errorf("path is outside the authorized document scope")
	}
	return nil
}

func safeDocumentName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("invalid document name")
	}
	return name, nil
}

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if err := tmp.Chmod(perm); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// SelectDocumentDir opens a folder picker dialog and saves the selection
func (a *App) SelectDocumentDir() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择文档目录",
	})
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", fmt.Errorf("canceled")
	}
	a.setDocumentRoot(dir)
	a.saveState(AppState{DocumentDir: dir})
	return dir, nil
}

// OpenDocumentFile opens a single file picker and returns its path
func (a *App) OpenDocumentFile() (string, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "打开 Markdown 文件",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md;*.markdown"},
			{DisplayName: "文本文件 (*.txt)", Pattern: "*.txt"},
			{DisplayName: "所有文件 (*)", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", fmt.Errorf("canceled")
	}
	a.allowFile(path)
	return path, nil
}

// ---- Database Document Methods ----

// DBCreateDocument creates a new document in SQLite
func (a *App) DBCreateDocument(name, content string) (int64, error) {
	if a.db == nil {
		return 0, fmt.Errorf("db not available")
	}
	return a.db.CreateDoc(name, content)
}

// DBReadDocument reads a document from SQLite by id
func (a *App) DBReadDocument(id int64) (map[string]interface{}, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	name, content, revision, err := a.db.ReadDoc(id)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"id":       id,
		"name":     name,
		"content":  content,
		"revision": revision,
	}, nil
}

// DBUpdateDocument updates a document in SQLite
func (a *App) DBUpdateDocument(id int64, name, content string, expectedRevision int64) (int64, error) {
	if a.db == nil {
		return 0, fmt.Errorf("db not available")
	}
	return a.db.UpdateDoc(id, name, content, expectedRevision)
}

// DBDeleteDocument deletes a document from SQLite
func (a *App) DBDeleteDocument(id int64) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.DeleteDoc(id)
}

// DBListDocuments lists all documents from SQLite
func (a *App) DBListDocuments() ([]DBDocument, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	return a.db.ListDocs()
}

// DBListDocumentVersions lists recent versions for a database document
func (a *App) DBListDocumentVersions(id int64, limit int) ([]DocumentVersion, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	return a.db.ListDocVersions(id, limit)
}

// DBRestoreDocumentVersion restores a previous database document version
func (a *App) DBRestoreDocumentVersion(id, versionID, expectedRevision int64) (int64, error) {
	if a.db == nil {
		return 0, fmt.Errorf("db not available")
	}
	return a.db.RestoreDocVersion(id, versionID, expectedRevision)
}

// ListDocuments lists all files/dirs under the given directory, sorted by mod time desc
func (a *App) ListDocuments(dir string) ([]Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var docs []Document
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			return nil, err
		}
		docs = append(docs, Document{
			Name:    e.Name(),
			Path:    filepath.Join(dir, e.Name()),
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			IsDir:   e.IsDir(),
		})
	}
	sort.Slice(docs, func(i, j int) bool {
		return docs[i].ModTime > docs[j].ModTime
	})
	return docs, nil
}

// ListDocumentTree recursively lists files/dirs as a tree.
// Only .md files and directories are included; hidden files (starting with .) are skipped.
func (a *App) ListDocumentTree(dir string) ([]Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return nil, err
	}
	return a.readTree(dir)
}

func (a *App) readTree(dir string) ([]Document, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var docs []Document
	for _, e := range entries {
		name := e.Name()
		if len(name) > 0 && name[0] == '.' {
			continue
		}
		info, err := e.Info()
		if err != nil {
			return nil, err
		}
		full := filepath.Join(dir, name)
		doc := Document{
			Name:    name,
			Path:    full,
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04"),
			IsDir:   e.IsDir(),
		}
		if e.IsDir() {
			children, _ := a.readTree(full)
			doc.Children = children
			docs = append(docs, doc)
		} else if filepath.Ext(name) == ".md" {
			docs = append(docs, doc)
		}
	}
	sort.Slice(docs, func(i, j int) bool {
		if docs[i].IsDir != docs[j].IsDir {
			return docs[i].IsDir
		}
		return docs[i].Name < docs[j].Name
	})
	return docs, nil
}

// ReadDocument reads the full content of a file
func (a *App) ReadDocument(path string) (string, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return "", err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ReadDocumentWithMeta reads a file and returns its revision metadata
func (a *App) ReadDocumentWithMeta(path string) (FileDocument, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return FileDocument{}, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return FileDocument{}, err
	}
	content := string(data)
	hash := contentHash(content)
	result := FileDocument{
		Path:        path,
		Content:     content,
		ContentHash: hash,
		Revision:    1,
	}
	if a.db == nil {
		return result, nil
	}
	revision, err := a.db.EnsureFileRevision(path, hash, content)
	if err != nil {
		return FileDocument{}, err
	}
	result.Revision = revision.Revision
	result.Changed = revision.ContentHash != hash
	return result, nil
}

// WriteDocument writes content to a file
func (a *App) WriteDocument(path, content string) error {
	if err := a.requireAllowedPath(path); err != nil {
		return err
	}
	return atomicWriteFile(path, []byte(content), 0644)
}

// WriteDocumentVersioned writes a file only when its revision still matches
func (a *App) WriteDocumentVersioned(path, content string, expectedRevision int64, expectedHash string) (int64, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return 0, err
	}
	currentData, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return 0, err
	}
	fileExists := err == nil
	currentContent := string(currentData)
	currentHash := contentHash(currentContent)
	if a.db == nil {
		if err := atomicWriteFile(path, []byte(content), 0644); err != nil {
			return 0, err
		}
		return expectedRevision + 1, nil
	}

	revision, err := a.db.EnsureFileRevision(path, currentHash, currentContent)
	if err != nil {
		return 0, err
	}
	if (expectedRevision == 0 && fileExists) ||
		(expectedRevision > 0 && (revision.Revision != expectedRevision || revision.ContentHash != expectedHash)) {
		return 0, ErrRevisionConflict
	}
	nextHash := contentHash(content)
	if err := atomicWriteFile(path, []byte(content), 0644); err != nil {
		return 0, err
	}
	return a.db.CommitFileRevision(path, nextHash, content, revision.Revision, revision.ContentHash)
}

// ListFileVersions returns recent snapshots for a file
func (a *App) ListFileVersions(path string, limit int) ([]FileVersion, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return nil, err
	}
	if a.db == nil {
		return []FileVersion{}, nil
	}
	return a.db.ListFileVersions(path, limit)
}

// RestoreFileVersion restores a previous file snapshot
func (a *App) RestoreFileVersion(path string, versionID, expectedRevision int64, expectedHash string) (int64, error) {
	if err := a.requireAllowedPath(path); err != nil {
		return 0, err
	}
	if a.db == nil {
		return 0, fmt.Errorf("db not available")
	}
	versions, err := a.db.ListFileVersions(path, maxStoredVersions)
	if err != nil {
		return 0, err
	}
	for _, version := range versions {
		if version.ID != versionID {
			continue
		}
		return a.WriteDocumentVersioned(path, version.Content, expectedRevision, expectedHash)
	}
	return 0, fmt.Errorf("version not found")
}

// CreateDocument creates a new .md file with initial content
func (a *App) CreateDocument(dir, title string) (Document, error) {
	if err := a.requireAllowedPath(dir); err != nil {
		return Document{}, err
	}
	title, err := safeDocumentName(title)
	if err != nil {
		return Document{}, err
	}
	path := filepath.Join(dir, title+".md")
	if _, err := os.Stat(path); err == nil {
		path = filepath.Join(dir, title+"_"+time.Now().Format("20060102_150405")+".md")
	}
	if err := atomicWriteFile(path, []byte("# "+title+"\n\n"), 0644); err != nil {
		return Document{}, err
	}
	a.allowFile(path)
	if a.db != nil {
		content := "# " + title + "\n\n"
		if _, err := a.db.EnsureFileRevision(path, contentHash(content), content); err != nil {
			return Document{}, err
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    filepath.Base(path),
		Path:    path,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

func (a *App) recycleDir() string {
	return filepath.Join(a.configDir, "recycle-bin")
}

func copyPath(source, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return fmt.Errorf("directory recycle is not supported")
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err := atomicWriteFile(destination, data, info.Mode().Perm()); err != nil {
		return err
	}
	return os.Remove(source)
}

func moveToRecycle(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	if err := os.Rename(source, destination); err == nil {
		return nil
	}
	return copyPath(source, destination)
}

// DeleteDocument moves a file into the app recycle bin
func (a *App) DeleteDocument(path string) error {
	if err := a.requireAllowedPath(path); err != nil {
		return err
	}
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	storedName := time.Now().Format("20060102_150405") + "_" + filepath.Base(path)
	storedPath := filepath.Join(a.recycleDir(), storedName)
	if err := moveToRecycle(path, storedPath); err != nil {
		return err
	}
	if _, err := a.db.AddRecycleItem(path, storedPath, filepath.Base(path)); err != nil {
		_ = moveToRecycle(storedPath, path)
		return err
	}
	return nil
}

// ListRecycleBin returns files that were moved to the recycle bin
func (a *App) ListRecycleBin(limit int) ([]RecycleItem, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	items, err := a.db.ListRecycleBin(limit)
	if err != nil {
		return nil, err
	}
	deletedDocs, err := a.db.ListDeletedDocs(limit)
	if err != nil {
		return nil, err
	}
	for _, doc := range deletedDocs {
		items = append(items, RecycleItem{
			ID:           -doc.ID,
			OriginalPath: "db:" + fmt.Sprint(doc.ID),
			StoredPath:   "db:" + fmt.Sprint(doc.ID),
			Name:         doc.Name,
			DeletedAt:    doc.UpdatedAt,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].DeletedAt > items[j].DeletedAt
	})
	if len(items) > limit && limit > 0 {
		items = items[:limit]
	}
	return items, nil
}

// RestoreRecycleItem restores a recycled file to its original path
func (a *App) RestoreRecycleItem(id int64) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	item, err := a.db.GetRecycleItem(id)
	if err == sql.ErrNoRows {
		if id < 0 {
			return a.db.RestoreDoc(-id)
		}
		return fmt.Errorf("recycle item not found")
	}
	if err != nil {
		return err
	}
	if err := a.requireAllowedPath(filepath.Dir(item.OriginalPath)); err != nil {
		return err
	}
	if _, err := os.Stat(item.OriginalPath); err == nil {
		return fmt.Errorf("original path already exists")
	}
	if err := moveToRecycle(item.StoredPath, item.OriginalPath); err != nil {
		return err
	}
	a.allowFile(item.OriginalPath)
	return a.db.RemoveRecycleItem(id)
}

// PurgeRecycleItem permanently removes a recycled file
func (a *App) PurgeRecycleItem(id int64) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	item, err := a.db.GetRecycleItem(id)
	if err == sql.ErrNoRows {
		if id < 0 {
			return a.db.PurgeDoc(-id)
		}
		return fmt.Errorf("recycle item not found")
	}
	if err != nil {
		return err
	}
	if err := os.Remove(item.StoredPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return a.db.RemoveRecycleItem(id)
}

// RenameDocument renames a file
func (a *App) RenameDocument(oldPath, newName string) (Document, error) {
	if err := a.requireAllowedPath(oldPath); err != nil {
		return Document{}, err
	}
	newName, err := safeDocumentName(newName)
	if err != nil {
		return Document{}, err
	}
	dir := filepath.Dir(oldPath)
	ext := filepath.Ext(newName)
	if ext == "" {
		newName += ".md"
	}
	newPath := filepath.Join(dir, newName)
	if err := a.requireAllowedPath(newPath); err != nil {
		return Document{}, err
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return Document{}, err
	}
	a.allowFile(newPath)
	info, err := os.Stat(newPath)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    newName,
		Path:    newPath,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// GetAppVersion returns the current application version
func (a *App) GetAppVersion() string {
	return "0.0.1"
}

// SetPendingChanges records whether the frontend still has unsaved content
func (a *App) SetPendingChanges(count int, summary string) {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	a.pending = count
	a.pendingID = summary
}

// ConfirmClose allows the application to close after a save attempt
func (a *App) ConfirmClose() {
	a.closeMu.Lock()
	a.pending = 0
	a.pendingID = ""
	a.closeMu.Unlock()
	if a.ctx != nil {
		runtime.Quit(a.ctx)
	}
}

func (a *App) beforeClose(ctx context.Context) bool {
	a.closeMu.Lock()
	hasPending := a.pending > 0
	summary := a.pendingID
	a.closeMu.Unlock()
	if !hasPending {
		return false
	}
	if ctx != nil {
		runtime.EventsEmit(ctx, "app:before-close", map[string]interface{}{
			"pending": 1,
			"summary": summary,
		})
	}
	return true
}

// SaveRecoveryState stores unsaved content for crash recovery
func (a *App) SaveRecoveryState(payload string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.SetState("recovery", payload)
}

// LoadRecoveryState returns the last crash-recovery snapshot
func (a *App) LoadRecoveryState() (string, error) {
	if a.db == nil {
		return "", nil
	}
	return a.db.GetState("recovery")
}

// ClearRecoveryState removes a recovery snapshot after it is handled
func (a *App) ClearRecoveryState() error {
	if a.db == nil {
		return nil
	}
	return a.db.DeleteState("recovery")
}

// MenuSave emits a save event to the frontend (triggered by menu bar)
func (a *App) MenuSave() {
	runtime.EventsEmit(a.ctx, "menu:save")
}

// MenuSaveAs emits a save-as event to the frontend
func (a *App) MenuSaveAs() {
	runtime.EventsEmit(a.ctx, "menu:saveas")
}

// SaveDocumentAs opens a save dialog and writes content to the chosen path
func (a *App) SaveDocumentAs(content string) (Document, error) {
	runtime.LogPrint(a.ctx, "SaveDocumentAs: opening save dialog, content length="+fmt.Sprint(len(content)))
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "保存 Markdown 文件",
		DefaultFilename: "未命名.md",
		Filters: []runtime.FileFilter{
			{DisplayName: "Markdown 文件 (*.md)", Pattern: "*.md"},
		},
	})
	if err != nil {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: dialog error: "+err.Error())
		return Document{}, err
	}
	if path == "" {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: user cancelled (empty path)")
		return Document{}, fmt.Errorf("canceled")
	}
	// 确保 .md 扩展名
	if filepath.Ext(path) != ".md" {
		path = path + ".md"
	}
	runtime.LogPrint(a.ctx, "SaveDocumentAs: writing to: "+path)
	if err := atomicWriteFile(path, []byte(content), 0644); err != nil {
		runtime.LogPrint(a.ctx, "SaveDocumentAs: write error: "+err.Error())
		return Document{}, err
	}
	a.allowFile(path)
	if a.db != nil {
		if _, err := a.db.EnsureFileRevision(path, contentHash(content), content); err != nil {
			return Document{}, err
		}
	}
	runtime.LogPrint(a.ctx, "SaveDocumentAs: success, file written")
	info, err := os.Stat(path)
	if err != nil {
		return Document{}, err
	}
	return Document{
		Name:    filepath.Base(path),
		Path:    path,
		Size:    info.Size(),
		ModTime: info.ModTime().Format("2006-01-02 15:04"),
	}, nil
}

// GetAppState returns the saved app state from SQLite
func (a *App) GetAppState() AppState {
	if a.db == nil {
		return AppState{}
	}
	dir, _ := a.db.GetState("documentDir")
	docsRaw, _ := a.db.GetState("openDocs")
	var openDocs []string
	if docsRaw != "" {
		json.Unmarshal([]byte(docsRaw), &openDocs)
	}
	return AppState{DocumentDir: dir, OpenDocs: openDocs}
}

func (a *App) saveState(state AppState) {
	if a.db == nil {
		return
	}
	a.db.SetState("documentDir", state.DocumentDir)
	// migrate old json file if exists
	oldPath := filepath.Join(a.configDir, "state.json")
	if _, err := os.Stat(oldPath); err == nil {
		os.Rename(oldPath, oldPath+".bak")
	}
	if len(state.OpenDocs) > 0 {
		data, _ := json.Marshal(state.OpenDocs)
		a.db.SetState("openDocs", string(data))
	}
}

// SaveAppSetting saves a key/value setting to SQLite
func (a *App) SaveAppSetting(key, value string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.SetSetting(key, value)
}

// LoadAppSettings returns all settings from SQLite
func (a *App) LoadAppSettings() (map[string]string, error) {
	if a.db == nil {
		return map[string]string{}, nil
	}
	return a.db.GetAllSettings()
}

// AddRecentFile adds a file to the recent list
func (a *App) AddRecentFile(path, name string) error {
	if a.db == nil {
		return fmt.Errorf("db not available")
	}
	return a.db.AddRecentFile(path, name)
}

// ListRecentFiles returns recently opened files
func (a *App) ListRecentFiles(limit int) ([]Document, error) {
	if a.db == nil {
		return nil, fmt.Errorf("db not available")
	}
	return a.db.ListRecentFiles(limit)
}
