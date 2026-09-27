package app

import (
	"strconv"

	"penai/internal/ui/theme"
)

// stack lays a view out in three parts: a heading, a body, and a footer.
//
// Every list view has the same problem - a heading, something that grows with
// the data, and a detail pane or a result at the bottom - and the same failure
// when the terminal is short: the overflow is clipped off the end, which is
// exactly where the result lives.
//
// The body is built by a function rather than supplied as rows, because the
// stack is the only thing that knows how much room is really left after the
// heading has given way. The builder is handed that room, so what it returns
// always fits, and a list can centre itself on the selected row instead of
// hoping its window survived.
type stack struct {
	head   []string
	foot   []string
	bodyFn func(room int) []string
	// compact stops the block from stretching: the body ends where its content
	// ends instead of being padded out to push the footer to the bottom. A view
	// with a short list looks broken with a hole in the middle of it.
	compact bool
}

// newStack starts a layout. The head and the foot are the rows that must
// survive, because they carry the title and the result.
func newStack(head, foot []string) *stack {
	return &stack{head: head, foot: foot}
}

// compactStack is for a view whose content is naturally short, where padding
// out to the footer would leave a gap in the middle of the screen.
func compactStack(head, foot []string) *stack {
	return &stack{head: head, foot: foot, compact: true}
}

// body sets the builder for the middle of the view.
func (s *stack) body(build func(room int) []string) { s.bodyFn = build }

// room is how many rows the body gets once the heading has given what it can.
func (s *stack) room(height int) int {
	head := len(s.head)
	for height-head-len(s.foot) < 1 && head > 0 {
		head--
	}
	return max(height-head-len(s.foot), 0)
}

// render produces exactly height rows.
func (s *stack) render(height int) string {
	if height <= 0 {
		return ""
	}

	rows := make([]string, 0, height)
	rows = append(rows, s.head...)

	// When the frame does not fit, the heading gives way first: on a short
	// terminal the list and the result are what the operator is looking at, and
	// a title is the cheapest thing to lose.
	room := s.room(height)
	for len(rows) > 0 && height-len(rows)-len(s.foot) < 1 {
		rows = rows[:len(rows)-1]
	}

	if s.bodyFn != nil && room > 0 {
		body := s.bodyFn(room)
		switch {
		case len(body) > room:
			dropped := len(body) - room
			if room > 1 {
				rows = append(rows, muted(theme.Ellipsis+" "+strconv.Itoa(dropped)+" more above"))
			}
			rows = append(rows, body[len(body)-room+min(1, room-1):]...)
		case len(body) < room:
			rows = append(rows, body...)
			for len(rows) < height-len(s.foot) {
				rows = append(rows, "")
			}
		default:
			rows = append(rows, body...)
		}
	}

	rows = append(rows, s.foot...)
	return joinLines(rows[:min(len(rows), height)])
}
