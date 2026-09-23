//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static void macos_product_version(int *major, int *minor, int *patch) {
  @autoreleasepool {
    NSOperatingSystemVersion version = [[NSProcessInfo processInfo] operatingSystemVersion];
    if (major != NULL) {
      *major = (int)version.majorVersion;
    }
    if (minor != NULL) {
      *minor = (int)version.minorVersion;
    }
    if (patch != NULL) {
      *patch = (int)version.patchVersion;
    }
  }
}

static int set_application_icon(const void *bytes, int length) {
  @autoreleasepool {
    NSData *data = [NSData dataWithBytes:bytes length:(NSUInteger)length];
    NSImage *image = [[NSImage alloc] initWithData:data];
    if (image == nil) {
      return 0;
    }
    NSApplication *application = [NSApplication sharedApplication];
    [application performSelectorOnMainThread:@selector(setApplicationIconImage:)
                                  withObject:image
                               waitUntilDone:NO];
    return 1;
  }
}
*/
import "C"

import (
	"errors"
	"unsafe"
)

func macosMajorVersion() int {
	var major C.int
	C.macos_product_version(&major, nil, nil)
	return int(major)
}

func setApplicationIconImage(data []byte) error {
	if len(data) == 0 {
		return errors.New("application icon data is empty")
	}
	result := C.set_application_icon(unsafe.Pointer(&data[0]), C.int(len(data)))
	if result == 0 {
		return errors.New("failed to create macOS application icon")
	}
	return nil
}
