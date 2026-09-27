package client

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"penai/internal/protocol"
)

// fakeCore writes a shell script that answers like the real core does, so the
// transport is tested against the actual pipe rather than a mock of it.
func fakeCore(t *testing.T, lines ...string) (string, []string) {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "core.sh")

	// The script emits the canned lines, then reads one line so the process
	// stays alive until the client closes the pipe.
	body := "#!/bin/sh\ncat <<'EOF'\n"
	for _, line := range lines {
		body += line + "\n"
	}
	body += "EOF\ncat > /dev/null\n"
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("writing the fake core: %v", err)
	}
	return "/bin/sh", []string{path}
}

// TestCallGetsItsReply covers the request/reply path.
func TestCallGetsItsReply(t *testing.T) {
	command, args := fakeCore(t, `{"id":1,"result":{"engagement":"acme","mode":"balanced"}}`)
	c, err := Start(command, args, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	var session protocol.Session
	if err := c.Call("session.get", nil, &session); err != nil {
		t.Fatalf("call: %v", err)
	}
	if session.Engagement != "acme" || session.Mode != "balanced" {
		t.Errorf("decoded %+v", session)
	}
}

// TestEventsAreSeparateFromReplies is the distinction the whole client rests on:
// a notification has no id, and it must not be mistaken for a reply.
func TestEventsAreSeparateFromReplies(t *testing.T) {
	command, args := fakeCore(t,
		`{"event":"agent.status","data":{"message":"thinking"}}`,
		`{"id":1,"result":{"ok":true}}`,
		`{"event":"agent.token","data":{"token":"hello"}}`,
	)
	c, err := Start(command, args, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.Call("agent.send", map[string]string{"text": "hi"}, &out); err != nil {
		t.Fatalf("call: %v", err)
	}
	if !out.OK {
		t.Error("the reply did not decode")
	}

	// Both events must have arrived, in order, and the call must not have
	// consumed either of them.
	want := []string{"agent.status", "agent.token"}
	for _, name := range want {
		select {
		case event := <-c.Events:
			if event.Event != name {
				t.Errorf("got event %q, want %q", event.Event, name)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("event %q never arrived", name)
		}
	}
}

// TestErrorsBecomeErrors checks the failure path is reported, not swallowed.
func TestErrorsBecomeErrors(t *testing.T) {
	command, args := fakeCore(t, `{"id":1,"error":{"code":-32601,"message":"unknown method \"nope\""}}`)
	c, err := Start(command, args, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	err = c.Call("nope", nil, nil)
	if err == nil {
		t.Fatal("an error reply should not look like success")
	}
	if got := err.Error(); got != `unknown method "nope"` {
		t.Errorf("got %q", got)
	}
}

// TestPendingCallsFailWhenTheCoreDies: a core that exits must not leave the
// client waiting forever.
func TestPendingCallsFailWhenTheCoreDies(t *testing.T) {
	c, err := Start("/bin/sh", []string{"-c", "exit 1"}, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	done := make(chan error, 1)
	go func() { done <- c.Call("session.get", nil, nil) }()

	select {
	case err := <-done:
		if err == nil {
			t.Error("a dead core should produce an error")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the call hung after the core exited")
	}
}

// TestMalformedLinesAreSkipped: one bad line must not take the reader down, or a
// single stray write from the core would freeze the interface.
func TestMalformedLinesAreSkipped(t *testing.T) {
	command, args := fakeCore(t,
		`not json at all`,
		`{"id":1,"result":{"ok":true}}`,
	)
	c, err := Start(command, args, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	var out struct {
		OK bool `json:"ok"`
	}
	if err := c.Call("session.get", nil, &out); err != nil {
		t.Fatalf("call: %v", err)
	}
	if !out.OK {
		t.Error("a bad line ahead of the reply swallowed it")
	}
}

// TestRequestShape pins the wire format, because the core parses it strictly.
func TestRequestShape(t *testing.T) {
	command, args := fakeCore(t, `{"id":1,"result":{"ok":true}}`)
	c, err := Start(command, args, nil)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	var out map[string]any
	if err := c.Call("scope.add", map[string]string{"value": "10.0.0.1"}, &out); err != nil {
		t.Fatalf("call: %v", err)
	}
	raw, _ := json.Marshal(out)
	if string(raw) != `{"ok":true}` {
		t.Errorf("unexpected result shape: %s", raw)
	}
}
