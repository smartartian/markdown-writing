package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeApplicationIcon(t *testing.T) {
	payload := []byte{0x89, 0x50, 0x4e, 0x47}
	dataURL := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)

	decoded, err := decodeApplicationIcon(dataURL)
	if err != nil {
		t.Fatalf("decodeApplicationIcon: %v", err)
	}
	if string(decoded) != string(payload) {
		t.Fatalf("decoded = %v; want %v", decoded, payload)
	}
}

func TestDecodeApplicationIconRejectsInvalidInput(t *testing.T) {
	tests := []string{
		"",
		"https://example.com/icon.png",
		"data:image/png;base64,",
		"data:image/png;base64,not-valid-base64",
	}

	for _, input := range tests {
		if _, err := decodeApplicationIcon(input); err == nil {
			t.Fatalf("decodeApplicationIcon(%q) succeeded; want error", strings.TrimSpace(input))
		}
	}
}

func TestApplicationIconContentRatioFollowsSystemIconStyling(t *testing.T) {
	// macOS 26 起系统自动套用新图标样式：运行时图标要自己缩进 824/1024。
	for _, major := range []int{26, 27, 30} {
		if got := applicationIconContentRatioForVersion(major); got != 824.0/1024.0 {
			t.Fatalf("applicationIconContentRatioForVersion(%d) = %v; want %v", major, got, 824.0/1024.0)
		}
	}

	// 更早的 macOS 打包图标就是满磁贴的，缩进去反而会比打包图标小。
	for _, major := range []int{0, 10, 13, 14, 15, 25} {
		if got := applicationIconContentRatioForVersion(major); got != 1 {
			t.Fatalf("applicationIconContentRatioForVersion(%d) = %v; want 1", major, got)
		}
	}
}
