// Package app assembles the Bubble Tea program: the model that owns state, the
// commands that talk to the core, the key handling and the rendering.
package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/client"
	"penai/internal/protocol"
	"penai/internal/ui/model"
)

// coreCommand resolves how to launch the core for this build.
//
// The client is a separate program from the core, so it has to find the core
// on a machine where neither shares a working directory. Everything it knows
// comes from PENAI_CORE, from its own location, and from the working directory,
// and the first candidate that exists wins.
func coreCommand() (string, []string, error) {
	// PENAI_CORE overrides everything, for development and for packaging.
	if override := os.Getenv("PENAI_CORE"); override != "" {
		parts := strings.Fields(override)
		if len(parts) == 0 {
			return "", nil, fmt.Errorf("PENAI_CORE is empty")
		}
		return parts[0], parts[1:], nil
	}

	node, err := exec.LookPath("node")
	if err != nil {
		return "", nil, fmt.Errorf("node is not on PATH, and the client needs it to run the core: %w", err)
	}

	for _, candidate := range coreCandidates() {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return node, []string{candidate, "serve"}, nil
		}
	}

	// Finally, an installed penai on PATH, which is how a published package
	// finds its own core.
	if penai, lookErr := exec.LookPath("penai"); lookErr == nil {
		return node, []string{penai, "serve"}, nil
	}
	return "", nil, fmt.Errorf(
		"cannot find the penai core.\n"+
			"  looked in:\n%s\n"+
			"  build it with `npm run build`, or point PENAI_CORE at the entry point",
		bullet(coreCandidates()))
}

// coreCandidates is where the core may live, nearest first.
func coreCandidates() []string {
	var out []string

	// Next to the binary. In a published install the core is bundled as
	// core/penai.js; in this repository the binary lives in bin/ and the core is
	// built into dist/, one directory up.
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		out = append(out,
			filepath.Join(dir, "core", "penai.js"),
			filepath.Join(dir, "..", "dist", "cmd", "penai", "main.js"),
			filepath.Join(dir, "..", "share", "penai", "core", "penai.js"),
			filepath.Join(dir, "..", "..", "dist", "cmd", "penai", "main.js"),
		)
	}

	// The working directory and its parents, so `go run ./cmd/penai-tui` from
	// anywhere inside the checkout finds the built core.
	if cwd, err := os.Getwd(); err == nil {
		dir := cwd
		for i := 0; i < 4; i++ {
			out = append(out, filepath.Join(dir, "dist", "cmd", "penai", "main.js"))
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return out
}

// bullet lists the candidates for an error message.
func bullet(paths []string) string {
	seen := map[string]bool{}
	var lines []string
	for _, path := range paths {
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		lines = append(lines, "    "+path)
	}
	return strings.Join(lines, "\n")
}

// State is the whole client: the core connection plus everything on screen.
type State struct {
	core *client.Client

	// Session state, mirrored from the core.
	session   protocol.Session
	tools     []protocol.Tool
	findings  []protocol.Finding
	scope     []protocol.Target
	audit     []protocol.AuditEntry
	runs      []protocol.Run
	tooling   []protocol.ToolStatus
	diagnoses []string

	// Console.
	lines     []model.Line
	streaming strings.Builder
	busy      bool
	status    string
	flash     string
	// flashArmed records that a flash timer is already running, so a burst of
	// warnings does not keep pushing the deadline out.
	flashArmed bool
	input      textInput
	history    []string
	historyAt  int
	follow     bool
	scroll     int

	// Viewport.
	width  int
	height int

	// Scout view: run one tool by hand.
	scoutIndex  int
	scoutTool   string
	scoutArgs   textInput
	scoutFocus  bool
	scoutOutput []string

	// Findings view.
	findIndex int
	filter    string

	// Scope view.
	scopeFocus bool
	scopeDraft textInput

	// Report view.
	reportBody string
	reportForm string

	// Dialogs.
	modal        model.ModalKind
	modalIndex   int
	modalSources []protocol.ModelSource
	modalBusy    bool
	confirm      *protocol.ConfirmRequest
	confirmArmed bool
	// current is which source the model dialog is showing.
	current int
	// palette is the inline command list shown while a command is being typed,
	// and paletteIndex is the entry the operator is on.
	palette      []string
	paletteIndex int

	// lastToolName is what the current approval request is about.
	lastToolName string

	view model.View
}

// New starts the core and returns the initial state.
func New() (*State, error) {
	command, args, err := coreCommand()
	if err != nil {
		return nil, err
	}
	core, err := client.Start(command, args, nil)
	if err != nil {
		return nil, err
	}

	state := &State{
		core:       core,
		view:       model.ViewConsole,
		follow:     true,
		filter:     "all",
		reportForm: "markdown",
		historyAt:  0,
	}
	state.lines = append(state.lines,
		model.Line{Kind: model.KindHelp, Text: "PENAI - AI penetration testing terminal. Authorised engagements only."},
		model.Line{Kind: model.KindHelp, Text: "Nothing can be tested until the scope has a target: /scope add 10.16.0.0/28"},
		model.Line{Kind: model.KindHelp, Text: "Then type what you want done. Type / to list the commands, ? for help."},
	)
	return state, nil
}

// Close tears the core process down.
func (s *State) Close() { s.core.Close() }

// Init starts the first load and the event reader.
func (s *State) Init() tea.Cmd {
	return tea.Batch(s.refresh(), s.listen())
}

// listen forwards core events into the program until the stream closes.
func (s *State) listen() tea.Cmd {
	return func() tea.Msg {
		select {
		case event, ok := <-s.core.Events:
			if !ok {
				return nil
			}
			return coreEventMsg(event)
		case err := <-s.core.Errors:
			return coreErrorMsg{err}
		}
	}
}

// refresh reloads everything the views render from.
func (s *State) refresh() tea.Cmd {
	return func() tea.Msg {
		var session protocol.Session
		if err := s.core.Call("session.get", nil, &session); err != nil {
			return coreErrorMsg{err}
		}
		var tools []protocol.Tool
		if err := s.core.Call("tools.list", nil, &tools); err != nil {
			return coreErrorMsg{err}
		}
		return loadedMsg{session: session, tools: tools}
	}
}

// adopt copies a fresh session into the client's mirror of it.
func (s *State) adopt(session protocol.Session) {
	s.session = session
	s.scope = session.Scope
	s.findings = session.Findings
	s.audit = session.Audit
	s.runs = session.Runs
	s.tooling = session.Tools
	s.diagnoses = session.Diagnoses
	if session.Engagement != "" && s.status == "" {
		s.status = "engagement " + session.Engagement
	}
}

// note appends a line to the console log.
func (s *State) note(kind model.LineKind, format string, args ...interface{}) {
	text := fmt.Sprintf(format, args...)
	for _, part := range strings.Split(text, "\n") {
		s.lines = append(s.lines, model.Line{Kind: kind, Text: part})
	}
	s.trimLog()
	if s.follow {
		s.scroll = 0
	}
}

// trimLog keeps the log bounded; a long session must not grow without limit.
func (s *State) trimLog() {
	const limit = 4000
	if len(s.lines) > limit {
		s.lines = s.lines[len(s.lines)-limit:]
	}
}

// warn flashes a message in the status bar. It clears itself after a few
// seconds; see the flash timer in Update.
func (s *State) warn(format string, args ...interface{}) {
	s.flash = fmt.Sprintf(format, args...)
}

// noteCount is how many findings are open, used all over the chrome.
func (s *State) openFindings() int {
	count := 0
	for _, finding := range s.findings {
		if finding.Status == "open" {
			count++
		}
	}
	return count
}

// availableTools is how many external binaries were found on PATH.
func (s *State) availableTools() int {
	count := 0
	for _, tool := range s.tooling {
		if tool.Available {
			count++
		}
	}
	return count
}
