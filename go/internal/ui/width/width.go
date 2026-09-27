// Package width is the width model the client measures text with.
//
// Every box-drawing and symbol character a TUI wants to use - the rules, the
// column separators, the cursor, the check marks - is East Asian "ambiguous"
// width, which means some terminals draw it one column wide and some draw it
// two. A row measured with the wrong convention comes out wider than the screen,
// wraps, and pushes the rest of the frame down with it.
//
// So the convention is not guessed per character. It is taken from the same
// place the terminal takes it from: the locale. That gives the original design
// on a normal terminal, where those glyphs are one column, and a frame that
// still fits on a CJK one, where they are two.
//
// PENAI_AMBIGUOUS_WIDTH overrides the decision: 1 for one column, 2 for two. It
// exists because the locale is not always the whole truth - a terminal can be
// configured either way, and someone looking at a broken layout should be able
// to say so instead of filing a bug.
package width

import (
	"os"
	"regexp"
	"strings"
	"sync"

	"github.com/mattn/go-runewidth"
)

var (
	once  sync.Once
	value = 1
)

// Init decides the convention and applies it to the measuring library. It is
// called from every measurement, so calling it at start-up is optional.
func Init() int {
	once.Do(func() {
		value = decide()
		runewidth.DefaultCondition.EastAsianWidth = value == 2
	})
	return value
}

// Decide is Init without the side effect, so a test can ask what a given
// environment would choose.
func Decide() int { return decide() }

func decide() int {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("PENAI_AMBIGUOUS_WIDTH"))) {
	case "1", "narrow", "single":
		return 1
	case "2", "wide", "double":
		return 2
	}
	// Everything else: ask the locale, which is what the terminal asked too.
	if runewidth.IsEastAsian() {
		return 2
	}
	return 1
}

// Rune is how many columns one rune takes.
func Rune(r rune) int {
	Init()
	return runewidth.RuneWidth(r)
}

// String is how many columns a plain string takes.
func String(text string) int {
	Init()
	return runewidth.StringWidth(text)
}

// escape matches the sequences a terminal consumes rather than prints, so a
// styled row can be measured.
var escape = regexp.MustCompile("\x1b\\[[0-9;?]*[A-Za-z]|\x1b\\][^\a]*\a|\x1b[PX^_].*?\x1b\\\\")

// Strip removes the escape sequences from a styled row, leaving what is drawn.
func Strip(text string) string { return escape.ReplaceAllString(text, "") }

// Styled is how many columns a styled row takes on screen.
func Styled(row string) int { return String(Strip(row)) }
