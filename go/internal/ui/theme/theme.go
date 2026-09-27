// Package theme holds the colours and glyphs the client renders with.
//
// The glyphs here are the box-drawing and symbol characters that make a terminal
// client look like one. Every one of them is East Asian "ambiguous" width, so
// they are measured through the width package rather than counted, which is
// what keeps a rule continuous instead of half a cell too long on a terminal
// that draws them two columns wide.
package theme

import "github.com/charmbracelet/lipgloss"

var (
	Accent    = lipgloss.Color("#38bdf8")
	AccentDim = lipgloss.Color("#0ea5e9")
	OK        = lipgloss.Color("#4ade80")
	Warn      = lipgloss.Color("#fbbf24")
	Danger    = lipgloss.Color("#f87171")
	Critical  = lipgloss.Color("#fb7185")
	Muted     = lipgloss.Color("#6b7280")
	Faint     = lipgloss.Color("#374151")
	Text      = lipgloss.Color("#e5e7eb")
	Strong    = lipgloss.Color("#f9fafb")
	Border    = lipgloss.Color("#374151")
	Panel     = lipgloss.Color("#111827")
	HeaderBg  = lipgloss.Color("#1f2937")
	SelectBg  = lipgloss.Color("#1e3a5f")
)

// Severity maps a severity name to its colour.
func Severity(name string) lipgloss.Color {
	switch name {
	case "critical":
		return Critical
	case "high":
		return Danger
	case "medium":
		return Warn
	case "low":
		return Accent
	default:
		return Muted
	}
}

// Risk maps an execution risk to its colour.
func Risk(name string) lipgloss.Color {
	switch name {
	case "safe":
		return OK
	case "low":
		return Accent
	case "medium":
		return Warn
	case "high":
		return Danger
	default:
		return Critical
	}
}

// Decision maps an audit decision to its colour.
func Decision(name string) lipgloss.Color {
	switch name {
	case "allowed":
		return OK
	case "confirmed":
		return Accent
	case "denied":
		return Danger
	default:
		return Warn
	}
}

// The layout skeleton.
const (
	// Rule draws a horizontal divider, repeated so it reads as one line.
	Rule = "─"
	// RuleLight is the heavier divider, used where a section really begins.
	RuleLight = "━"
	// Column separates the sidebar from the view, top to bottom.
	Column = "│"
	// Selected marks the row under the cursor.
	Selected = "▸"
	// Caret is the text cursor.
	Caret = "▏"
	// Pass and Fail mark an outcome.
	Pass = "✓"
	Fail = "✗"
	// Ellipsis marks clipped text.
	Ellipsis = "…"
	// Bullet separates items in a single-line strip.
	Bullet = "·"
	// Spinner, one frame at a time.
	Spinner = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
)

// The dialog frame.
const (
	BoxTopLeft     = "╭"
	BoxTopRight    = "╮"
	BoxBottomLeft  = "╰"
	BoxBottomRight = "╯"
	BoxHorizontal  = "─"
	BoxVertical    = "│"
)
