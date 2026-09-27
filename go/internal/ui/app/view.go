package app

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// View renders the whole screen.
//
// Layout, from the top: header, navigation, body (sidebar plus the active
// view), prompt, status. When the terminal is too small for that, it says so
// rather than drawing something broken.
func (s *State) View() string {
	if s.width < minColumns || s.height < minRows {
		return tooSmall(s.width, s.height)
	}

	header := s.header()
	nav := s.navStrip()
	body := s.body()
	prompt := s.prompt()
	status := s.statusBar()

	// Every row is fitted to the terminal width here rather than trusted to
	// each view: one over-wide hint is enough to make the whole frame too wide,
	// and the terminal then wraps it into a screen that no longer lines up.
	// The palette lives in the frame, directly above the prompt, and takes its
	// rows out of the body rather than pushing the layout down.
	parts := []string{header, nav, body}
	if block := s.paletteBlock(); len(block) > 0 {
		left := max((s.width-visibleWidth(block[0]))/2, 0)
		fitted := make([]string, 0, len(block))
		for _, row := range block {
			fitted = append(fitted, strings.Repeat(" ", left)+row)
		}
		parts = append(parts, joinLines(fitted))
	}
	parts = append(parts, prompt, status)

	screen := lipgloss.JoinVertical(lipgloss.Left, parts...)

	if s.modal != model.ModalNone {
		screen = s.overlay(screen)
	}
	if s.confirm != nil {
		screen = s.overlayConfirm(screen)
	}

	// The frame is fitted to the terminal as the very last step, after the
	// dialogs have been laid over it. This is the only place the guarantee can
	// be made: a row one column too wide wraps, and one wrapped row pushes the
	// rest of the screen down and destroys the alignment of everything under it.
	rows := strings.Split(screen, "\n")
	fitted := make([]string, 0, len(rows))
	for _, row := range rows {
		fitted = append(fitted, padStyled(row, s.width))
	}
	return joinLines(fitted)
}

// The fixed chrome, in rows. Getting this exactly right matters: a frame one
// row taller than the terminal scrolls the whole screen and loses the header.
const (
	headerHeight = 3
	navHeight    = 1
	promptHeight = 1
	statusHeight = 1
)

// body is the sidebar beside the active view, or the view alone when the
// terminal is too narrow to carry both.
//
// Both halves are clipped to the same height: a sidebar with more rows than the
// view would otherwise make the frame taller than the terminal.
func (s *State) body() string {
	height := s.contentHeight()
	view := clipHeight(strings.Split(s.activeView(), "\n"), height)
	if s.width < narrowColumns {
		return joinLines(view)
	}

	// A column rule between the two halves, so the sidebar never reads as part
	// of the view. Without it the two are one continuous run of text and there
	// is nothing telling the eye where one stops.
	sidebarWidth := 26
	if s.width < 100 {
		sidebarWidth = 22
	}
	viewWidth := s.width - sidebarWidth - 2
	sidebar := clipHeight(strings.Split(s.sidebar(), "\n"), height)
	view = clipHeight(wrapBlock(view, viewWidth), height)

	sidebarRows := make([]string, 0, height)
	for _, row := range sidebar {
		sidebarRows = append(sidebarRows, padStyled(row, sidebarWidth))
	}
	viewRows := make([]string, 0, height)
	for _, row := range view {
		viewRows = append(viewRows, padStyled(row, viewWidth))
	}

	// The divider cell is two columns: the rule itself and a space of air, so
	// the view does not start glued to it.
	divider := make([]string, 0, height)
	for range sidebarRows {
		divider = append(divider, themed(theme.Faint, theme.Column)+" ")
	}

	return lipgloss.JoinHorizontal(
		lipgloss.Top,
		joinLines(sidebarRows),
		joinLines(divider),
		joinLines(viewRows),
	)
}

// activeView is the dispatcher to the six view renderers.
func (s *State) activeView() string {
	switch s.view {
	case model.ViewConsole:
		return s.consoleView()
	case model.ViewScout:
		return s.scoutView()
	case model.ViewFindings:
		return s.findingsView()
	case model.ViewScope:
		return s.scopeView()
	case model.ViewReport:
		return s.reportView()
	case model.ViewAudit:
		return s.auditView()
	}
	return ""
}

// contentHeight is how many rows the active view may use, after the chrome. The
// palette, when it is open, comes out of this rather than off the top.
func (s *State) contentHeight() int {
	height := s.height - headerHeight - navHeight - promptHeight - statusHeight - s.paletteHeight()
	if height < 3 {
		return 3
	}
	return height
}

// viewWidth is the width available to the active view, which has to agree with
// body() or the views wrap to a width their column cannot hold.
func (s *State) viewWidth() int {
	if s.width < narrowColumns {
		return s.width
	}
	sidebar := 26
	if s.width < 100 {
		sidebar = 22
	}
	// Two columns go to the gap and the divider.
	width := s.width - sidebar - 2
	if width < 20 {
		return 20
	}
	return width
}

// tooSmall is the message shown when there is no room to draw anything.
func tooSmall(width, height int) string {
	line := lipgloss.NewStyle().
		Foreground(theme.Warn).
		Align(lipgloss.Center).
		Border(lipgloss.RoundedBorder()).
		BorderForeground(theme.Border).
		Padding(1, 3).
		Render(fmt.Sprintf("terminal too small\n\n%d x %d, need at least %d x %d", width, height, minColumns, minRows))
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, line)
}

// rule is a horizontal divider, one row tall. The character is ASCII so the row
// is exactly as wide as it claims on any terminal; see the theme package for why
// that matters here.
func rule(width int, color lipgloss.Color) string {
	return lipgloss.NewStyle().Foreground(color).Render(fill(theme.Rule, width))
}

// style helpers shared by the views, so a colour means the same thing everywhere.
func label(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Muted).Render(text)
}

func value(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Text).Render(text)
}

func strong(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Strong).Bold(true).Render(text)
}

func accent(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Accent).Render(text)
}

func muted(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Muted).Render(text)
}

func good(text string) string {
	return lipgloss.NewStyle().Foreground(theme.OK).Render(text)
}

func bad(text string) string {
	return lipgloss.NewStyle().Foreground(theme.Danger).Render(text)
}

func themed(color lipgloss.Color, text string) string {
	return lipgloss.NewStyle().Foreground(color).Render(text)
}

// kv is one "label   value" row for the sidebar and the model dialog.
//
// An empty value is shown as a dash rather than left blank: on the first frame,
// before the core has answered, a row with a label and nothing after it reads as
// broken rather than as not loaded yet.
func kv(key, val string, width int) string {
	keyWidth := 11
	if width < 34 {
		keyWidth = 9
	}
	if val == "" {
		val = muted("-")
	}
	return label(pad(key, keyWidth)) + clip(val, width-keyWidth-1)
}

// spinner is a tiny busy indicator. There is no timer in this client, so it
// advances with the work arriving rather than on its own clock.
func (s *State) spinner() string {
	if !s.busy {
		return ""
	}
	return themed(theme.Accent, string([]rune(theme.Spinner)[s.spinPhase()]))
}

func (s *State) spinPhase() int { return len(s.lines) % 10 }

// joinLines is JoinVertical for a plain slice, kept local so callers do not
// have to import lipgloss for one call.
func joinLines(lines []string) string {
	return strings.Join(lines, "\n")
}
