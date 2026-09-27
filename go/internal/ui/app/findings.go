package app

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/theme"
)

// findingsView is the triage list: what was found, how bad, and where it is in
// the review cycle.
//
// The detail of the selected finding is the footer, not an extra section after
// the list: it is the evidence, and on a short terminal the list gives way
// rather than the evidence.
func (s *State) findingsView() string {
	width := s.viewWidth()
	height := s.contentHeight()
	visible := s.visibleFindings()

	head := []string{strong("FINDINGS") + muted(fmt.Sprintf("  %d of %d shown", len(visible), len(s.findings)))}
	if len(visible) == 0 {
		head = append(head, "", emptyFindings(s.findings, s.filter))
		return joinLines(head[:min(len(head), height)])
	}

	head = append(head,
		labelStyle().Render(pad("sev", 9)+pad("status", 15)+pad("title", max(width-46, 16))+"asset"),
		rule(width, theme.Faint))

	foot := s.findingDetail(visible[s.findIndex], width)

	view := newStack(head, foot)
	view.body(func(room int) []string {
		start := 0
		if s.findIndex >= room {
			start = s.findIndex - room + 1
		}
		rows := make([]string, 0, room)
		for i := start; i < start+room && i < len(visible); i++ {
			rows = append(rows, s.findingRow(visible[i], i == s.findIndex, width))
		}
		return rows
	})
	return view.render(height)
}

// emptyFindings explains an empty list, which is a different problem depending
// on whether there is nothing at all or the filter excludes everything.
func emptyFindings(all []finding, filter string) string {
	if len(all) == 0 {
		return strings.Join([]string{
			muted("nothing recorded yet."),
			muted("Run a tool, let the agent work, or add one by hand:"),
			accent("  /finding title|high|asset|detail"),
		}, "\n")
	}
	return muted(fmt.Sprintf("no findings match the filter %q. Press s to change it.", filter))
}

// findingRow is one line of the triage table.
func (s *State) findingRow(item finding, selected bool, width int) string {
	marker := "  "
	severity := themed(theme.Severity(item.Severity), pad(item.Severity, 9))
	status := themed(theme.Decision(item.Status), pad(item.Status, 15))
	// The title is a column, not the last thing on the row, so it has to be
	// padded to its width. Padding a styled string by rune count silently does
	// nothing, which is why it goes through padStyled.
	titleWidth := max(width-46, 16)
	title := padStyled(themed(theme.Text, clip(item.Title, titleWidth)), titleWidth)
	if selected {
		marker = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Render(" " + theme.Selected + " ")
		title = padStyled(lipgloss.NewStyle().Foreground(theme.Strong).Bold(true).Render(clip(item.Title, titleWidth)), titleWidth)
	}
	return marker + severity + status + title + themed(theme.Muted, clip(item.Asset, max(width-24, 8)))
}

// findingDetail renders the evidence, reproduction and remediation of one
// finding: the parts that make it actionable rather than a headline.
func (s *State) findingDetail(item finding, width int) []string {
	rows := []string{
		"",
		themed(theme.Severity(item.Severity), item.Severity) + "  " + strong(item.Title),
		muted(item.ID) + muted("  ") + muted("asset: "+item.Asset) + muted("  ") + muted("source: "+item.Source),
	}
	if item.CWE != "" {
		rows = append(rows, muted("cwe: "+item.CWE))
	}
	rows = append(rows, rule(width, theme.Faint))

	sections := []struct {
		label string
		text  string
	}{
		{"what", item.Description},
		{"evidence", item.Evidence},
		{"steps", item.Reproduction},
		{"fix", item.Remediation},
	}
	for _, section := range sections {
		if strings.TrimSpace(section.text) == "" {
			continue
		}
		rows = append(rows, label(section.label))
		for _, line := range wrap(section.text, width-2) {
			rows = append(rows, "  "+clip(line, width-2))
		}
	}
	return rows
}

// labelStyle is the muted style of the column headings.
func labelStyle() lipgloss.Style {
	return lipgloss.NewStyle().Foreground(theme.Muted)
}
