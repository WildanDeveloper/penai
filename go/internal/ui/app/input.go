package app

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/theme"
)

// textInput is a single-line editor: runes, a cursor, and word motions.
//
// It is deliberately small rather than pulled from a widget library, because
// the whole client only ever needs one line of text at a time and paste needs
// to arrive as plain text without a widget intercepting bracketed-paste bytes.
type textInput struct {
	runes  []rune
	cursor int
	// offset is the first visible rune, for lines wider than the view.
	offset int
	width  int
}

func newTextInput() textInput { return textInput{} }

func (t *textInput) value() string { return string(t.runes) }

func (t *textInput) setValue(s string) {
	t.runes = []rune(s)
	t.cursor = len(t.runes)
	t.clamp()
}

func (t *textInput) clear() {
	t.runes = nil
	t.cursor = 0
	t.offset = 0
}

func (t *textInput) empty() bool { return len(t.runes) == 0 }

func (t *textInput) clamp() {
	if t.cursor < 0 {
		t.cursor = 0
	}
	if t.cursor > len(t.runes) {
		t.cursor = len(t.runes)
	}
	if t.width > 0 {
		if t.cursor < t.offset {
			t.offset = t.cursor
		}
		if t.cursor >= t.offset+t.width {
			t.offset = t.cursor - t.width + 1
		}
		if t.offset < 0 {
			t.offset = 0
		}
	}
}

func (t *textInput) insert(r rune) {
	t.runes = append(t.runes[:t.cursor], append([]rune{r}, t.runes[t.cursor:]...)...)
	t.cursor++
	t.clamp()
}

func (t *textInput) backspace() {
	if t.cursor == 0 {
		return
	}
	t.runes = append(t.runes[:t.cursor-1], t.runes[t.cursor:]...)
	t.cursor--
	t.clamp()
}

func (t *textInput) deleteForward() {
	if t.cursor >= len(t.runes) {
		return
	}
	t.runes = append(t.runes[:t.cursor], t.runes[t.cursor+1:]...)
	t.clamp()
}

func (t *textInput) wordLeft() {
	for t.cursor > 0 && t.runes[t.cursor-1] == ' ' {
		t.cursor--
	}
	for t.cursor > 0 && t.runes[t.cursor-1] != ' ' {
		t.cursor--
	}
	t.clamp()
}

func (t *textInput) deleteWordLeft() {
	if t.cursor == 0 {
		return
	}
	t.runes = append(t.runes[:t.wordBoundary()], t.runes[t.cursor:]...)
	t.clamp()
}

// wordBoundary is where the previous word starts, so ctrl+w can drop it.
func (t *textInput) wordBoundary() int {
	at := t.cursor
	for at > 0 && t.runes[at-1] == ' ' {
		at--
	}
	for at > 0 && t.runes[at-1] != ' ' {
		at--
	}
	return at
}

// update handles one key. It reports whether the key was consumed, so the
// caller can fall through to global bindings when it was not.
func (t *textInput) update(msg tea.KeyMsg) bool {
	switch msg.Type {
	case tea.KeyRunes:
		// A pasted line arrives as many runes; taking them all is correct.
		for _, r := range msg.Runes {
			if r == '\n' || r == '\r' {
				continue
			}
			t.insert(r)
		}
		return true
	case tea.KeySpace:
		t.insert(' ')
		return true
	case tea.KeyBackspace:
		t.backspace()
		return true
	case tea.KeyDelete:
		t.deleteForward()
		return true
	case tea.KeyLeft:
		t.cursor--
		t.clamp()
		return true
	case tea.KeyRight:
		t.cursor++
		t.clamp()
		return true
	case tea.KeyHome, tea.KeyCtrlA:
		t.cursor = 0
		t.clamp()
		return true
	case tea.KeyEnd, tea.KeyCtrlE:
		t.cursor = len(t.runes)
		t.clamp()
		return true
	case tea.KeyCtrlW:
		t.deleteWordLeft()
		return true
	case tea.KeyCtrlK:
		t.runes = t.runes[:t.cursor]
		t.clamp()
		return true
	case tea.KeyCtrlU:
		keep := append([]rune{}, t.runes[t.cursor:]...)
		t.runes = keep
		t.cursor = 0
		t.offset = 0
		return true
	}
	return false
}

// view renders the line, scrolling horizontally to keep the cursor visible.
// When focused is false the prompt is dimmed, which is the only difference
// between an editable field and a read-only label.
func (t *textInput) view(prompt string, focused bool) string {
	t.clamp()
	style := theme.Muted
	if focused {
		style = theme.Text
	}
	text := string(t.runes)
	if t.width > 0 && len(t.runes) > t.width {
		visible := t.runes[t.offset:]
		if len(visible) > t.width {
			visible = visible[:t.width]
		}
		text = string(visible)
	}
	rendered := lipgloss.NewStyle().Foreground(style).Render(prompt + text)
	if focused {
		// A block cursor is legible on any terminal and needs no reverse video.
		rendered += lipgloss.NewStyle().Foreground(theme.Accent).Render(theme.Caret)
	}
	return rendered
}

// suggestions is the completion list for the command palette. Kept here so the
// palette and the slash parser agree on what exists.
var suggestions = []struct {
	Command string
	Detail  string
}{
	{"/help", "the key bindings and every command"},
	{"/scope", "add, list or remove authorised targets"},
	{"/mode", "safe, balanced or full"},
	{"/run", "run one tool by hand: /run tcp_scan targets=10.0.0.1"},
	{"/tools", "browse the tool catalogue"},
	{"/model", "pick a model and provider"},
	{"/findings", "triage what has been recorded"},
	{"/finding", "add one by hand: title|severity|asset|description"},
	{"/status", "set a finding status: /status fnd_x confirmed"},
	{"/report", "preview or export: /report html report.html"},
	{"/doctor", "configuration, tools and scope at a glance"},
	{"/clear", "empty the console"},
	{"/interrupt", "stop the agent mid-turn"},
	{"/quit", "leave PENAI"},
}

// matchingSuggestions filters by prefix, which is all the completion needs.
func matchingSuggestions(prefix string) []string {
	prefix = strings.ToLower(prefix)
	found := make([]string, 0, len(suggestions))
	for _, item := range suggestions {
		if strings.HasPrefix(item.Command, prefix) {
			found = append(found, item.Command)
		}
	}
	return found
}
