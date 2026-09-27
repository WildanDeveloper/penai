package app

import (
	"strings"

	"penai/internal/ui/theme"
)

// padStyled pads a styled row out to a visible width, or clips it when it is
// already too wide.
//
// lipgloss's own Width() also wraps, which is how one long row quietly becomes
// two and the frame stops fitting the terminal. This never adds a line.
func padStyled(text string, width int) string {
	if width <= 0 {
		return ""
	}
	gap := width - visibleWidth(text)
	if gap <= 0 {
		// The row is over. Trailing blanks go first, so a row that is only over
		// because its padding is added to a glyph charged two columns loses the
		// padding rather than gaining an ellipsis where there is nothing to say.
		return truncateStyled(strings.TrimRight(text, " "), width)
	}
	return text + strings.Repeat(" ", gap)
}

// truncateStyled shortens a styled row to a visible width.
//
// A styled row mixes escape codes with printable runes, so a rune count would
// be wrong and a blind cut would land in the middle of a code, leaving the
// terminal in a strange state. The row is walked as a stream instead: escape
// sequences are buffered and only emitted when the printable part that follows
// is actually kept, so the tail is dropped cleanly.
func truncateStyled(row string, width int) string {
	if width <= 0 {
		return ""
	}
	if visibleWidth(row) <= width {
		return row
	}

	var (
		out       strings.Builder
		pending   strings.Builder
		visible   int
		inEscape  bool
		truncated bool
	)
	// The ellipsis is held back, so the result never exceeds the width it was
	// given. It is measured in columns, not bytes: a multi-byte glyph is not a
	// multi-column one.
	budget := width - runeLen(theme.Ellipsis)
	if budget < 0 {
		budget = 0
	}

	// A code is written only while nothing has been cut yet, so the row never
	// ends with a style that was meant for text nobody sees.
	flushCode := func() {
		if !truncated && pending.Len() > 0 {
			out.WriteString(pending.String())
		}
		pending.Reset()
	}

	for _, r := range row {
		switch {
		case r == '\x1b':
			flushCode()
			inEscape = true
			pending.WriteRune(r)
		case inEscape:
			pending.WriteRune(r)
			// A control sequence ends with a byte in @..~; the '[' that opens
			// one is in that range too, so it is excluded explicitly.
			if r != '[' && r >= '@' && r <= '~' {
				inEscape = false
				flushCode()
			}
		case visible+runeCols(r) > budget:
			truncated = true
		default:
			// Charged by column, not by rune: a row full of ambiguous-width
			// glyphs is twice as wide as a rune count says it is.
			visible += runeCols(r)
			out.WriteRune(r)
		}
	}

	if truncated {
		out.WriteString(theme.Ellipsis + "\x1b[0m")
	}
	return out.String()
}
