package pufferpanel

import (
	"time"

	"github.com/pufferpanel/pufferpanel/v3/utils"
)

type ServerIdResponse struct {
	Id string `json:"id"`
} //@name ServerId

type ServerStats struct {
	Cpu    float64         `json:"cpu"`
	Memory float64         `json:"memory"`
	Jvm    *utils.JvmStats `json:"jvm,omitempty"`
} //@name ServerStats

type ServerLogs struct {
	Epoch int64  `json:"epoch"`
	Logs  []byte `json:"logs"`
} //@name ServerLogs

type ServerRunning struct {
	Running    bool `json:"running"`
	Installing bool `json:"installing"`
	// GameSwitchVersion identifies the synchronous, error-reporting backup API.
	GameSwitchVersion int                        `json:"gameswitchVersion,omitempty"`
	BackingUp         bool                       `json:"backingUp"`
	Restoring         bool                       `json:"restoring"`
	Backup            *ServerFileOperationStatus `json:"backup,omitempty"`
	Restore           *ServerFileOperationStatus `json:"restore,omitempty"`
} //@name ServerRunning

// ServerFileOperationStatus reports the result of the most recent file operation.
// A successful HTTP request to the asynchronous API only starts the operation;
// callers must wait for state=succeeded or use the wait=true API.
type ServerFileOperationStatus struct {
	State       string     `json:"state"`
	FileName    string     `json:"fileName,omitempty"`
	Error       string     `json:"error,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
}

type ServerData struct {
	Variables map[string]Variable `json:"data"`
	Groups    []Group             `json:"groups,omitempty"`
} //@name ServerData

type ServerDataAdmin struct {
	*Server
}

type DaemonRunning struct {
	Message string `json:"message"`
} //@name DaemonRunning

type ServerTasks struct {
	Tasks map[string]ServerTask `json:"tasks"`
} //@name ServerTasks

type ServerTask struct {
	//IsRunning bool `json:"isRunning"`
	Task
} //@name ServerTask

type ErrorResponse struct {
	Error *Error `json:"error"`
} //@name ErrorResponse

type Metadata struct {
	Paging *Paging `json:"paging"`
} //@name Metadata

type Paging struct {
	Page    uint  `json:"page"`
	Size    uint  `json:"pageSize"`
	MaxSize uint  `json:"maxSize"`
	Total   int64 `json:"total"`
} //@name Paging

type ServerFlags struct {
	AutoStart             *bool `json:"autoStart,omitempty"`
	AutoRestartOnCrash    *bool `json:"autoRestartOnCrash,omitempty"`
	AutoRestartOnGraceful *bool `json:"autoRestartOnGraceful,omitempty"`
} //@name ServerFlags

type ServerBackupResponse struct {
	BackupFileName string `json:"backupFileName"`
} //@name ServerBackup
