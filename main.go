package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	AppMenu := menu.NewMenu()
	FileMenu := AppMenu.AddSubmenu("文件")
	FileMenu.AddText("保存", nil, func(_ *menu.CallbackData) {
		app.MenuSave()
	})
	FileMenu.AddText("另存为...", nil, func(_ *menu.CallbackData) {
		app.MenuSaveAs()
	})
	EditMenu := AppMenu.AddSubmenu("编辑")
	EditMenu.AddText("剪切", keys.CmdOrCtrl("x"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:cut")
	})
	EditMenu.AddText("复制", keys.CmdOrCtrl("c"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:copy")
	})
	EditMenu.AddText("粘贴", keys.CmdOrCtrl("v"), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "menu:paste")
	})

	err := wails.Run(&options.App{
		Title:     "Markdown Writing",
		Width:     1200,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		Menu:      AppMenu,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 229, G: 221, B: 208, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		OnBeforeClose:    app.beforeClose,
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
