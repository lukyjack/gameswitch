package servers

import (
	"archive/tar"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pufferpanel/pufferpanel/v3"
	"github.com/pufferpanel/pufferpanel/v3/files"
)

type backupTestEnvironment struct{}

func (backupTestEnvironment) ExecuteAsyncImpl(*pufferpanel.Environment, pufferpanel.ExecutionData) error {
	return nil
}
func (backupTestEnvironment) KillImpl(*pufferpanel.Environment) error { return nil }
func (backupTestEnvironment) GetStatsImpl(*pufferpanel.Environment) (*pufferpanel.ServerStats, error) {
	return &pufferpanel.ServerStats{}, nil
}
func (backupTestEnvironment) SendCodeImpl(*pufferpanel.Environment, int) error { return nil }
func (backupTestEnvironment) GetUidImpl(*pufferpanel.Environment) int          { return os.Getuid() }
func (backupTestEnvironment) GetGidImpl(*pufferpanel.Environment) int          { return os.Getgid() }
func (backupTestEnvironment) IsRunningImpl(*pufferpanel.Environment) (bool, error) {
	return false, nil
}

func newBackupTestServer(t *testing.T) *Server {
	t.Helper()
	p := CreateProgram()
	p.Identifier = "backup-test"
	p.RunningEnvironment = &pufferpanel.Environment{
		Implementation: backupTestEnvironment{}, Wrapper: io.Discard,
		ConsoleBuffer: pufferpanel.CreateCache(), ConsoleTracker: pufferpanel.CreateTracker(),
	}
	var err error
	p.fileServer, err = files.NewFileServer(t.TempDir(), os.Getuid(), os.Getgid(), false)
	if err != nil {
		t.Fatal(err)
	}
	p.backupServer, err = files.NewFileServer(t.TempDir(), os.Getuid(), os.Getgid(), false)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.fileServer.Close(); _ = p.backupServer.Close() })
	return p
}

func TestBackupWaitCreatesRestorableSnapshot(t *testing.T) {
	p := newBackupTestServer(t)
	if err := p.fileServer.MkdirAll("world", 0755); err != nil {
		t.Fatal(err)
	}
	if err := p.fileServer.WriteFile("world/level.dat", []byte("original world"), 0644); err != nil {
		t.Fatal(err)
	}
	fileName, err := p.Backup()
	if err != nil {
		t.Fatal(err)
	}
	status := p.BackupStatus()
	if status.State != "succeeded" || status.FileName != fileName || status.CompletedAt == nil || p.IsBackingUp() {
		t.Fatalf("unexpected completed backup status: %+v", status)
	}
	if err := p.fileServer.WriteFile("world/level.dat", []byte("new world"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := p.Restore(fileName); err != nil {
		t.Fatal(err)
	}
	data, err := p.fileServer.ReadFile("world/level.dat")
	if err != nil || string(data) != "original world" {
		t.Fatalf("restored world = %q, error = %v", data, err)
	}
	if status := p.RestoreStatus(); status.State != "succeeded" || p.IsRestoring() {
		t.Fatalf("unexpected restore status: %+v", status)
	}
}

func TestAsyncBackupFailureIsReportedAndIncompleteArchiveRemoved(t *testing.T) {
	p := newBackupTestServer(t)
	// Compression uses the configured source path; a removed source
	// produces an actual filesystem failure after the async request is accepted.
	if err := os.Remove(p.fileServer.Prefix()); err != nil {
		t.Fatal(err)
	}
	fileName, err := p.StartBackup()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for p.IsBackingUp() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	status := p.BackupStatus()
	if status.State != "failed" || status.Error == "" || status.CompletedAt == nil || status.FileName != fileName {
		t.Fatalf("backup failure was not preserved: %+v", status)
	}
	if _, err := os.Stat(filepath.Join(p.backupServer.Prefix(), fileName)); !os.IsNotExist(err) {
		t.Fatalf("incomplete archive remains: %v", err)
	}
}

func TestRestoreMissingOrCorruptBackupPreservesCurrentWorld(t *testing.T) {
	for _, name := range []string{"missing.tar.gz", "corrupt.tar.gz"} {
		t.Run(name, func(t *testing.T) {
			p := newBackupTestServer(t)
			if err := p.fileServer.WriteFile("level.dat", []byte("keep me"), 0644); err != nil {
				t.Fatal(err)
			}
			if name == "corrupt.tar.gz" {
				if err := p.backupServer.WriteFile(name, []byte("invalid archive"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			if err := p.Restore(name); err == nil {
				t.Fatal("restore must reject invalid backup")
			}
			data, err := p.fileServer.ReadFile("level.dat")
			if err != nil || string(data) != "keep me" || p.IsRestoring() {
				t.Fatalf("current world changed: %q, error=%v", data, err)
			}
		})
	}
}

func TestBackupReservationRejectsConcurrentOperation(t *testing.T) {
	p := newBackupTestServer(t)
	p.setFileOperation(false, pufferpanel.ServerFileOperationStatus{State: "running", FileName: "active.tar.gz"})
	if _, err := p.Backup(); err == nil {
		t.Fatal("a second backup must not start")
	}
	if err := p.Restore("other.tar.gz"); err == nil {
		t.Fatal("restore must not overlap a backup")
	}
	if err := p.Start(); err == nil {
		t.Fatal("server must not start while snapshot is being written")
	}
}

func TestRestoreRejectsUnsafeArchiveEntriesBeforeChangingWorld(t *testing.T) {
	for _, header := range []tar.Header{
		{Name: "world/../../outside", Typeflag: tar.TypeReg, Mode: 0644},
		{Name: "/absolute/outside", Typeflag: tar.TypeReg, Mode: 0644},
		{Name: "world/link", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd", Mode: 0777},
		{Name: "world/link", Typeflag: tar.TypeLink, Linkname: "../../outside", Mode: 0644},
	} {
		t.Run(header.Name+string(header.Typeflag), func(t *testing.T) {
			p := newBackupTestServer(t)
			if err := p.fileServer.WriteFile("level.dat", []byte("keep me"), 0644); err != nil {
				t.Fatal(err)
			}
			archive, err := p.backupServer.Create("unsafe.tar.gz")
			if err != nil {
				t.Fatal(err)
			}
			compressed := gzip.NewWriter(archive)
			writer := tar.NewWriter(compressed)
			if err := writer.WriteHeader(&header); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err := compressed.Close(); err != nil {
				t.Fatal(err)
			}
			if err := archive.Close(); err != nil {
				t.Fatal(err)
			}
			if err := p.Restore("unsafe.tar.gz"); err == nil {
				t.Fatal("unsafe backup must be rejected")
			}
			data, err := p.fileServer.ReadFile("level.dat")
			if err != nil || string(data) != "keep me" {
				t.Fatalf("current world changed: %q, error=%v", data, err)
			}
		})
	}
}

func TestBackupRejectsGameCreatedSymlink(t *testing.T) {
	p := newBackupTestServer(t)
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("outside data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(p.fileServer.Prefix(), "link")); err != nil {
		t.Fatal(err)
	}
	fileName, err := p.Backup()
	if err == nil || p.BackupStatus().State != "failed" {
		t.Fatal("a snapshot containing links must not be offered as restorable")
	}
	if _, err := p.backupServer.Stat(fileName); !os.IsNotExist(err) {
		t.Fatalf("unrestorable archive remains: %v", err)
	}
	data, err := os.ReadFile(outside)
	if err != nil || string(data) != "outside data" {
		t.Fatal("backup changed a file outside the server")
	}
}
