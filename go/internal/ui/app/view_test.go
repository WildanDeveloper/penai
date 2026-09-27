package app

import (
	"strings"
	"testing"

	"github.com/mattn/go-runewidth"

	"penai/internal/protocol"
	"penai/internal/ui/model"
)

// populated builds a state that looks like a real session, so the layout is
// tested against content rather than against an empty shell.
func populated(width, height int) *State {
	s := &State{
		view:       model.ViewConsole,
		follow:     true,
		filter:     "all",
		reportForm: "markdown",
		width:      width,
		height:     height,
	}
	s.adopt(protocol.Session{
		Engagement: "acme-assessment",
		Tester:     "operator",
		Mode:       "balanced",
		DataDir:    "/tmp/penai/acme-assessment",
		Provider: protocol.Provider{
			Kind:     "openai",
			BaseURL:  "https://api.openai.com/v1",
			Model:    "gpt-5-codex",
			KeyReady: true,
		},
		Scope: []protocol.Target{
			{ID: "tgt_1", Value: "10.16.0.0/28", Kind: "cidr", Note: "lab range"},
			{ID: "tgt_2", Value: "https://staging.example.test", Kind: "url"},
		},
		Findings: []protocol.Finding{
			{ID: "fnd_1", Title: "Missing Content-Security-Policy", Severity: "low", Status: "open", Asset: "staging"},
			{ID: "fnd_2", Title: "Verbose error page", Severity: "medium", Status: "confirmed", Asset: "staging", Description: "Stack traces are returned on 500 responses."},
		},
		Audit: []protocol.AuditEntry{
			{ID: "aud_1", Actor: "model", Tool: "tcp_scan", Decision: "denied", Reason: "target is outside the authorised scope", Command: "tcp_scan 10.99.0.0/24"},
			{ID: "aud_2", Actor: "user", Tool: "http_probe", Decision: "allowed", Reason: "risk low is within the balanced ceiling"},
		},
		Tools: []protocol.ToolStatus{
			{Name: "nmap", Available: true},
			{Name: "nikto", Available: false},
		},
		Diagnoses: []string{"provider : openai @ https://api.openai.com/v1", "api key  : set", "shell    : disabled"},
	})
	// The tool catalogue is loaded separately from the session, exactly as the
	// client loads it.
	s.tools = []protocol.Tool{
		{Name: "tcp_scan", Title: "TCP port scan", Kind: "builtin", Risk: "low", Description: "Connect to a range of ports and report what answered.", Available: true,
			Args: []protocol.ArgSpec{{Name: "targets", Type: "string", Description: "hosts or ranges", Required: true}}},
		{Name: "http_probe", Title: "HTTP probe", Kind: "builtin", Risk: "safe", Description: "Fetch a URL and report the status, headers and timing.", Available: true},
	}
	for i := 0; i < 60; i++ {
		s.note(model.KindResult, "run %d finished: %d open port(s) on the authorised range", i, 1000+i)
	}
	return s
}

// TestFrameFitsTheTerminal is the invariant that matters most in a full-screen
// client: a frame one row too tall scrolls the header away, and a row one column
// too wide wraps and drags the rest of the screen with it.
//
// It runs the whole matrix twice, once per ambiguous-width convention, because
// the box-drawing glyphs the design is built from are one column in a normal
// terminal and two in a CJK one. The measurement follows whichever is in force,
// so the frame has to fit in both.
func TestFrameFitsTheTerminal(t *testing.T) {
	sizes := [][2]int{
		{200, 60}, {132, 43}, {130, 40}, {120, 30}, {100, 30}, {100, 24}, {80, 24}, {80, 20},
		{78, 16}, {70, 14}, {60, 12}, {40, 12},
	}
	views := []model.View{
		model.ViewConsole, model.ViewScout, model.ViewFindings,
		model.ViewScope, model.ViewReport, model.ViewAudit,
	}

	for _, wide := range []bool{false, true} {
		runewidth.DefaultCondition.EastAsianWidth = wide
		name := "single column glyphs"
		if wide {
			name = "double column glyphs"
		}
		t.Run(name, func(t *testing.T) {
			for _, size := range sizes {
				for _, view := range views {
					s := populated(size[0], size[1])
					s.view = view
					s.streaming.WriteString("a reply that is still arriving and will wrap across lines")
					frame := s.View()
					rows := strings.Split(frame, "\n")
					if len(rows) != size[1] {
						t.Errorf("%dx%d view %s: frame is %d rows, want %d", size[0], size[1], view.Label(), len(rows), size[1])
					}
					for i, row := range rows {
						if w := visibleWidth(row); w > size[0] {
							t.Errorf("%dx%d view %s row %d: %d columns, want %d\n%q", size[0], size[1], view.Label(), i, w, size[0], stripANSI(row))
						}
					}
				}
			}
		})
	}
	runewidth.DefaultCondition.EastAsianWidth = false
}

// TestTooSmallTerminalExplainsItself checks the floor message, which is the one
// screen that must not be blank.
func TestTooSmallTerminalExplainsItself(t *testing.T) {
	s := populated(20, 6)
	frame := s.View()
	if !strings.Contains(stripANSI(frame), "too small") {
		t.Fatalf("a 20x6 terminal should say so, got:\n%s", frame)
	}
}

// TestDialogsFit checks that a dialog centred on a small screen still fits.
func TestDialogsFit(t *testing.T) {
	s := populated(80, 20)
	s.modal = model.ModalHelp
	if rows := len(strings.Split(s.View(), "\n")); rows != 20 {
		t.Errorf("help dialog frame is %d rows, want 20", rows)
	}
}

// TestWrapKeepsWordsWhole checks the wrapper, which every view depends on.
func TestWrapKeepsWordsWhole(t *testing.T) {
	rows := wrap("the quick brown fox jumps over the lazy dog", 12)
	want := []string{"the quick", "brown fox", "jumps over", "the lazy dog"}
	if strings.Join(rows, "|") != strings.Join(want, "|") {
		t.Errorf("got %q, want %q", rows, want)
	}
}

// TestWrapBreaksLongTokens makes sure a single unbreakable token does not
// overflow the column and wreck the layout beside it.
func TestWrapBreaksLongTokens(t *testing.T) {
	for _, row := range wrap(strings.Repeat("a", 50), 10) {
		if len([]rune(row)) > 10 {
			t.Fatalf("row %q is %d runes, want at most 10", row, len([]rune(row)))
		}
	}
}

// TestParseArgsTypes checks that typed arguments arrive as the types the core
// expects, because a port list sent as one string silently does nothing.
func TestParseArgsTypes(t *testing.T) {
	args, err := parseArgs(`targets=10.0.0.1 ports=80,443,8000-8010 timeoutMs=1500 verbose`)
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if args["targets"] != "10.0.0.1" {
		t.Errorf("targets = %#v, want the string", args["targets"])
	}
	if args["timeoutMs"] != 1500 {
		t.Errorf("timeoutMs = %#v, want the number 1500", args["timeoutMs"])
	}
	if args["verbose"] != true {
		t.Errorf("verbose = %#v, want true for a bare word", args["verbose"])
	}
	ports, ok := args["ports"].([]interface{})
	if !ok || len(ports) != 3 {
		t.Fatalf("ports = %#v, want a list of three", args["ports"])
	}
	if ports[0] != 80 || ports[2] != "8000-8010" {
		t.Errorf("ports = %#v", args["ports"])
	}
}

// TestParseArgsQuoting keeps a note with spaces in one piece.
func TestParseArgsQuoting(t *testing.T) {
	args, err := parseArgs(`note="internal lab range" domain=example.test`)
	if err != nil {
		t.Fatalf("parseArgs: %v", err)
	}
	if args["note"] != "internal lab range" {
		t.Errorf("note = %#v, want the quoted phrase", args["note"])
	}
}

// TestVisibleRowsCountsFromTheBottom matches how a log scrolls: offset 0 is the
// newest row, and the offset is how many rows above the bottom to show.
func TestVisibleRowsCountsFromTheBottom(t *testing.T) {
	rows := []string{"1", "2", "3", "4", "5"}
	if got := strings.Join(visibleRows(rows, 2, 0), ","); got != "4,5" {
		t.Errorf("no offset: got %q, want 4,5", got)
	}
	if got := strings.Join(visibleRows(rows, 2, 2), ","); got != "2,3" {
		t.Errorf("offset 2: got %q, want 2,3", got)
	}
	if got := strings.Join(visibleRows(rows, 9, 0), ","); got != "1,2,3,4,5" {
		t.Errorf("short content: got %q, want all rows", got)
	}
}

// TestScopeEmptyBlocksWork is the safety property the whole product rests on.
func TestScopeEmptyBlocksWork(t *testing.T) {
	s := populated(100, 24)
	s.scope = nil
	s.input.setValue("map the surface of the app")
	next, _ := s.submit()
	state, ok := next.(*State)
	if !ok {
		t.Fatalf("submit returned %T", next)
	}
	if state.view != model.ViewScope {
		t.Errorf("an empty scope should send the operator to the scope view, got %v", state.view)
	}
	if state.busy {
		t.Error("nothing should have been sent to the agent")
	}
}

// TestSlashCommandsAreNotGuessed makes sure a typo is reported.
func TestSlashCommandsAreNotGuessed(t *testing.T) {
	s := populated(100, 24)
	s.input.setValue("/scpoe add 10.0.0.1")
	next, _ := s.submit()
	state := next.(*State)
	last := state.lines[len(state.lines)-1]
	if last.Kind != model.KindError || !strings.Contains(last.Text, "unknown command") {
		t.Errorf("a misspelled command should be refused, got %+v", last)
	}
}

// TestNormalizeSeverityKeepsTheVocabulary stops a typo becoming a bad risk
// rating.
func TestNormalizeSeverityKeepsTheVocabulary(t *testing.T) {
	for input, want := range map[string]string{
		"CRITICAL": "critical", "High": "high", "medium": "medium",
		"low": "low", "info": "info", "urgent": "medium", "": "medium",
	} {
		if got := normalizeSeverity(input); got != want {
			t.Errorf("normalizeSeverity(%q) = %q, want %q", input, got, want)
		}
	}
}

// TestNextStatusCycles guards the triage loop.
func TestNextStatusCycles(t *testing.T) {
	seen := []string{"open", "confirmed", "false_positive", "fixed"}
	for i, from := range seen {
		if got := nextStatus(from); got != seen[(i+1)%len(seen)] {
			t.Errorf("nextStatus(%q) = %q", from, got)
		}
	}
}
