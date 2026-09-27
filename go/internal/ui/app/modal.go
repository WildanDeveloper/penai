package app

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// modelRows is how many models the dialog shows at once, matching the terminal
// client this mirrors.
const modelRows = 10

// openHelp shows every binding and command.
func (s *State) openHelp() {
	s.modal = model.ModalHelp
	s.modalIndex = 0
}

// openModel shows the model dialog, fetching the source list if it is not
// already in hand.
//
// The dialog opens immediately and fills in when the core answers, so a slow
// endpoint cannot leave the keypress looking like it did nothing.
func (s *State) openModel() tea.Cmd {
	s.modal = model.ModalModel
	s.modalIndex = 0
	if s.modalSources == nil {
		s.modalBusy = true
		return s.loadSources(false, 0)
	}
	return nil
}

// closeModal dismisses whatever is on top.
func (s *State) closeModal() {
	s.modal = model.ModalNone
	s.modalBusy = false
}

// handleModalKey routes keys to the dialog that is open.
func (s *State) handleModalKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch s.modal {
	case model.ModalHelp:
		return s.handleHelpKey(msg)
	case model.ModalModel:
		return s.handleModelKey(msg)
	}
	return s, nil
}

// handleHelpKey: any key that is not a navigation key closes the help.
func (s *State) handleHelpKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc", "q", "enter", "?", "ctrl+k":
		s.closeModal()
	}
	return s, nil
}

// handleModelKey is the model dialog.
//
// Up and down move through the models and wrap, left and right switch source,
// r refetches the list from the endpoint, enter applies, escape leaves.
func (s *State) handleModelKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	source, models := s.currentSource()
	if len(s.modalSources) == 0 {
		if msg.String() == "esc" || msg.String() == "q" {
			s.closeModal()
		}
		return s, nil
	}

	switch msg.String() {
	case "esc", "q", "ctrl+p":
		s.closeModal()
		return s, nil

	case "up", "k":
		s.modalIndex = wrapIndex(s.modalIndex-1, len(models))
		return s, nil
	case "down", "j":
		s.modalIndex = wrapIndex(s.modalIndex+1, len(models))
		return s, nil

	case "left", "h":
		if len(s.modalSources) > 1 {
			s.modalIndex = 0
			s.modalBusy = true
			return s, tea.Batch(s.loadSources(false, 0), s.shiftSource(-1))
		}
		return s, nil
	case "right", "l":
		if len(s.modalSources) > 1 {
			s.modalIndex = 0
			s.modalBusy = true
			return s, tea.Batch(s.loadSources(false, 0), s.shiftSource(1))
		}
		return s, nil

	case "r":
		s.modalBusy = true
		return s, s.loadSources(true, s.currentSourceIndex())

	case "tab":
		s.modalIndex = wrapIndex(s.modalIndex+1, len(models))
		return s, nil

	case "enter":
		if len(models) == 0 {
			s.warn("this source has no models; press r to query the endpoint")
			return s, nil
		}
		if !source.HasKey() {
			s.warn("%s has no api key; export one and refresh", source.ID)
			return s, nil
		}
		s.closeModal()
		return s, s.useModel(source, models[s.modalIndex])
	}
	return s, nil
}

// shiftSource moves the selection to another source and reloads it.
func (s *State) shiftSource(by int) tea.Cmd {
	if len(s.modalSources) == 0 {
		return nil
	}
	s.current = wrapIndex(s.current+by, len(s.modalSources))
	s.modalIndex = 0
	return nil
}

// currentSourceIndex is which source the dialog is showing.
func (s *State) currentSourceIndex() int {
	if s.current < 0 || s.current >= len(s.modalSources) {
		return 0
	}
	return s.current
}

// currentSource is the selected source and its model list.
func (s *State) currentSource() (modelSource, []string) {
	if len(s.modalSources) == 0 {
		return modelSource{}, nil
	}
	index := s.currentSourceIndex()
	source := s.modalSources[index]
	models := source.Models
	if s.modalIndex >= len(models) {
		return source, models
	}
	return source, models
}

// renderHelp is the help dialog.
func (s *State) renderHelp() string {
	width := min(s.width-8, 78)
	rows := wrap(helpText(), width)
	height := len(rows) + 4
	inner := make([]string, 0, height)
	inner = append(inner, strong("KEYS AND COMMANDS"), rule(width, theme.Faint))
	inner = append(inner, rows...)
	inner = append(inner, "", muted("esc to close"))
	return frame(inner, width, "help")
}

// renderModel is the model dialog, with the source tabs across the top.
func (s *State) renderModel() string {
	width := min(s.width-8, 76)
	source, models := s.currentSource()

	tabs := make([]string, 0, len(s.modalSources))
	for i, item := range s.modalSources {
		active := i == s.currentSourceIndex()
		text := " " + item.ID + " "
		if active {
			tabs = append(tabs, lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Bold(true).Render(text))
			continue
		}
		tabs = append(tabs, muted(text))
	}

	inner := []string{
		strong("MODEL"),
		strings.Join(tabs, " "),
		label(source.Label) + muted("  ") + themed(theme.Muted, shortenURL(source.BaseURL, 30)),
		// Where this endpoint came from. A list of endpoints that cannot say so
		// is a list nobody should be expected to act on.
		muted("from " + sourceOrigin(source)),
	}
	// The anonymous tier sends the gateway's own literal token, so calling that
	// "a key is set" would credit the operator with a credential they never gave.
	switch {
	case source.AnonymousTier():
		inner = append(inner, muted("key ")+good("none needed - anonymous free tier"))
	case source.HasKey():
		inner = append(inner, muted("key ")+good("set"))
	default:
		inner = append(inner, muted("key ")+bad("missing"))
	}
	inner = append(inner, rule(width, theme.Faint))

	if s.modalBusy {
		inner = append(inner, themed(theme.Accent, "fetching"+theme.Ellipsis))
	}
	if len(models) == 0 {
		inner = append(inner, muted("no models listed; press r to query the endpoint"))
	}

	// Ten visible rows, scrolled so the selection stays in view.
	visible := min(len(models), modelRows)
	start := 0
	if s.modalIndex >= visible {
		start = s.modalIndex - visible + 1
	}
	for i := start; i < start+visible && i < len(models); i++ {
		marker := "  "
		name := truncateStyled(models[i], width-20)
		if i == s.modalIndex {
			marker = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Render(" " + theme.Selected + " ")
			name = padStyled(lipgloss.NewStyle().Foreground(theme.Strong).Render(name), width-20)
		}
		note := ""
		if models[i] == s.session.Provider.Model {
			note = good("active")
		}
		inner = append(inner, marker+name+"  "+padStyled(note, 8))
	}
	if len(models) > visible {
		inner = append(inner, muted(fmt.Sprintf("  %d of %d models", len(models), len(models))))
	}

	inner = append(inner, rule(width, theme.Faint))
	inner = append(inner, muted("up/down move  left/right source  r refresh  enter use  esc cancel"))
	return frame(inner, width, "model")
}

// sourceOrigin explains where a model source came from, in words an operator can
// check against their own machine.
func sourceOrigin(source modelSource) string {
	switch source.Origin {
	case "catalog":
		return "the bundled catalog, key from the environment"
	default:
		return "this machine's configuration"
	}
}

// describeSuggestion pairs a command with its one-line description.
func describeSuggestion(command string) (string, string) {
	for _, item := range suggestions {
		if item.Command == command {
			return item.Command, item.Detail
		}
	}
	return command, ""
}

// frame draws a titled box around rows.
//
// The box is drawn by hand so the content is padded with the same width function
// the rest of the client measures with. lipgloss would pad with its own, and
// where the two disagree the dialog is a column wider than its border.
func frame(rows []string, width int, title string) string {
	inner := width
	if inner < 8 {
		inner = 8
	}

	// The title lives in the top border, so it is not repeated as a row inside
	// the box: one heading, not two.
	body := make([]string, 0, len(rows)+1)
	body = append(body, rule(inner, theme.Faint))
	body = append(body, rows...)

	out := make([]string, 0, len(body)+2)
	top := fill(theme.BoxHorizontal, inner)
	if gap := inner - runeLen(title) - 2; gap > 0 {
		top = " " + title + " " + fill(theme.BoxHorizontal, gap)
	}
	out = append(out,
		themed(theme.Border, theme.BoxTopLeft)+themed(theme.Accent, top)+themed(theme.Border, theme.BoxTopRight))
	for _, row := range body {
		out = append(out,
			themed(theme.Border, theme.BoxVertical)+" "+padStyled(row, inner)+themed(theme.Border, theme.BoxVertical))
	}
	out = append(out,
		themed(theme.Border, theme.BoxBottomLeft)+fill(theme.BoxHorizontal, inner)+themed(theme.Border, theme.BoxBottomRight))
	return joinLines(out)
}

// overlay centres a dialog on the screen behind it.
func (s *State) overlay(screen string) string {
	var dialog string
	switch s.modal {
	case model.ModalHelp:
		dialog = s.renderHelp()
	case model.ModalModel:
		dialog = s.renderModel()
	}
	return placeCentre(screen, dialog, s.width, s.height)
}

// placeCentre puts a block in the middle of a screen without leaving the
// screen's own text visible around it, which is what a dialog has to do.
func placeCentre(screen, block string, width, height int) string {
	backdrop := lipgloss.NewStyle().Foreground(theme.Faint).Render(screen)
	rows := strings.Split(backdrop, "\n")
	blockRows := strings.Split(block, "\n")

	blockWidth := 0
	for _, row := range blockRows {
		if l := lipgloss.Width(row); l > blockWidth {
			blockWidth = l
		}
	}
	left := max((width-blockWidth)/2, 0)
	top := max((height-len(blockRows))/2, 0)

	for i, row := range blockRows {
		at := top + i
		if at < 0 || at >= len(rows) {
			continue
		}
		// The composed row is clipped as well as padded: a dialog that is wider
		// than the space left in front of it would otherwise push the row past
		// the screen and wrap everything under it.
		rows[at] = padStyled(padStyled(rows[at], left)+row, width)
	}
	return joinLines(rows)
}

// renderConfirm is the approval dialog. It sits on top of everything, because
// the core is blocked until it is answered.
func (s *State) renderConfirm() string {
	if s.confirm == nil {
		return ""
	}
	width := min(s.width-10, 64)
	inner := []string{
		strong("APPROVAL NEEDED"),
		themed(theme.Risk(s.confirm.Risk), s.confirm.Risk) + muted("  ") + accent(s.confirm.Tool),
		rule(width, theme.Faint),
	}
	for _, line := range wrap(s.confirm.Command, width) {
		inner = append(inner, themed(theme.Text, line))
	}
	inner = append(inner, "")
	for _, line := range wrap(s.confirm.Reason, width) {
		inner = append(inner, muted(line))
	}
	inner = append(inner, "", strong("y")+muted(" approve    ")+strong("n")+muted(" decline"))
	return frame(inner, width, "confirm")
}

func (s *State) overlayConfirm(screen string) string {
	return placeCentre(screen, s.renderConfirm(), s.width, s.height)
}
