package utils

import (
	"errors"
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

func TestOpenat2FallsBackWhenKernelSymbolsAreUnavailable(t *testing.T) {
	previous := useOpenat2
	t.Cleanup(func() { useOpenat2 = previous })
	for _, test := range []struct {
		name string
		err  error
	}{
		{"permission", os.ErrPermission},
		{"access-denied", unix.EACCES},
		{"operation-not-permitted", unix.EPERM},
		{"missing", os.ErrNotExist},
	} {
		t.Run(test.name, func(t *testing.T) {
			directory := t.TempDir()
			t.Setenv("TMPDIR", directory)
			useOpenat2 = false
			calls := 0
			available := testOpenat2WithSymbols(func(name string) (*os.File, error) {
				calls++
				if name != "/proc/kallsyms" {
					t.Fatalf("unexpected symbols path: %s", name)
				}
				return nil, &os.PathError{Op: "open", Path: name, Err: test.err}
			})
			if calls != 1 || !available || !UseOpenat2() {
				t.Fatal("the real openat2 syscall probe must enable supported kernels")
			}
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 0 {
				t.Fatalf("probe left temporary files behind: %v, %v", entries, err)
			}
		})
	}
}

func TestOpenat2DoesNotIgnoreUnexpectedKernelSymbolErrors(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("unexpected errors must fail closed")
		}
	}()
	testOpenat2WithSymbols(func(name string) (*os.File, error) {
		return nil, &os.PathError{Op: "open", Path: name, Err: errors.New("unexpected I/O failure")}
	})
}

func TestOpenat2AvailableUnderCurrentProcess(t *testing.T) {
	previous := useOpenat2
	t.Cleanup(func() { useOpenat2 = previous })
	if !testOpenat2() || !UseOpenat2() {
		t.Fatal("openat2 must be supported by the current process environment")
	}
}
