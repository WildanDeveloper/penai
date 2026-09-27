package app

import (
	"strings"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// consoleView is the conversation: the operator, the model, the tools it ran
// and the results, with the newest line at the bottom.
func (s *State) consoleView() string {
	width := s.viewWidth()
	height := s.contentHeight()

	// Room for the streaming reply that has not been committed to a line yet.
	pending := 0
	if text := s.streaming.String(); text != "" {
		pending = len(wrap(text, width-2))
	}

	body := height - pending
	if body < 1 {
		body = 1
	}

	rows := make([]string, 0, body)
	rendered := s.renderedLines(width)
	tail := visibleRows(rendered, body, s.scroll)
	for _, row := range tail {
		rows = append(rows, row)
	}
	for len(rows) < body {
		rows = append([]string{""}, rows...)
	}

	if pending > 0 {
		for i, line := range wrap(s.streaming.String(), width-2) {
			prefix := "  "
			if i == 0 {
				prefix = accent("ai ")
			}
			rows = append(rows, prefix+clip(line, width-2))
			if len(rows) > body+pending {
				break
			}
		}
	}

	// A live marker at the bottom when following the tail.
	if s.scroll == 0 {
		// The block marks the live edge of the log. It sits at the end of the
		// last row rather than on a row of its own, so the frame keeps its
		// height and nothing scrolls.
		rows[len(rows)-1] = padStyled(rows[len(rows)-1], width-1) + themed(theme.AccentDim, theme.Caret)
	}

	return joinLines(rows)
}

// renderedLines turns the log into styled rows, wrapped to the view width.
func (s *State) renderedLines(width int) []string {
	rows := make([]string, 0, len(s.lines))
	for _, line := range s.lines {
		_, style, glyph := lineDecoration(line.Kind)
		// The glyph is part of the row, so it comes out of the width budget
		// before the text is wrapped. Forgetting that widens every row, and
		// lipgloss then pads the whole frame to match.
		indent := runeLen(glyph)
		for i, piece := range wrap(line.Text, width-indent) {
			if i == 0 {
				rows = append(rows, themed(style, glyph+piece))
				continue
			}
			rows = append(rows, strings.Repeat(" ", indent)+themed(style, piece))
		}
	}
	return rows
}

// lineDecoration is the prefix, colour and glyph for a log line.
func lineDecoration(kind model.LineKind) (string, lipgloss.Color, string) {
	switch kind {
	case model.KindUser:
		return "", theme.Accent, "you "
	case model.KindAssistant:
		return "", theme.Text, "ai  "
	case model.KindCommand:
		return "", theme.AccentDim, "$   "
	case model.KindTool:
		return "", theme.Muted, "     "
	case model.KindResult:
		return "", theme.OK, theme.Pass + "  "
	case model.KindNotice:
		return "", theme.Warn, "i    "
	case model.KindError:
		return "", theme.Danger, theme.Fail + "  "
	default:
		return "", theme.Muted, "     "
	}
}
