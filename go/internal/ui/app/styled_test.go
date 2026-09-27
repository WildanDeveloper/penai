package app

import "testing"

// TestTruncateStyledNeverSplitsACode is the invariant that keeps a clipped row
// harmless: a half-written escape sequence would leave the terminal colouring
// the rest of the screen.
func TestTruncateStyledNeverSplitsACode(t *testing.T) {
	row := padStyled("findings 12 (3 open)  ·  tools 4", 20)
	clipped := truncateStyled(row, 20)
	if strip := stripANSI(clipped); strip == "" {
		t.Fatal("clipping produced nothing")
	}
	// Every escape that survives must be a complete sequence.
	for i := 0; i < len(clipped); i++ {
		if clipped[i] != 0x1b {
			continue
		}
		if i+1 >= len(clipped) || clipped[i+1] != '[' {
			t.Fatalf("bare escape byte at %d in %q", i, clipped)
		}
		end := i + 2
		for end < len(clipped) && clipped[end] != 'm' {
			end++
		}
		if end >= len(clipped) {
			t.Fatalf("unterminated escape at %d in %q", i, clipped)
		}
		i = end
	}
}

// TestTruncateStyledFitsTheWidth checks the result never exceeds the budget.
func TestTruncateStyledFitsTheWidth(t *testing.T) {
	long := "the quick brown fox jumps over the lazy dog and keeps on running"
	for width := 4; width <= 30; width++ {
		got := stripANSI(truncateStyled(long, width))
		if columns := runeLen(got); columns > width {
			t.Errorf("width %d: got %d columns %q", width, columns, got)
		}
	}
}

// TestPadStyledPadsAndClips covers the two directions.
func TestPadStyledPadsAndClips(t *testing.T) {
	if got := stripANSI(padStyled("ab", 6)); got != "ab    " {
		t.Errorf("pad: got %q", got)
	}
	if got := stripANSI(padStyled("abcdefghij", 4)); runeLen(got) != 4 {
		t.Errorf("clip: got %q (%d columns)", got, runeLen(got))
	}
	if got := padStyled("ab", 0); got != "" {
		t.Errorf("zero width: got %q", got)
	}
}
