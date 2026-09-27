package app

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/theme"
)

// reportView previews the deliverable and writes it out.
func (s *State) reportView() string {
	width := s.viewWidth()
	height := s.contentHeight()

	formats := []string{"markdown", "html", "sarif", "json"}
	tabs := make([]string, 0, len(formats))
	for _, name := range formats {
		if name == s.reportForm {
			tabs = append(tabs, lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Bold(true).Render(" "+name+" "))
			continue
		}
		tabs = append(tabs, muted(pad(name, len(name)+2)))
	}

	lines := []string{
		strong("REPORT") + "  " + strings.Join(tabs, " "),
		muted("w writes it, page up and down scroll"),
		"",
	}

	if s.reportBody == "" {
		lines = append(lines, muted("no preview yet. Press m, h, s or j to render one."))
		return joinLines(lines)
	}

	rows := make([]string, 0, height)
	for _, raw := range strings.Split(s.reportBody, "\n") {
		rows = append(rows, s.reportLine(raw, width))
	}
	tail := visibleRows(rows, height-len(lines), s.scroll)
	lines = append(lines, tail...)

	if s.scroll > 0 {
		lines = append(lines, "", label(fmt.Sprintf("+%d lines above", s.scroll)))
	}
	return joinLines(lines)
}

// reportLine styles one line of the preview, so structure is visible without
// opening the file.
func (s *State) reportLine(raw string, width int) string {
	trimmed := strings.TrimRight(raw, " ")
	indent := len(trimmed) - len(strings.TrimLeft(trimmed, " "))
	body := strings.TrimLeft(trimmed, " ")
	pad := strings.Repeat(" ", min(indent, 8))

	switch {
	case strings.HasPrefix(body, "#"):
		return pad + strong(clip(body, width-indent))
	case strings.HasPrefix(body, "|") && strings.HasSuffix(body, "|"):
		return pad + themed(theme.Muted, clip(body, width-indent))
	case strings.HasPrefix(body, "- ") || strings.HasPrefix(body, "* "):
		return pad + themed(theme.AccentDim, theme.Bullet+" ") + clip(drop(body, 2), width-indent-2)
	case strings.HasPrefix(body, "> "):
		return pad + themed(theme.Warn, clip(drop(body, 2), width-indent-2))
	case strings.HasPrefix(body, "**") && strings.HasSuffix(body, "**"):
		return pad + strong(clip(body, width-indent))
	case body == "---" || body == "===":
		return pad + rule(max(width-indent, 1), theme.Faint)
	case body == "":
		return ""
	default:
		return pad + themed(theme.Text, clip(body, width-indent))
	}
}
