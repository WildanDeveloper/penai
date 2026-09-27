package app

import (
	"fmt"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/theme"
)

// scoutView is the tool catalogue: pick one, type its arguments, run it.
//
// The layout is a heading, the list, then a footer holding the description of
// the highlighted tool, its arguments and the result of the last run. The
// footer is what the operator is there for, so it is budgeted before the list
// is: on a short terminal the list is what gives way.
func (s *State) scoutView() string {
	width := s.viewWidth()
	height := s.contentHeight()

	if len(s.tools) == 0 {
		return muted("no tools are registered")
	}

	heading := []string{strong("TOOLS"), muted("enter to type arguments, ctrl+r to run, esc for the console"), ""}

	// The list is guaranteed three rows - the selected tool and something to
	// scroll through - and the footer is built inside whatever is left, so a
	// long description cannot squeeze the list out of the frame.
	minList := 3
	footBudget := height - len(heading) - minList
	if footBudget < 1 {
		footBudget = 1
	}
	foot := make([]string, 0, footBudget)
	if len(s.scoutOutput) > 0 {
		foot = append(foot, strong("LAST RUN"))
		foot = append(foot, s.scoutOutput...)
		foot = append(foot, "")
	}
	for _, row := range s.scoutDetail(width) {
		if len(foot) >= footBudget {
			break
		}
		foot = append(foot, row)
	}

	view := newStack(heading, foot)
	view.body(func(room int) []string {
		// The window is centred on the selected tool and is never larger than
		// the room the stack actually has, so the selection cannot be the row
		// that gets dropped.
		start := 0
		if s.scoutIndex >= room {
			start = s.scoutIndex - room + 1
		}
		rows := make([]string, 0, room)
		for i := start; i < start+room && i < len(s.tools); i++ {
			rows = append(rows, s.toolRow(i, width))
		}
		return rows
	})
	return view.render(height)
}

// scoutDetail describes the highlighted tool: description, then one line per
// argument with its type and whether it is required.
func (s *State) scoutDetail(width int) []string {
	if s.scoutIndex < 0 || s.scoutIndex >= len(s.tools) {
		return nil
	}
	tool := s.tools[s.scoutIndex]
	rows := []string{rule(width, theme.Faint)}

	for _, line := range wrap(tool.Description, width) {
		rows = append(rows, themed(theme.Text, line))
	}
	if len(tool.Args) > 0 {
		rows = append(rows, "")
		for _, arg := range tool.Args {
			flag := " "
			if arg.Required {
				flag = "*"
			}
			rows = append(rows,
				themed(theme.Accent, clip(arg.Name, 16))+
					themed(theme.Muted, pad(fmt.Sprintf("%s%s", arg.Type, flag), 10))+
					clip(arg.Description, max(width-26, 8)))
		}
	}
	return rows
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// toolRow is one line of the tool list: the marker, the name, the risk, the
// kind and what the tool is for.
func (s *State) toolRow(i, width int) string {
	tool := s.tools[i]
	marker := "  "
	name := value(pad(clip(tool.Name, 20), 21))
	if i == s.scoutIndex {
		marker = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Render(" " + theme.Selected + " ")
		name = lipgloss.NewStyle().Foreground(theme.Strong).Render(pad(clip(tool.Name, 20), 21))
	}
	meta := themed(theme.Risk(tool.Risk), pad(tool.Risk, 7))
	meta += themed(theme.Muted, pad(tool.Kind, 9))
	return marker + name + meta + clip(tool.Title, max(width-40, 10))
}
