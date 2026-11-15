package servers

import (
	"time"

	"github.com/pufferpanel/pufferpanel/v3"
	"github.com/pufferpanel/pufferpanel/v3/logging"
)

func (p *Server) setFileOperation(restore bool, status pufferpanel.ServerFileOperationStatus) {
	p.fileStatusMu.Lock()
	defer p.fileStatusMu.Unlock()
	if restore {
		p.restoreStatus = status
	} else {
		p.backupStatus = status
	}
}

func (p *Server) finishFileOperation(restore bool, fileName string, err error) {
	now := time.Now().UTC()
	status := pufferpanel.ServerFileOperationStatus{
		State: "succeeded", FileName: fileName, CompletedAt: &now,
	}
	label := "Backup"
	if restore {
		label = "Restore"
	}
	if err != nil {
		status.State = "failed"
		status.Error = err.Error()
		p.Log(logging.Error, "%s failed: %s", label, err)
		p.RunningEnvironment.DisplayToConsole(true, "%s failed: %s", label, err)
	} else {
		p.RunningEnvironment.DisplayToConsole(true, "%s complete", label)
	}
	p.setFileOperation(restore, status)
}

func (p *Server) BackupStatus() pufferpanel.ServerFileOperationStatus {
	p.fileStatusMu.RLock()
	defer p.fileStatusMu.RUnlock()
	status := p.backupStatus
	if status.State == "" {
		status.State = "idle"
	}
	return status
}

func (p *Server) RestoreStatus() pufferpanel.ServerFileOperationStatus {
	p.fileStatusMu.RLock()
	defer p.fileStatusMu.RUnlock()
	status := p.restoreStatus
	if status.State == "" {
		status.State = "idle"
	}
	return status
}
