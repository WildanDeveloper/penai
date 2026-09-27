package app

import (
	"encoding/json"
	"testing"
)

// TestEveryDecodedMessageHasExportedFields is a regression test for a bug worth
// remembering: the reply types declared unexported fields, and encoding/json
// cannot set those at all. The message arrived, every field in it was zero, and
// the interface just said "no preview yet" with nothing wrong visible anywhere.
//
// Every struct decoded from the wire is exported and tagged; this decodes a real
// reply into each one and checks a field the view depends on.
func TestEveryDecodedMessageHasExportedFields(t *testing.T) {
	cases := []struct {
		name  string
		reply string
		// fresh returns an empty message to decode into.
		fresh func() interface{}
		// check receives whatever fresh returned, decoded.
		check func(t *testing.T, decoded interface{})
	}{
		{
			name:  "report.preview",
			reply: `{"format":"markdown","body":"# Report\n\n| Engagement | x |"}`,
			fresh: func() interface{} { return &reportMsg{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*reportMsg)
				if got.Format != "markdown" {
					t.Errorf("format = %q", got.Format)
				}
				if !contains(got.Body, "Report") {
					t.Errorf("body did not decode: %q", got.Body)
				}
			},
		},
		{
			name:  "report.export",
			reply: `{"format":"html","path":"/tmp/report.html","bytes":4096,"findings":3}`,
			fresh: func() interface{} { return &exportMsg{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*exportMsg)
				if got.Path != "/tmp/report.html" {
					t.Errorf("path = %q", got.Path)
				}
				if got.Bytes != 4096 || got.Findings != 3 {
					t.Errorf("bytes/findings = %d/%d", got.Bytes, got.Findings)
				}
			},
		},
		{
			name:  "findings",
			reply: `{"findings":[{"id":"fnd_1","title":"A","severity":"high","status":"open"}]}`,
			fresh: func() interface{} { return &findingsMsg{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*findingsMsg)
				if len(got.Findings) != 1 || got.Findings[0].ID != "fnd_1" {
					t.Errorf("findings did not decode: %+v", got.Findings)
				}
			},
		},
		{
			name:  "scope",
			reply: `{"targets":[{"id":"tgt_1","value":"127.0.0.1","kind":"ip"}]}`,
			fresh: func() interface{} { return &scopeMsg{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*scopeMsg)
				if len(got.Targets) != 1 || got.Targets[0].Value != "127.0.0.1" {
					t.Errorf("targets did not decode: %+v", got.Targets)
				}
			},
		},
		{
			name:  "model sources",
			reply: `{"sources":[{"id":"local","kind":"openai","baseUrl":"https://x/v1","models":["a","b"]}]}`,
			fresh: func() interface{} { return &sourcesMsg{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*sourcesMsg)
				if len(got.Sources) != 1 || len(got.Sources[0].Models) != 2 {
					t.Errorf("sources did not decode: %+v", got.Sources)
				}
			},
		},
		{
			name:  "tool run",
			reply: `{"allowed":true,"tool":"http_probe","ok":true,"summary":"1 responsive","evidence":"HTTP/1.1 200","durationMs":42}`,
			fresh: func() interface{} { return &toolRun{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*toolRun)
				if got.Tool != "http_probe" || !got.OK || got.Summary != "1 responsive" {
					t.Errorf("tool run did not decode: %+v", got)
				}
			},
		},
		{
			name:  "refused tool run",
			reply: `{"allowed":false,"tool":"dir_fuzz","action":"manual","risk":"medium","reason":"approval required"}`,
			fresh: func() interface{} { return &toolRun{} },
			check: func(t *testing.T, decoded interface{}) {
				got := decoded.(*toolRun)
				if got.Allowed {
					t.Error("a refusal decoded as a run")
				}
				if got.Reason != "approval required" || got.Risk != "medium" {
					t.Errorf("the reason for the refusal was lost: %+v", got)
				}
			},
		},
	}

	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			decoded := item.fresh()
			if err := json.Unmarshal([]byte(item.reply), decoded); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			item.check(t, decoded)
		})
	}
}
