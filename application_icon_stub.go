//go:build !darwin || !cgo

package main

import "errors"

func macosMajorVersion() int {
	return 0
}

func setApplicationIconImage([]byte) error {
	return errors.New("dynamic application icons are only supported on macOS")
}
