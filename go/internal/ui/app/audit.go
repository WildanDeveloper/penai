package app

import (
	"fmt"
	"strings"

	"penai/internal/ui/theme"
)

// auditView is the decision log: every time something was allowed, refused or
// asked about, with the reason the engine gave.
func (s *State) auditView() string {
	width := s.viewWidth()
	height := s.contentHeight()

	lines := []string{
		strong("AUDIT") + muted(fmt.Sprintf("  %d decision(s), newest first", len(s.audit))),
		rule(width, theme.Faint),
	}

	if len(s.audit) == 0 {
		lines = append(lines, muted("nothing has been decided yet."))
		return joinLines(lines)
	}

	// Counts first, so the shape of the engagement is legible without reading.
	counts := map[string]int{}
	for _, entry := range s.audit {
		counts[entry.Decision]++
	}
	summary := make([]string, 0, 4)
	for _, decision := range []string{"allowed", "confirmed", "denied", "manual-only"} {
		if counts[decision] == 0 {
			continue
		}
		summary = append(summary, themed(theme.Decision(decision), fmt.Sprintf("%s %d", decision, counts[decision])))
	}
	lines = append(lines, strings.Join(summary, "  "), "")

	budget := height - len(lines)
	if budget < 3 {
		budget = 3
	}

	// Each entry is built as a block and the blocks are reversed, so the newest
	// decision ends up at the bottom where the scroll offset starts. Reversing
	// the flattened rows instead would put a command on the far side of the
	// decision it belongs to.
	blocks := make([][]string, 0, len(s.audit))
	for _, entry := range s.audit {
		block := []string{
			"  " +
				themed(theme.Decision(entry.Decision), pad(entry.Decision, 12)) +
				themed(theme.Muted, pad(entry.Actor, 6)) +
				accent(pad(entry.Tool, 18)) +
				clip(entry.Reason, max(width-46, 12)),
		}
		// The command the engine would have run is the evidence that matters,
		// so it goes on its own line rather than being truncated away.
		if entry.Command != "" {
			block = append(block, "      "+muted(clip(entry.Command, width-8)))
		}
		blocks = append(blocks, block)
	}

	rows := make([]string, 0, len(blocks)*2)
	for i := len(blocks) - 1; i >= 0; i-- {
		rows = append(rows, blocks[i]...)
	}
	lines = append(lines, visibleRows(rows, budget, s.scroll)...)

	return joinLines(lines)
}
