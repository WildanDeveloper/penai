package client

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"penai/internal/protocol"
)

// coreBinary locates the built core, so the integration tests can talk to the
// real thing rather than a stand-in.
func coreBinary(t *testing.T) (string, []string) {
	t.Helper()
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skip("no shell to run the core with")
	}
	root := filepath.Join("..", "..", "..")
	main := filepath.Join(root, "dist", "cmd", "penai", "main.js")
	if _, err := os.Stat(main); err != nil {
		t.Skipf("the core is not built; run npm run build (%s)", main)
	}
	if _, err := os.Stat("/usr/bin/node"); err != nil {
		if path, lookErr := lookPath("node"); lookErr != nil {
			t.Skip("node is not on PATH")
		} else {
			return path, []string{main, "serve"}
		}
	}
	return "/usr/bin/node", []string{main, "serve"}
}

// lookPath is exec.LookPath under another name, so the local helper below does
// not shadow the import.
func lookPath(name string) (string, error) { return exec.LookPath(name) }

// TestAgainstTheRealCore walks the whole surface the client depends on. A
// response that decodes here is a response the TUI can render, and this is the
// only test that would have caught a method whose reply shape quietly changed.
func TestAgainstTheRealCore(t *testing.T) {
	command, args := coreBinary(t)
	c, err := Start(command, args, []string{
		"PENAI_DATA_DIR=" + t.TempDir(),
		"PENAI_ENGAGEMENT=integration",
		"PENAI_MODE=balanced",
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	defer c.Close()

	t.Run("session", func(t *testing.T) {
		var session protocol.Session
		if err := c.Call("session.get", nil, &session); err != nil {
			t.Fatalf("session.get: %v", err)
		}
		if session.Engagement != "integration" {
			t.Errorf("engagement = %q", session.Engagement)
		}
		if session.Provider.Model == "" {
			t.Error("the session should always name a model, configured or not")
		}
		if len(session.Diagnoses) == 0 {
			t.Error("the session should report what it found in the configuration")
		}
	})

	t.Run("scope", func(t *testing.T) {
		var added struct {
			ID      string            `json:"id"`
			Kind    string            `json:"kind"`
			Targets []protocol.Target `json:"targets"`
		}
		if err := c.Call("scope.add", map[string]string{"value": "127.0.0.1", "note": "lab"}, &added); err != nil {
			t.Fatalf("scope.add: %v", err)
		}
		if added.Kind != "ip" {
			t.Errorf("kind = %q", added.Kind)
		}
		if len(added.Targets) != 1 {
			t.Errorf("targets = %d, want 1", len(added.Targets))
		}

		// A rejected target has to come back as an error, not as a silent no.
		err := c.Call("scope.add", map[string]string{"value": "not a target"}, nil)
		if err == nil {
			t.Error("an unparseable target should be refused")
		}

		var session protocol.Session
		if err := c.Call("session.get", nil, &session); err != nil {
			t.Fatalf("session.get: %v", err)
		}
		if len(session.Scope) != 1 {
			t.Errorf("the scope should hold the one target, got %d", len(session.Scope))
		}
	})

	t.Run("tools", func(t *testing.T) {
		var tools []protocol.Tool
		if err := c.Call("tools.list", nil, &tools); err != nil {
			t.Fatalf("tools.list: %v", err)
		}
		if len(tools) == 0 {
			t.Fatal("no tools are registered")
		}
		for _, tool := range tools {
			if tool.Name == "" || tool.Kind == "" || tool.Risk == "" {
				t.Errorf("incomplete tool record: %+v", tool)
			}
		}
		if !hasTool(tools, "http_probe") {
			t.Error("http_probe should be registered")
		}
	})

	t.Run("report preview", func(t *testing.T) {
		var preview reportBody
		if err := c.Call("report.preview", map[string]string{"format": "markdown"}, &preview); err != nil {
			t.Fatalf("report.preview: %v", err)
		}
		if !strings.Contains(preview.Body, "Penetration Test Report") {
			t.Errorf("the preview is not a report: %q", firstLine(preview.Body))
		}
		if len(preview.Body) < 100 {
			t.Errorf("the preview is suspiciously short: %d bytes", len(preview.Body))
		}
	})

	t.Run("report export", func(t *testing.T) {
		var out reportBody
		if err := c.Call("report.export", map[string]string{"format": "html"}, &out); err != nil {
			t.Fatalf("report.export: %v", err)
		}
		if out.Path == "" {
			t.Error("no path came back, so nothing was written")
		}
		if !strings.HasSuffix(out.Path, ".html") {
			t.Errorf("path = %q, want an html file", out.Path)
		}
		if _, err := os.Stat(out.Path); err != nil {
			t.Errorf("the report was not written: %v", err)
		}
	})

	t.Run("unknown method", func(t *testing.T) {
		if err := c.Call("does.not.exist", nil, nil); err == nil {
			t.Error("an unknown method should be refused")
		}
	})

	t.Run("findings", func(t *testing.T) {
		var added struct {
			Finding protocol.Finding `json:"finding"`
		}
		err := c.Call("findings.add", map[string]string{
			"title":       "Missing security header",
			"severity":    "low",
			"asset":       "127.0.0.1",
			"description": "No CSP is set.",
		}, &added)
		if err != nil {
			t.Fatalf("findings.add: %v", err)
		}
		if added.Finding.ID == "" {
			t.Fatal("a finding came back without an id")
		}
		if added.Finding.Status != "open" {
			t.Errorf("status = %q, want open", added.Finding.Status)
		}

		var updated struct {
			Finding protocol.Finding `json:"finding"`
		}
		if err := c.Call("findings.update", map[string]string{"id": added.Finding.ID, "status": "confirmed"}, &updated); err != nil {
			t.Fatalf("findings.update: %v", err)
		}
		if updated.Finding.Status != "confirmed" {
			t.Errorf("status = %q, want confirmed", updated.Finding.Status)
		}
	})

	t.Run("events", func(t *testing.T) {
		// runTool streams output events before its reply, which is what the
		// console renders while waiting.
		go func() {
			var run protocol.ToolRun
			_ = c.Call("tool.run", map[string]interface{}{
				"tool": "dns_resolve",
				"args": map[string]interface{}{"hosts": []string{"localhost"}},
			}, &run)
		}()

		deadline := time.After(5 * time.Second)
		saw := false
		for !saw {
			select {
			case event, ok := <-c.Events:
				if !ok {
					t.Fatal("the event channel closed early")
				}
				if event.Event == "tool.output" || event.Event == "tool.decision" {
					saw = true
				}
			case <-deadline:
				t.Fatal("running a tool produced no events")
			}
		}
	})
}

// reportBody is the shape of a report reply. The field has no json tag on
// purpose: that is how the client is written, so this test would catch the day
// somebody changes the wire format without changing the client.
type reportBody struct {
	Format string `json:"format"`
	Body   string
	Path   string `json:"path"`
	Bytes  int    `json:"bytes"`
}

func hasTool(tools []protocol.Tool, name string) bool {
	for _, tool := range tools {
		if tool.Name == name {
			return true
		}
	}
	return false
}

func firstLine(text string) string {
	if at := strings.Index(text, "\n"); at > 0 {
		return text[:at]
	}
	return text
}
