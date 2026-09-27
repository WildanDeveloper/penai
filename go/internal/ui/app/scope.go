package app

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/theme"
)

// scopeView is the authorisation panel: what may be tested, and how hard.
//
// Nothing can run until this list has an entry, so the mode and the target list
// come first and the field for adding a target is the footer: on a short
// terminal the target list gives way, not the way in. The block is compact, so
// a short list ends where it ends instead of leaving a hole in the screen.
func (s *State) scopeView() string {
	width := s.viewWidth()
	height := s.contentHeight()

	head := []string{
		strong("SCOPE") + muted(fmt.Sprintf("  %d authorised", len(s.scope))),
		"",
		strong("MODE") + "  " + s.modeBadge(),
	}
	for _, line := range modeRules(s.session.Mode) {
		head = append(head, "  "+muted(line))
	}
	head = append(head, "  "+muted("press m to cycle"), "", rule(width, theme.Faint))

	foot := s.scopeFooter()

	if len(s.scope) == 0 {
		head = append(head,
			bad("Nothing is authorised yet, so no tool will run."),
			"",
			"  "+value("/scope add 10.16.0.0/28"),
			"  "+value("/scope add app.internal.lab  staging web front door"),
			"  "+value("/scope add https://staging.example.test"),
			"",
			muted("Anything outside these entries is refused by the core, not by the client."))
		return joinLines(head)
	}

	head = append(head, label(pad("id", 18)+pad("kind", 7)+"value"))

	// The list is short most of the time, and a gap between the targets and the
	// field to add one looks like something failed to load.
	view := compactStack(head, foot)
	view.body(func(room int) []string {
		// Each target is a row plus, when it has one, a note. The window starts
		// one target above the selection and stops as soon as the room is used
		// up, so a note is never orphaned from the target it belongs to.
		rows := make([]string, 0, room)
		start := max(s.findIndex-1, 0)
		for i := start; i < len(s.scope) && len(rows) < room; i++ {
			rows = append(rows, s.scopeRow(i, width))
			if note := s.scope[i].Note; note != "" && len(rows) < room {
				rows = append(rows, "      "+muted(clip(note, width-8)))
			}
		}
		return rows
	})
	return view.render(height)
}

// scopeRow is one authorised target.
func (s *State) scopeRow(i, width int) string {
	target := s.scope[i]
	marker := "  "
	row := themed(theme.Muted, pad(target.ID, 18)) +
		themed(theme.Accent, pad(target.Kind, 7)) +
		clip(target.Value, max(width-27, 10))
	if i == s.findIndex {
		marker = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Render(" " + theme.Selected + " ")
		row = lipgloss.NewStyle().Foreground(theme.Strong).Render(row)
	}
	return marker + row
}

// scopeFooter is the field for adding a target. It is the mandatory part of
// this view: without it there is no way to authorise anything from here.
//
// The configuration checks are deliberately not repeated. The sidebar beside
// this view already lists them, and saying the same thing twice in one screen
// costs eight rows to say nothing new.
func (s *State) scopeFooter() []string {
	return []string{
		strong("ADD") + "  " + s.scopeDraft.view("ip, cidr, host or url", s.scopeFocus),
		muted("enter to add, backspace to remove the selected target"),
	}
}

// modeRules spells out what each execution ceiling actually permits, because
// "balanced" means nothing to anyone who has not read the policy engine.
func modeRules(mode string) []string {
	switch mode {
	case "safe":
		return []string{
			"nothing runs without asking",
			"only passive lookups and safe requests",
		}
	case "balanced":
		return []string{
			"safe and low risk run unattended",
			"anything above that asks first",
			"shell access stays off",
		}
	default:
		return []string{
			"everything except destructive targets runs unattended",
			"destructive tools still ask",
			"shell access stays off unless PENAI_ALLOW_SHELL=1",
		}
	}
}
