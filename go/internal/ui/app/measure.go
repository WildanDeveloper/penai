package app

import (
	"penai/internal/ui/width"
)

// runeCols is how many columns one rune takes, in the convention the terminal in
// front of the client is using. See the width package for why this is not a
// constant.
func runeCols(r rune) int { return width.Rune(r) }

// runeLen measures plain text in columns.
func runeLen(text string) int { return width.String(text) }

// visibleWidth is how many columns a styled row occupies, counting the escape
// sequences as nothing at all.
func visibleWidth(text string) int { return width.Styled(text) }

// stripANSI removes the escape sequences, leaving what the operator sees.
func stripANSI(text string) string { return width.Strip(text) }
