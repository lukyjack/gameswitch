package utils

import (
	"bufio"
	"errors"
	"fmt"
	"github.com/pufferpanel/pufferpanel/v3/logging"
	"github.com/pufferpanel/pufferpanel/v3/sys"
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"strings"
)

func testOpenat2() bool {
	return testOpenat2WithSymbols(os.Open)
}

func testOpenat2WithSymbols(openSymbols func(string) (*os.File, error)) bool {
	f, err := openSymbols("/proc/kallsyms")
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
		logging.Info.Printf("Could not open /proc/kallsyms to validate kernel support, falling back to temp file test\n%s", err.Error())

		var testPath string
		testPath, err = os.MkdirTemp(os.TempDir(), "puffer-openat2-test-*")
		if err != nil {
			panic(fmt.Errorf("failed to validate kernel support with test file\n%s", err.Error()))
		}
		defer func(directory string) {
			_ = os.Remove(filepath.Join(directory, "validate"))
			_ = os.Remove(directory)
		}(testPath)

		var testFile *os.File
		testFile, err = os.Open(testPath)
		if err != nil {
			panic(fmt.Errorf("failed to validate kernel support with test file\n%s", err.Error()))
		}
		defer Close(testFile)

		//we have a file now, let's see if we can... read it with openat2
		var fd int
		fd, err = unix.Openat2(int(testFile.Fd()), "validate", &unix.OpenHow{
			Flags:   uint64(os.O_CREATE | os.O_RDWR | unix.O_CLOEXEC),
			Mode:    uint64(sys.SyscallMode(0644)),
			Resolve: unix.RESOLVE_BENEATH,
		})
		if err == nil {
			_ = unix.Close(fd)
			useOpenat2 = true
		} else if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) {
			logging.Info.Printf("Openat2 test syscall is unavailable: %v", err)
			useOpenat2 = false
		} else {
			panic(fmt.Errorf("failed to validate kernel support with test file\n%s", err.Error()))
		}
	} else if err == nil {
		defer Close(f)
		reader := bufio.NewScanner(f)
		var line string
		for reader.Scan() {
			line = reader.Text()
			if strings.Contains(line, " t do_sys_openat2") {
				useOpenat2 = true
				break
			}
		}
	} else {
		panic(fmt.Errorf("Could not open /proc/kallsyms to validate kernel support\n%s", err.Error()))
	}
	return useOpenat2
}
