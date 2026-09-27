package app

import (
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/protocol"
	"penai/internal/ui/model"
)

// narrowColumns is the point below which the sidebar is dropped and the
// navigation collapses to a single line.
const narrowColumns = 78

// minColumns and minRows are the hard floor; under this a TUI is unusable.
const (
	minColumns = 40
	minRows    = 12
)

// flashLifetime is how long a warning stays in the status bar before the
// status text comes back.
const flashLifetime = 5 * time.Second

// Update is the single entry point for everything that happens.
//
// It wraps the real handler so a flash can be given a lifetime: without a timer
// a warning would sit on screen until the next message happened to replace it.
func (s *State) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	next, cmd := s.update(msg)
	state, ok := next.(*State)
	if !ok {
		return next, cmd
	}
	switch {
	case state.flash == "":
		state.flashArmed = false
	case !state.flashArmed:
		state.flashArmed = true
		return next, tea.Batch(cmd, state.expireFlash())
	}
	return next, cmd
}

// expireFlash clears the status bar warning once its time is up.
func (s *State) expireFlash() tea.Cmd {
	return tea.Tick(flashLifetime, func(time.Time) tea.Msg {
		return flashExpiredMsg{}
	})
}

// update is the real handler.
func (s *State) update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch typed := msg.(type) {
	case tea.WindowSizeMsg:
		s.width = typed.Width
		s.height = typed.Height
		return s, nil

	case tea.KeyMsg:
		return s.handleKey(typed)

	case loadedMsg:
		s.adopt(typed.session)
		s.tools = typed.tools
		return s, nil

	case coreErrorMsg:
		s.busy = false
		s.confirm = nil
		s.modalBusy = false
		if typed.err == nil {
			return s, nil
		}
		s.warn("%s", typed.err.Error())
		return s, nil

	case coreEventMsg:
		// The event pump has to be re-armed after every event. Forgetting this
		// looks like a working client right up until the second event: the first
		// is handled, the reader is never called again, and everything the core
		// says afterwards is silently dropped.
		next, cmd := s.handleEvent(protocol.Event(typed))
		return next, tea.Batch(cmd, s.listen())

	case toolRunMsg:
		s.showToolRun(typed)
		return s, s.reload()

	case findingsMsg:
		if typed.Findings != nil {
			s.findings = typed.Findings
		}
		return s, nil

	case scopeMsg:
		s.scope = typed.Targets
		s.note(model.KindNotice, "scope: %d target(s) authorised", len(typed.Targets))
		return s, s.reload()

	case sourcesMsg:
		s.modalSources = typed.Sources
		s.modalBusy = false
		return s, nil

	case reportMsg:
		s.reportBody = typed.Body
		return s, nil

	case exportMsg:
		s.note(model.KindResult, "wrote %s (%d bytes, %d finding(s))", typed.Path, typed.Bytes, typed.Findings)
		return s, nil

	case statusMsg:
		s.busy = false
		s.status = string(typed)
		return s, nil

	case modelChangedMsg:
		// Say what changed, then read the session back so the chrome shows the
		// model that will actually answer the next turn.
		s.note(model.KindResult, "model: %s", typed.model)
		s.status = "model: " + typed.model
		return s, s.reload()

	case flashExpiredMsg:
		s.flash = ""
		s.flashArmed = false
		// The status behind the warning is whatever it was when the warning
		// arrived, which after a refused turn is "thinking". That would be a
		// lie by the time anyone looks, so it is corrected here.
		if !s.busy {
			s.status = "ready"
		}
		return s, nil
	}
	return s, nil
}

// handleKey is the whole key map, in priority order: quit, dialog, approval,
// then the active view, then global bindings.
func (s *State) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if msg.Type == tea.KeyCtrlC {
		return s, tea.Quit
	}

	// A pending approval outranks every dialog: the core is blocked on it.
	if s.confirm != nil {
		return s.handleConfirmKey(msg)
	}

	if s.modal != model.ModalNone {
		return s.handleModalKey(msg)
	}

	switch s.view {
	case model.ViewConsole:
		return s.handleConsoleKey(msg)
	case model.ViewScout:
		return s.handleScoutKey(msg)
	case model.ViewFindings:
		return s.handleFindingsKey(msg)
	case model.ViewScope:
		return s.handleScopeKey(msg)
	case model.ViewReport:
		return s.handleReportKey(msg)
	case model.ViewAudit:
		return s.handleAuditKey(msg)
	}
	return s, nil
}

// handleConfirmKey answers an approval request.
func (s *State) handleConfirmKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "Y", "enter", "right":
		s.confirm = nil
		return s, s.answerConfirm(true)
	case "n", "N", "esc", "left", "q":
		s.confirm = nil
		s.note(model.KindNotice, "declined: %s", s.lastToolName)
		return s, s.answerConfirm(false)
	}
	return s, nil
}

// handleConsoleKey owns the prompt, the history, the palette and the
// scrollback.
func (s *State) handleConsoleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	// While a command is being typed, the arrows choose from the palette rather
	// than scrolling, and enter runs whatever is chosen.
	//
	// One press, whatever the state of the prompt. Whether the operator typed
	// the name, half typed it, or just arrowed onto it in the list, enter means
	// "this one" - so a command is never a two-key ritual. Tab is the other
	// thing they might mean: take the name and stop, so an argument can follow.
	if len(s.palette) > 0 {
		switch msg.Type {
		case tea.KeyUp:
			s.movePalette(-1)
			return s, nil
		case tea.KeyDown:
			s.movePalette(1)
			return s, nil
		case tea.KeyTab:
			s.acceptPalette()
			return s, nil
		case tea.KeyEnter:
			return s.runChosen()
		case tea.KeyEsc:
			s.palette = nil
			return s, nil
		}
	}

	switch msg.Type {
	case tea.KeyUp:
		if s.input.empty() {
			return s.recallHistory(-1)
		}
		s.scrollUp(1)
		return s, nil
	case tea.KeyDown:
		if s.input.empty() {
			return s.recallHistory(1)
		}
		s.scrollDown(1)
		return s, nil
	case tea.KeyPgUp:
		s.scrollUp(10)
		return s, nil
	case tea.KeyPgDown:
		s.scrollDown(10)
		return s, nil
	case tea.KeyEnter:
		return s.submit()
	case tea.KeyEsc:
		if !s.input.empty() {
			s.input.clear()
			s.refreshPalette()
			return s, nil
		}
		s.follow = s.scroll == 0
		return s, nil
	}

	// Enter a sub-view without losing the prompt.
	if s.input.empty() {
		if cmd, handled := s.globalKey(msg); handled {
			return s, cmd
		}
	}

	s.input.update(msg)
	s.refreshPalette()
	return s, nil
}

// submit acts on whatever is in the prompt.
func (s *State) submit() (tea.Model, tea.Cmd) {
	text := strings.TrimSpace(s.input.value())
	if text == "" {
		return s, nil
	}
	s.input.clear()
	s.refreshPalette()
	s.remember(text)
	s.note(model.KindUser, "%s", text)

	// A second turn while one is running means "stop".
	if s.busy {
		return s, s.interrupt()
	}

	if strings.HasPrefix(text, "/") {
		return s.runSlash(text)
	}
	if len(s.scope) == 0 {
		s.note(model.KindError, "the scope is empty; nothing can be tested. Add one: /scope add 10.16.0.0/28")
		s.view = model.ViewScope
		return s, nil
	}

	s.busy = true
	s.streaming.Reset()
	s.status = "thinking"
	return s, s.send(text)
}

// recallHistory walks back and forward through what was sent before.
func (s *State) recallHistory(direction int) (tea.Model, tea.Cmd) {
	if len(s.history) == 0 {
		return s, nil
	}
	next := s.historyAt + direction
	if next < 0 {
		next = 0
	}
	if next > len(s.history) {
		next = len(s.history)
	}
	s.historyAt = next
	if next == len(s.history) {
		s.input.clear()
		return s, nil
	}
	s.input.setValue(s.history[next])
	return s, nil
}

func (s *State) remember(text string) {
	if len(s.history) == 0 || s.history[len(s.history)-1] != text {
		s.history = append(s.history, text)
	}
	s.historyAt = len(s.history)
}

// scrollUp moves back through the scrollback and turns follow off.
func (s *State) scrollUp(by int) {
	s.scroll += by
	s.follow = false
}

func (s *State) scrollDown(by int) {
	s.scroll -= by
	if s.scroll <= 0 {
		s.scroll = 0
		s.follow = true
	}
}

// handleScoutKey drives the tool catalogue.
func (s *State) handleScoutKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if s.scoutFocus {
		switch msg.Type {
		case tea.KeyEnter:
			s.scoutFocus = false
			return s, s.runSelected()
		case tea.KeyEsc:
			s.scoutFocus = false
			return s, nil
		case tea.KeyTab:
			s.scoutFocus = false
			return s, nil
		}
		s.scoutArgs.update(msg)
		return s, nil
	}

	switch msg.Type {
	case tea.KeyUp, tea.KeyCtrlN:
		s.moveScout(-1)
		return s, nil
	case tea.KeyDown, tea.KeyCtrlJ:
		s.moveScout(1)
		return s, nil
	case tea.KeyHome:
		s.scoutIndex = 0
		return s, nil
	case tea.KeyEnd:
		s.scoutIndex = len(s.tools) - 1
		return s, nil
	case tea.KeyEnter, tea.KeyRight:
		if s.currentTool() == "" {
			return s, nil
		}
		s.scoutFocus = true
		s.scoutArgs.clear()
		return s, nil
	case tea.KeyCtrlR:
		return s, s.runSelected()
	case tea.KeyEsc:
		cmd, _ := s.globalKey(msg)
		return s, cmd
	}
	cmd, _ := s.globalKey(msg)
	return s, cmd
}

func (s *State) moveScout(by int) {
	if len(s.tools) == 0 {
		return
	}
	s.scoutIndex += by
	if s.scoutIndex < 0 {
		s.scoutIndex = len(s.tools) - 1
	}
	if s.scoutIndex >= len(s.tools) {
		s.scoutIndex = 0
	}
	s.scoutArgs.clear()
	s.scoutFocus = false
}

func (s *State) currentTool() string {
	if len(s.tools) == 0 || s.scoutIndex < 0 || s.scoutIndex >= len(s.tools) {
		return ""
	}
	return s.tools[s.scoutIndex].Name
}

// runSelected executes the highlighted tool with the typed arguments.
func (s *State) runSelected() tea.Cmd {
	name := s.currentTool()
	if name == "" {
		return nil
	}
	args, err := parseArgs(s.scoutArgs.value())
	if err != nil {
		s.warn("%s", err.Error())
		return nil
	}
	s.lastToolName = name
	s.scoutOutput = nil
	s.note(model.KindCommand, "%s %s", name, s.scoutArgs.value())
	return s.runTool(name, args)
}

// handleFindingsKey drives triage.
func (s *State) handleFindingsKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	visible := s.visibleFindings()
	switch msg.Type {
	case tea.KeyUp:
		if len(visible) > 0 {
			s.findIndex = wrapIndex(s.findIndex-1, len(visible))
		}
		return s, nil
	case tea.KeyDown:
		if len(visible) > 0 {
			s.findIndex = wrapIndex(s.findIndex+1, len(visible))
		}
		return s, nil
	case tea.KeyEnter:
		if s.findIndex < len(visible) {
			current := visible[s.findIndex]
			return s, s.setFindingStatus(current.ID, nextStatus(current.Status))
		}
		return s, nil
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "s":
			return s.cycleFilter()
		case "d":
			if s.findIndex < len(visible) {
				return s, s.setFindingStatus(visible[s.findIndex].ID, "false_positive")
			}
			return s, nil
		case "f":
			if s.findIndex < len(visible) {
				return s, s.setFindingStatus(visible[s.findIndex].ID, "fixed")
			}
			return s, nil
		case "o":
			if s.findIndex < len(visible) {
				return s, s.setFindingStatus(visible[s.findIndex].ID, "open")
			}
			return s, nil
		}
	}
	cmd, _ := s.globalKey(msg)
	return s, cmd
}

func (s *State) cycleFilter() (tea.Model, tea.Cmd) {
	filters := []string{"all", "critical", "high", "medium", "low", "info", "open", "confirmed", "false_positive", "fixed"}
	for i, name := range filters {
		if name == s.filter {
			s.filter = filters[(i+1)%len(filters)]
			break
		}
	}
	s.findIndex = 0
	return s, nil
}

// handleScopeKey drives authorisation.
func (s *State) handleScopeKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if s.scopeFocus {
		switch msg.Type {
		case tea.KeyEnter:
			typed := strings.TrimSpace(s.scopeDraft.value())
			s.scopeDraft.clear()
			s.scopeFocus = false
			if typed == "" {
				return s, nil
			}
			// The first word is the target and the rest is the note, which is
			// the same shorthand /scope add takes.
			value, note := typed, ""
			if cut := strings.IndexAny(typed, " \t"); cut > 0 {
				value, note = typed[:cut], strings.TrimSpace(typed[cut+1:])
			}
			return s, s.addTarget(value, note)
		case tea.KeyEsc:
			s.scopeDraft.clear()
			s.scopeFocus = false
			return s, nil
		}
		s.scopeDraft.update(msg)
		return s, nil
	}

	switch msg.Type {
	case tea.KeyUp:
		if len(s.scope) > 0 {
			s.findIndex = wrapIndex(s.findIndex-1, len(s.scope))
		}
		return s, nil
	case tea.KeyDown:
		if len(s.scope) > 0 {
			s.findIndex = wrapIndex(s.findIndex+1, len(s.scope))
		}
		return s, nil
	case tea.KeyEnter:
		s.scopeFocus = true
		s.scopeDraft.clear()
		return s, nil
	case tea.KeyBackspace, tea.KeyDelete:
		if len(s.scope) > 0 && s.findIndex < len(s.scope) {
			id := s.scope[s.findIndex].ID
			s.scope = append(s.scope[:s.findIndex], s.scope[s.findIndex+1:]...)
			if s.findIndex >= len(s.scope) {
				s.findIndex = len(s.scope) - 1
			}
			if s.findIndex < 0 {
				s.findIndex = 0
			}
			return s, s.removeTarget(id)
		}
		return s, nil
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "m":
			next, cmd := s.cycleMode()
			return next, cmd
		}
	}
	cmd, _ := s.globalKey(msg)
	return s, cmd
}

// cycleMode walks the execution ceiling.
func (s *State) cycleMode() (tea.Model, tea.Cmd) {
	switch s.session.Mode {
	case "safe":
		return s, s.setMode("balanced")
	case "balanced":
		return s, s.setMode("full")
	default:
		return s, s.setMode("safe")
	}
}

// handleReportKey scrolls and exports.
func (s *State) handleReportKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyUp:
		s.scrollUp(1)
		return s, nil
	case tea.KeyDown:
		s.scrollDown(1)
		return s, nil
	case tea.KeyPgUp:
		s.scrollUp(15)
		return s, nil
	case tea.KeyPgDown:
		s.scrollDown(15)
		return s, nil
	case tea.KeyRunes:
		switch string(msg.Runes) {
		case "w":
			return s, s.exportReport(s.reportForm, "")
		case "m", "h", "s", "j":
			s.reportForm = nextFormat(s.reportForm, string(msg.Runes))
			return s, s.previewReport(s.reportForm)
		}
	}
	cmd, _ := s.globalKey(msg)
	return s, cmd
}

// nextFormat switches the preview format from the given key.
func nextFormat(current string, key string) string {
	order := []string{"markdown", "html", "sarif", "json"}
	keys := []string{"m", "h", "s", "j"}
	for i, name := range order {
		if name == current {
			if keys[i] == key {
				return name
			}
			return order[(i+1)%len(order)]
		}
	}
	return current
}

// handleAuditKey scrolls the decision log.
func (s *State) handleAuditKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.Type {
	case tea.KeyUp:
		s.scrollUp(1)
		return s, nil
	case tea.KeyDown:
		s.scrollDown(1)
		return s, nil
	case tea.KeyPgUp:
		s.scrollUp(15)
		return s, nil
	case tea.KeyPgDown:
		s.scrollDown(15)
		return s, nil
	}
	cmd, _ := s.globalKey(msg)
	return s, cmd
}

// globalKey is the binding set that works in every view.
func (s *State) globalKey(msg tea.KeyMsg) (tea.Cmd, bool) {
	key := msg.String()

	// Digits jump between views; ctrl+digit does not survive every terminal,
	// which is why the plain digits are the primary binding.
	if len(key) == 1 && key[0] >= '1' && key[0] <= '6' {
		index := int(key[0] - '1')
		if index < len(model.Views) {
			s.view = model.Views[index].ID
			s.scroll = 0
			s.follow = true
		}
		return nil, true
	}

	switch key {
	case "ctrl+p":
		return s.openModel(), true
	case "ctrl+g":
		// The palette is inline now: put a slash in the prompt and start there.
		s.input.setValue("/")
		s.refreshPalette()
		return nil, true
	case "ctrl+k":
		s.openHelp()
		return nil, true
	case "ctrl+l":
		s.lines = nil
		s.streaming.Reset()
		s.scroll = 0
		return nil, true
	case "?":
		s.openHelp()
		return nil, true
	case "tab":
		s.view = model.Views[(int(s.view)+1)%len(model.Views)].ID
		s.scroll = 0
		return nil, true
	case "shift+tab":
		s.view = model.Views[(int(s.view)+len(model.Views)-1)%len(model.Views)].ID
		s.scroll = 0
		return nil, true
	}
	return nil, false
}

// wrapIndex keeps a selection inside a list, wrapping at both ends.
func wrapIndex(index, length int) int {
	if length == 0 {
		return 0
	}
	if index < 0 {
		return length - 1
	}
	if index >= length {
		return 0
	}
	return index
}

// visibleFindings applies the triage filter.
func (s *State) visibleFindings() []finding {
	out := make([]finding, 0, len(s.findings))
	for _, item := range s.findings {
		if s.filter == "all" || item.Severity == s.filter || item.Status == s.filter {
			out = append(out, item)
		}
	}
	return out
}

// parseArgs reads "key=value key2=value2" with quoting for spaces and lists.
func parseArgs(text string) (map[string]interface{}, error) {
	args := map[string]interface{}{}
	text = strings.TrimSpace(text)
	if text == "" {
		return args, nil
	}
	for _, pair := range splitArgs(text) {
		key, value, found := strings.Cut(pair, "=")
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if !found {
			// A bare word is a flag.
			args[key] = true
			continue
		}
		args[key] = coerce(value)
	}
	return args, nil
}

// splitArgs splits on whitespace while honouring quotes.
func splitArgs(text string) []string {
	var (
		parts   []string
		current strings.Builder
		quote   rune
	)
	for _, r := range text {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote = r
		case r == ' ' || r == '\t':
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// coerce turns a typed string into the type the tool expects, guessing from
// the shape of the value.
func coerce(value string) interface{} {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if number, err := strconv.ParseFloat(trimmed, 64); err == nil {
		if number == float64(int64(number)) {
			return int(number)
		}
		return number
	}
	switch strings.ToLower(trimmed) {
	case "true", "yes":
		return true
	case "false", "no":
		return false
	}
	if strings.Contains(trimmed, ",") {
		parts := strings.Split(trimmed, ",")
		out := make([]interface{}, 0, len(parts))
		for _, part := range parts {
			out = append(out, coerce(part))
		}
		return out
	}
	return value
}
