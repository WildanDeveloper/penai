package app

import (
	"strings"

	"penai/internal/ui/theme"
)

// Ellipsis is the marker for clipped text. It lives here so the helpers that
// append it all reserve the same number of columns.
func Ellipsis() string { return theme.Ellipsis }

// wrap breaks text to a width, on word boundaries where possible and mid-word
// where a single token is longer than the line.
func wrap(text string, width int) []string {
	if width <= 0 {
		return []string{text}
	}
	lines := []string{}
	for _, paragraph := range strings.Split(text, "\n") {
		if paragraph == "" {
			lines = append(lines, "")
			continue
		}
		lines = append(lines, wrapParagraph(paragraph, width)...)
	}
	return lines
}

func wrapParagraph(text string, width int) []string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return []string{""}
	}
	lines := []string{}
	current := ""
	for _, word := range words {
		switch {
		case current == "":
			current = word
		case runeLen(current)+1+runeLen(word) <= width:
			current += " " + word
		default:
			lines = append(lines, current)
			current = word
		}
		// A single word wider than the line is broken as it is added.
		for runeLen(current) > width {
			head, tail := splitCols(current, width)
			lines = append(lines, head)
			current = tail
		}
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

// clip shortens plain text to a width, with an ellipsis when it had to cut.
//
// It counts columns, not runes, so a word of box-drawing characters is cut as
// early as it needs to be. It must only be used on text without escape codes; a
// styled row needs truncateStyled, which will not cut a sequence in half.
func clip(text string, width int) string {
	if width <= 0 {
		return ""
	}
	if runeLen(text) <= width {
		return text
	}
	room := width - runeLen(Ellipsis())
	if room <= 0 {
		return Ellipsis()
	}
	head, _ := splitCols(text, room)
	return head + Ellipsis()
}

// pad right-pads with spaces to an exact width, which is how table columns and
// box edges stay aligned whatever is inside them.
func pad(text string, width int) string {
	gap := width - runeLen(text)
	if gap <= 0 {
		return clip(text, width)
	}
	return text + strings.Repeat(" ", gap)
}

// padLeft left-pads, for numbers and right-aligned columns.
func padLeft(text string, width int) string {
	gap := width - runeLen(text)
	if gap <= 0 {
		return clip(text, width)
	}
	return strings.Repeat(" ", gap) + text
}

// fill repeats a glyph until it covers exactly the width, counting columns.
// A rule is one glyph repeated, so on a terminal that draws it two columns wide
// half as many of them are needed, and one column too many is a wrapped screen.
func fill(glyph string, width int) string {
	if width <= 0 || glyph == "" {
		return ""
	}
	var (
		out   strings.Builder
		used  int
		runes = []rune(glyph)
	)
	for i := 0; used < width; i++ {
		r := runes[i%len(runes)]
		columns := runeCols(r)
		if used+columns > width {
			// A glyph that would straddle the edge: pad the rest instead, so
			// the rule is still exactly the width the frame promised.
			out.WriteString(strings.Repeat(" ", width-used))
			used = width
			break
		}
		out.WriteRune(r)
		used += columns
	}
	return out.String()
}

// splitCols cuts text at a column boundary and returns the two halves.
func splitCols(text string, at int) (string, string) {
	if at <= 0 {
		return "", text
	}
	used := 0
	for i, r := range text {
		columns := runeCols(r)
		if used+columns > at {
			return text[:i], text[i:]
		}
		used += columns
	}
	return text, ""
}

// take returns the first n columns of text.
func take(text string, n int) string {
	head, _ := splitCols(text, n)
	return head
}

// drop removes the first n columns of text.
func drop(text string, n int) string {
	_, tail := splitCols(text, n)
	return tail
}

// visibleRows fits content into a height, honouring a scroll offset counted
// from the bottom: offset 0 is the newest row, which is what a log wants.
func visibleRows(rows []string, height, offset int) []string {
	if height <= 0 || len(rows) == 0 {
		return nil
	}
	end := len(rows) - offset
	if end < 0 {
		end = 0
	}
	start := end - height
	if start < 0 {
		start = 0
	}
	return rows[start:end]
}

// clipHeight keeps at most n rows, padding with blanks so the block is exactly
// n tall. A frame of the wrong height is what makes a terminal scroll, so every
// block placed into the layout goes through this.
func clipHeight(rows []string, n int) []string {
	if n <= 0 {
		return nil
	}
	if len(rows) > n {
		return rows[len(rows)-n:]
	}
	for len(rows) < n {
		rows = append(rows, "")
	}
	return rows
}

// wrapBlock clips rows that came from lipgloss, and so carry escape codes, to a
// plain width.
func wrapBlock(rows []string, width int) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		if visibleWidth(row) <= width {
			out = append(out, row)
			continue
		}
		out = append(out, truncateStyled(row, width))
	}
	return out
}
