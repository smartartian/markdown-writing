package main

import (
	"encoding/base64"
	"errors"
	"strings"
)

const maxApplicationIconBytes = 8 << 20

// SetApplicationIcon updates the running macOS application icon from a PNG data URL.
func (a *App) SetApplicationIcon(dataURL string) error {
	data, err := decodeApplicationIcon(dataURL)
	if err != nil {
		return err
	}
	return setApplicationIconImage(data)
}

func decodeApplicationIcon(dataURL string) ([]byte, error) {
	encoded := strings.TrimSpace(dataURL)
	if !strings.HasPrefix(encoded, "data:image/png;base64,") {
		return nil, errors.New("application icon must be a PNG data URL")
	}
	encoded = strings.TrimPrefix(encoded, "data:image/png;base64,")
	if encoded == "" {
		return nil, errors.New("application icon data is empty")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, errors.New("application icon data is invalid")
	}
	if len(data) == 0 || len(data) > maxApplicationIconBytes {
		return nil, errors.New("application icon size is invalid")
	}
	return data, nil
}

// macOS 26 起系统会给「打包图标」自动套用新图标样式（把图形缩进磁贴的 824/1024 再加圆角），
// 而运行时用 setApplicationIconImage: 设置的图标不会被缩进、直接铺满磁贴。所以只有这些系统
// 才需要前端自己先缩进去，程序坞里才和打包图标一样大；旧系统的打包图标本来就是满磁贴的。
const applicationIconContentRatioWithAutoStyling = 824.0 / 1024.0

const applicationIconAutoStylingMinimumMajorVersion = 26

func applicationIconContentRatioForVersion(majorVersion int) float64 {
	if majorVersion >= applicationIconAutoStylingMinimumMajorVersion {
		return applicationIconContentRatioWithAutoStyling
	}
	return 1
}

func applicationIconContentRatio() float64 {
	return applicationIconContentRatioForVersion(macosMajorVersion())
}

// GetApplicationIconContentRatio returns the share of the Dock tile that the runtime
// application icon must occupy on this system, so it matches the packaged icon.
func (a *App) GetApplicationIconContentRatio() float64 {
	return applicationIconContentRatio()
}
