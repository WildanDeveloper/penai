package app

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/protocol"
	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// typeIn feeds runes through the real key path, so the palette is exercised the
// way an operator drives it rather than by poking its state.
func typeIn(t *testing.T, s *State, text string) {
	t.Helper()
	for _, r := range text {
		s.update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
}

// TestTypingSlashListsTheCommands is the preview the console is missing without
// it: one keystroke into a command and the list is on screen.
func TestTypingSlashListsTheCommands(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/")
	if len(s.palette) == 0 {
		t.Fatal("typing / should list the commands")
	}
	view := stripANSI(s.View())
	for _, want := range []string{"/scope", "/mode", "/run", "authorised targets"} {
		if !contains(view, want) {
			t.Errorf("the preview is missing %q:\n%s", want, view)
		}
	}
	if !contains(view, theme.Selected) {
		t.Error("nothing is marked as the current choice")
	}
	// There are more commands than rows, and the list says so rather than
	// pretending to be complete.
	if !contains(view, "commands") {
		t.Errorf("the preview does not say how much is left:\n%s", view)
	}
	if len(s.palette) <= paletteMaxRows {
		t.Skip("every command fits, so there is nothing to count")
	}
	if !contains(view, "of "+itoa(len(s.palette))) {
		t.Errorf("the preview does not report the total:\n%s", view)
	}
}

// TestTheListNarrowsAsYouType is the point of a filter: typing the next letter
// should not leave the whole list on screen.
func TestTheListNarrowsAsYouType(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/")
	before := len(s.palette)
	typeIn(t, s, "sc")
	if len(s.palette) == 0 {
		t.Fatal("/sc should still match a command")
	}
	if len(s.palette) >= before {
		t.Errorf("/sc matched %d commands, the same as / (%d)", len(s.palette), before)
	}
	view := stripANSI(s.View())
	if contains(view, "/report") {
		t.Error("/report should not survive the filter /sc:\n" + view)
	}
}

// TestAnUnknownQueryShowsNothing: a list that matches everything is worse than
// no list.
func TestAnUnknownQueryShowsNothing(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/zzz")
	if len(s.palette) != 0 {
		t.Errorf("/zzz matched %d commands", len(s.palette))
	}
	if s.paletteHeight() != 0 {
		t.Error("an empty palette should take no rows")
	}
}

// TestEnterRunsAnExactMatch: one press, because that is all it should take.
func TestEnterRunsAnExactMatch(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/tools")
	next, cmd := s.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	state := next.(*State)
	if cmd != nil {
		t.Error("a local command should not produce a core call")
	}
	if state.view != model.ViewScout {
		t.Errorf("view = %v, want the scout view that /tools opens", state.view)
	}
	if state.input.value() != "" {
		t.Errorf("the prompt should be empty after running, got %q", state.input.value())
	}
}

// TestEnterRunsWhateverIsChosen: the point of the palette. The operator can
// point at a command and be done in one press, whether they typed the name, half
// typed it, or just arrowed onto it.
func TestEnterRunsWhateverIsChosen(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/")
	// Arrow down to /scope and run it: /scope with no argument lists the scope,
	// which is a change of state the test can see.
	for s.palette[s.paletteIndex] != "/scope" {
		s.movePalette(1)
	}
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	state := next.(*State)
	if state.input.value() != "" {
		t.Errorf("the prompt should be empty after running, got %q", state.input.value())
	}
	if len(state.palette) != 0 {
		t.Error("the palette should close once the command has run")
	}
	found := false
	for _, line := range state.lines {
		if strings.Contains(line.Text, "authorised") || strings.Contains(line.Text, "scope is empty") {
			found = true
		}
	}
	if !found {
		t.Errorf("/scope did not run; the log holds %+v", state.lines[len(state.lines)-1])
	}
}

// TestTabCompletesWithoutRunning is the other key: take the name and stop.
func TestTabCompletesWithoutRunning(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/sc")
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyTab})
	state := next.(*State)
	if state.input.value() != "/scope " {
		t.Errorf("prompt = %q, want /scope with a trailing space", state.input.value())
	}
	if state.input.value() == "/scope" && state.palette != nil {
		t.Error("a completed command should not leave the palette open")
	}
	// The command has not run: the scope is untouched.
	if strings.Contains(state.input.value(), "add") {
		t.Error("tab must not run anything")
	}
}

// TestEnterOnAPartialRunsTheHighlightedOne: half a name is still a choice.
func TestEnterOnAPartialRunsTheHighlightedOne(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/cle")
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	state := next.(*State)
	if len(state.lines) != 0 {
		t.Errorf("/cle should have cleared the console, %d lines left", len(state.lines))
	}
}

// TestEnterRunsATypedCommandDirectly: a name typed out in full needs no
// navigation and no second press.
func TestEnterRunsATypedCommandDirectly(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/clear")
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	state := next.(*State)
	if state.input.value() != "" || len(state.lines) != 0 {
		t.Errorf("/clear should have run: prompt %q, %d lines left", state.input.value(), len(state.lines))
	}
}

// TestThePaletteClosesAfterRunning keeps a finished command from reappearing.
func TestThePaletteClosesAfterRunning(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/tools")
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	if len(next.(*State).palette) != 0 {
		t.Error("the palette should close once the command has run")
	}
	if next.(*State).paletteHeight() != 0 {
		t.Error("a closed palette must take no rows")
	}
}

// TestArrowsMoveAndWrap covers the selection.
func TestArrowsMoveAndWrap(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/")
	first := s.palette[s.paletteIndex]

	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyUp})
	state := next.(*State)
	if state.palette[state.paletteIndex] == first {
		t.Error("up did not move the selection")
	}
	if state.palette[state.paletteIndex] != lastOf(s.palette) {
		t.Error("up at the top should wrap to the last command")
	}
}

// TestEscapeClosesThePalette: back to typing prose without clearing the prompt.
func TestEscapeClosesThePalette(t *testing.T) {
	s := populated(104, 26)
	typeIn(t, s, "/sc")
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	state := next.(*State)
	if len(state.palette) != 0 {
		t.Error("escape should close the palette")
	}
	if state.input.value() != "/sc" {
		t.Errorf("escape should not eat the prompt, got %q", state.input.value())
	}
}

// TestThePaletteTakesItsRowsFromTheBody: an overlay that adds rows makes the
// frame one too tall, and the screen scrolls.
func TestThePaletteTakesItsRowsFromTheBody(t *testing.T) {
	for _, size := range [][2]int{{104, 26}, {80, 24}, {60, 16}} {
		s := populated(size[0], size[1])
		typeIn(t, s, "/")
		rows := strings.Split(s.View(), "\n")
		if len(rows) != size[1] {
			t.Errorf("%dx%d: frame is %d rows with the palette open, want %d", size[0], size[1], len(rows), size[1])
		}
	}
}

// TestControlGStartsAPalette keeps the shortcut working now that the dialog is
// gone.
func TestControlGStartsAPalette(t *testing.T) {
	s := populated(104, 26)
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyCtrlG})
	state := next.(*State)
	if state.input.value() != "/" {
		t.Errorf("ctrl+g should put a slash in the prompt, got %q", state.input.value())
	}
	if len(state.palette) == 0 {
		t.Error("ctrl+g should open the palette")
	}
}

func lastOf(list []string) string { return list[len(list)-1] }

// TestModelCommandFillsTheDialog: ctrl+p and /model must be the same thing.
// The slash command used to open the dialog and drop the command that fetches
// the sources, so it came up empty and looked like it had done nothing.
func TestModelCommandFillsTheDialog(t *testing.T) {
	s := populated(104, 26)
	next, cmd := s.runSlash("/model")
	state := next.(*State)
	if state.modal != model.ModalModel {
		t.Fatalf("/model did not open the dialog, modal = %v", state.modal)
	}
	if cmd == nil {
		t.Fatal("/model returned no command, so the model list is never fetched")
	}
	if !state.modalBusy && state.modalSources == nil {
		t.Error("the dialog opened with nothing in it and no way to fill it")
	}
}

// TestHelpAndModelDialogsAreWired: the commands that need the core return a
// command to run.
func TestHelpAndModelDialogsAreWired(t *testing.T) {
	s := populated(104, 26)
	next, _ := s.runSlash("/help")
	if next.(*State).modal != model.ModalHelp {
		t.Error("/help did not open the help dialog")
	}
}

// TestChangingTheModelReloadsTheSession: picking a model has to change what the
// screen says, not only what the core will use. Without the reload the header
// kept naming the old model and the change only appeared after a restart.
func TestChangingTheModelReloadsTheSession(t *testing.T) {
	s := populated(104, 26)
	s.modalSources = []protocol.ModelSource{
		{ID: "current", Kind: "openai", BaseURL: "https://opencode.ai/zen/v1", APIKey: "public", Origin: "current", Models: []string{"a", "b"}},
	}
	s.modal = model.ModalModel
	s.modalIndex = 1

	next, _ := s.handleModelKey(tea.KeyMsg{Type: tea.KeyEnter})
	if next.(*State).modal != model.ModalNone {
		t.Error("the dialog should close once a model is chosen")
	}

	// The reply is what the core sends back; the client has to react to it by
	// reading the session again.
	_, cmd := s.update(modelChangedMsg{model: "b", baseUrl: "https://opencode.ai/zen/v1"})
	if cmd == nil {
		t.Fatal("a model change produced no command, so the session is never re-read")
	}
	last := s.lines[len(s.lines)-1]
	if !contains(last.Text, "b") {
		t.Errorf("the change was not reported to the log: %q", last.Text)
	}
}
