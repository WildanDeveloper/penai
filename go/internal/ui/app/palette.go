package app

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// paletteMaxRows is how many commands the inline palette shows at once.
const paletteMaxRows = 8

// paletteVisibleRows is how many fit on this terminal right now.
//
// The palette is drawn inside the frame, so it has to be budgeted: on a short
// terminal it shows fewer commands, and on a very short one it does not open at
// all rather than pushing the frame past the bottom of the screen.
func (s *State) paletteVisibleRows() int {
	// The frame is header + nav + body + palette + prompt + status, and the body
	// is worth at least three rows. The palette costs its own rows: the box
	// around it, the title and rule inside it, and a hint under the list.
	const minBody = 3
	fixed := headerHeight + navHeight + promptHeight + statusHeight + minBody
	room := s.height - fixed - paletteChrome
	if room < 1 {
		return 0
	}
	if room > paletteMaxRows {
		return paletteMaxRows
	}
	return room
}

// paletteChrome is what the palette costs before any command is listed: the two
// borders, the rule under the title, and the hint and its blank line under the
// list.
const paletteChrome = 5

// The inline palette: typing "/" in the console lists the commands, narrowed as
// the query grows, with the highlighted one ready to take.
//
// It is drawn in the frame, directly above the prompt, rather than as a
// full-screen dialog: the point is to keep the conversation on screen while the
// operator looks up what the next word can be.

// paletteQuery is the text the palette filters on. It is the first word of the
// prompt, so "/scope add 10.0.0.1" still narrows to "/scope" instead of matching
// nothing.
func paletteQuery(input string) string {
	if !strings.HasPrefix(input, "/") {
		return ""
	}
	first, _, _ := strings.Cut(input, " ")
	return first
}

// paletteWanted reports whether the prompt is currently a command being typed.
// Once the command is complete and an argument has started, the palette has
// nothing left to offer, so it closes.
func paletteWanted(input string) bool {
	return strings.HasPrefix(input, "/") && !strings.Contains(input, " ")
}

// paletteMatches is the commands the query narrows to, best first: exact match,
// then prefix matches, then the rest alphabetically so the list is stable.
func paletteMatches(query string) []string {
	if query == "" {
		names := make([]string, 0, len(suggestions))
		for _, item := range suggestions {
			names = append(names, item.Command)
		}
		return names
	}
	var exact, prefix, other []string
	// A substring match only makes sense while a word is being typed, so an
	// odd query like "//" matches nothing rather than everything.
	word := strings.TrimPrefix(query, "/")
	for _, item := range suggestions {
		switch {
		case item.Command == query:
			exact = append(exact, item.Command)
		case strings.HasPrefix(item.Command, query):
			prefix = append(prefix, item.Command)
		case word != "" && word != "/" && strings.Contains(strings.TrimPrefix(item.Command, "/"), word):
			other = append(other, item.Command)
		}
	}
	return append(append(exact, prefix...), other...)
}

// refreshPalette recomputes the palette from the prompt. It is called after every
// change to the input, and the selection is kept on the same command when it
// still matches, so arrowing through a list that is being re-filtered does not
// jump.
func (s *State) refreshPalette() {
	previous := ""
	if s.paletteIndex >= 0 && s.paletteIndex < len(s.palette) {
		previous = s.palette[s.paletteIndex]
	}

	if !paletteWanted(s.input.value()) {
		s.palette = nil
		s.paletteIndex = 0
		return
	}

	query := paletteQuery(s.input.value())
	matches := paletteMatches(query)
	if previous != "" {
		for i, name := range matches {
			if name == previous {
				s.paletteIndex = i
				s.palette = matches
				return
			}
		}
	}
	s.palette = matches
	s.paletteIndex = 0
}

// paletteBlock is the rows the palette occupies in the frame, borders included.
func (s *State) paletteBlock() []string {
	if len(s.palette) == 0 || s.view != model.ViewConsole {
		return nil
	}
	width := s.viewWidth()
	if s.width < narrowColumns {
		width = s.width
	}
	box := width - 2
	if box < 24 {
		box = 24
	}

	visible := s.paletteVisibleRows()
	if visible < 1 {
		return nil
	}
	rows := make([]string, 0, visible+2)
	start := 0
	if s.paletteIndex >= visible {
		start = s.paletteIndex - visible + 1
	}
	end := min(start+visible, len(s.palette))

	for i := start; i < end; i++ {
		command, detail := describeSuggestion(s.palette[i])
		marker := "  "
		name := themed(theme.Text, pad(command, 12))
		if i == s.paletteIndex {
			marker = themed(theme.Accent, theme.Selected+" ")
			name = strong(pad(command, 12))
		}
		rows = append(rows, marker+name+muted(clip(detail, max(box-14, 10))))
	}
	// The hint only earns its row when there is a list worth reading.
	if visible >= 3 {
		if len(s.palette) > visible {
			rows = append(rows, "  "+muted(fmt.Sprintf("%d of %d  -  up and down to choose, enter to run, tab to complete", end, len(s.palette))))
		} else {
			rows = append(rows, "  "+muted("up and down to choose, enter to run, tab to complete"))
		}
		rows = append(rows, "")
	}

	return strings.Split(frame(rows, box, "commands"), "\n")
}

// acceptPalette takes the highlighted command without running it, so an argument
// can be typed after it. This is what tab does; enter runs instead.
func (s *State) acceptPalette() bool {
	if len(s.palette) == 0 || s.paletteIndex < 0 || s.paletteIndex >= len(s.palette) {
		return false
	}
	s.input.setValue(s.palette[s.paletteIndex] + " ")
	s.refreshPalette()
	return true
}

// runChosen runs the highlighted command. It is what enter does while the
// palette is open, and it is the whole reason the palette is worth having: the
// operator can point at a command and be done with it in one press.
func (s *State) runChosen() (tea.Model, tea.Cmd) {
	if len(s.palette) == 0 || s.paletteIndex < 0 || s.paletteIndex >= len(s.palette) {
		return s, nil
	}
	command := s.palette[s.paletteIndex]
	s.input.setValue(command)
	s.palette = nil
	return s.submit()
}

// movePalette walks the selection, wrapping at both ends.
func (s *State) movePalette(by int) bool {
	if len(s.palette) == 0 {
		return false
	}
	s.paletteIndex = wrapIndex(s.paletteIndex+by, len(s.palette))
	return true
}

// paletteHeight is how many rows the palette takes out of the frame.
func (s *State) paletteHeight() int {
	return len(s.paletteBlock())
}

// commandHint is the one-line form, used by the help dialog and by the prompt
// when the palette is closed, so a command is described the same way everywhere.
func commandHint(command string) string {
	_, detail := describeSuggestion(command)
	if detail == "" {
		return ""
	}
	return command + " - " + detail
}
