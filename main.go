package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func buildAppMenu(app *App) *menu.Menu {
	appMenu := menu.NewMenu()
	FileMenu := appMenu.AddSubmenu("文件")
	FileMenu.AddText("保存", nil, func(_ *menu.CallbackData) {
		app.MenuSave()
	})
	FileMenu.AddText("另存为...", nil, func(_ *menu.CallbackData) {
		app.MenuSaveAs()
	})
	// 编辑菜单必须交给 macOS 原生角色处理：自定义菜单项会抢占 Cmd+X/C/V 且无法把剪贴板内容
	// 送入网页视图，结果是剪切/复制/粘贴快捷键完全失效（菜单回调只是发事件，没有任何实现）。
	appMenu.Append(menu.EditMenu())
	return appMenu
}

func main() {
	app := NewApp()
	AppMenu := buildAppMenu(app)

	// 默认 1200×800；用户拖过窗口之后，按上次的尺寸打开（存在本地 DB 的 app_state 里）。
	windowWidth, windowHeight := app.WindowSize()

	err := wails.Run(&options.App{
		Title:     "Markdown Writing",
		Width:     windowWidth,
		Height:    windowHeight,
		MinWidth:  minWindowWidth,
		MinHeight: minWindowHeight,
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
