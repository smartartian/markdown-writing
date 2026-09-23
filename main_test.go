package main

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

func TestBuildAppMenuUsesNativeEditMenu(t *testing.T) {
	appMenu := buildAppMenu(&App{})

	if len(appMenu.Items) != 2 {
		t.Fatalf("menu item count = %d; want 2", len(appMenu.Items))
	}

	editItem := appMenu.Items[1]
	if editItem.Role != menu.EditMenuRole {
		t.Fatalf("edit menu role = %d; want %d", editItem.Role, menu.EditMenuRole)
	}
	if editItem.Accelerator != nil {
		t.Fatalf("native edit menu unexpectedly defines accelerator %v", editItem.Accelerator)
	}
	if editItem.Click != nil {
		t.Fatal("native edit menu unexpectedly intercepts clipboard commands")
	}
}
