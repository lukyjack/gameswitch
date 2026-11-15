package main

import (
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/pufferpanel/pufferpanel/v3/config"
)

func TestReadBootstrapPassword(t *testing.T) {
	for _, test := range []struct {
		name, input, expected string
		invalid               bool
	}{
		{"newline", "test-only-long-password\n", "test-only-long-password", false},
		{"crlf", "test-only-long-password\r\n", "test-only-long-password", false},
		{"empty", "\n", "", true},
		{"multiple-lines", "password\nother\n", "", true},
		{"nul", "pass\x00word", "", true},
		{"oversized", strings.Repeat("x", 1025), "", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual, err := readBootstrapPassword(strings.NewReader(test.input))
			if (err != nil) != test.invalid || actual != test.expected {
				t.Fatalf("unexpected stdin validation result")
			}
		})
	}
}

func TestAddUserDatabaseFailureExitsNonzero(t *testing.T) {
	if os.Getenv("GAMESWITCH_TEST_FAILED_USER_ADD") == "1" {
		_ = config.DatabaseDialect.Set("gameswitch-invalid-test-dialect", false)
		addUsername = "gameswitch-test-only"
		addEmail = "gameswitch-test-only@localhost.invalid"
		addPassword = "test-only-long-bootstrap-password"
		addUser(AddUserCmd, nil)
		return
	}
	command := exec.Command(os.Args[0], "-test.run=^TestAddUserDatabaseFailureExitsNonzero$")
	command.Env = append(os.Environ(), "GAMESWITCH_TEST_FAILED_USER_ADD=1")
	output, err := command.CombinedOutput()
	if err == nil {
		t.Fatal("database failure must exit with a nonzero status")
	}
	if !strings.Contains(string(output), "Failed to connect to database") {
		t.Fatal("subprocess did not exercise the database failure path")
	}
}
