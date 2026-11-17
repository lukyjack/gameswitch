package servers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"github.com/pufferpanel/pufferpanel/v3"
)

func TestDockerStartFailureRemovesOnlyTheCreatedContainer(t *testing.T) {
	const containerID = "new-container-id"
	removed := make(chan string, 1)
	daemon := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/containers/"+containerID+"/attach"):
			conn, stream, err := http.NewResponseController(w).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.Close()
			_, _ = stream.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n")
			_ = stream.Flush()
			_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
			_, _ = io.Copy(io.Discard, stream)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/containers/"+containerID+"/start"):
			http.Error(w, `{"message":"port is already allocated"}`, http.StatusInternalServerError)
		case r.Method == http.MethodDelete:
			removed <- r.URL.RequestURI()
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected Docker request: %s %s", r.Method, r.URL)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer daemon.Close()
	dockerClient, err := client.New(client.WithHost(strings.Replace(daemon.URL, "http://", "tcp://", 1)), client.WithAPIVersion("1.56"))
	if err != nil {
		t.Fatal(err)
	}
	defer dockerClient.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	program := CreateProgram()
	program.Identifier = "profile-name"
	environment := &pufferpanel.Environment{
		Server: program, Wrapper: io.Discard, ConsoleBuffer: pufferpanel.CreateCache(), ConsoleTracker: pufferpanel.CreateTracker(),
	}
	docker := &Docker{}
	err = docker.startContainer(ctx, dockerClient, containerID, environment, pufferpanel.ExecutionData{})
	if err == nil || !strings.Contains(err.Error(), "port is already allocated") {
		t.Fatalf("expected Docker's start error, got %v", err)
	}
	select {
	case uri := <-removed:
		if !strings.HasSuffix(uri, "/containers/"+containerID) {
			t.Fatalf("expected removal by exact ID without force or volume flags, got %s", uri)
		}
	default:
		t.Fatal("failed start left the created container behind")
	}
	if environment.Console != nil {
		t.Fatal("failed start initialized the running console")
	}
}
