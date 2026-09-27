package app

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// header is three rows: the identity line, a rule, and the state of the
// session.
//
// The state row is one strip of label-and-value pairs rather than a sentence, so
// it can be read in a glance and its parts cannot drift apart: the mode first
// because it decides what the agent may do, then the counts. The mode also
// appears in the status bar, but that is the one that matters when you are
// watching a run rather than reading a screen.
func (s *State) header() string {
	// The badge pads itself, so the word carries no spaces of its own: with both,
	// the header opens with two spaces before PENAI and three after it.
	brand := lipgloss.NewStyle().
		Foreground(theme.HeaderBg).
		Background(theme.Accent).
		Bold(true).
		Padding(0, 1).
		Render("PENAI")

	title := brand + " " + strong(s.session.Engagement)
	if s.session.Engagement == "" {
		title = brand + " " + muted("no engagement")
	}

	// Right side: provider and model, so it is never a surprise which model is
	// answering.
	provider := s.session.Provider.BaseURL
	if provider == "" {
		provider = "no provider"
	}
	right := muted(shortenURL(provider, 34)) + "  " + value(s.session.Provider.Model)
	if !s.session.Provider.KeyReady {
		right += "  " + bad("no key")
	}

	// The mode first, because it decides what the agent may do, then the counts.
	// One space either side of the value and a spaced dot between facts: this is
	// a single row, so a column of padding would only make it harder to scan.
	open := label(" (" + itoa(s.openFindings()) + " open)")
	facts := []string{s.modeBadge()}
	facts = append(facts, label("scope")+" "+themed(theme.Accent, itoa(len(s.scope))))
	facts = append(facts, label("findings")+" "+themed(theme.Warn, itoa(len(s.findings)))+open)
	if ready := s.availableTools(); ready > 0 {
		facts = append(facts, label("tools")+" "+themed(theme.OK, itoa(ready)))
	}

	identity := padStyled(title, max(s.width-visibleWidth(right)-2, 0)) + right
	strip := strings.Join(facts, muted(" "+theme.Bullet+" "))

	return identity + "\n" + rule(s.width, theme.Faint) + "\n" + truncateStyled(strip, s.width)
}

// itoa is strconv.Itoa, here so the chrome can build a strip without importing
// strconv for six numbers.
func itoa(n int) string { return strconv.Itoa(n) }

// modeBadge colours the execution ceiling, which is the one setting that decides
// whether the agent may act without asking. It is padded to the width of the
// longest mode name, so the strip beside it does not shift when the mode does.
func (s *State) modeBadge() string {
	text := pad(s.session.Mode, 8)
	if s.session.Mode == "" {
		text = pad("unknown", 8)
	}
	style := lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Danger).Bold(true)
	switch s.session.Mode {
	case "safe":
		style = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.OK).Bold(true)
	case "balanced":
		style = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Warn).Bold(true)
	}
	return style.Render(text)
}

// navStrip is the view switcher, on one row.
//
// Every entry is the same width: a three-column key chip, the label padded to
// the longest label in the set, and one space of air. Entries are built whole
// rather than sliced out of the full strip, because slicing a styled string by
// character count cuts through escape codes and leaves half a sequence in the
// output, which the terminal prints literally.
//
// The hint for the active view sits at the far right of the same row. It used to
// have a row of its own, which cost a line of screen for one short sentence.
func (s *State) navStrip() string {
	activeAt := 0
	items := make([]string, 0, len(model.Views))
	for i, descriptor := range model.Views {
		active := descriptor.ID == s.view
		keyStyle := lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Muted)
		nameStyle := muted
		if active {
			keyStyle = lipgloss.NewStyle().Foreground(theme.HeaderBg).Background(theme.Accent).Bold(true)
			nameStyle = strong
			activeAt = i
		}
		label := descriptor.Label
		if active && s.busy {
			label += theme.Bullet
		}
		items = append(items,
			keyStyle.Render(" "+descriptor.Key+" ")+nameStyle(label+" "))
	}

	// As many whole entries as fit, with the active one always in view. The
	// widths are measured, because a styled entry is not as long as it looks.
	used := make([]int, len(items)+1)
	for i, item := range items {
		used[i+1] = used[i] + visibleWidth(item)
	}
	room := 1
	for room < len(items) && used[room+1] <= s.width {
		room++
	}
	start := 0
	for start+room <= activeAt {
		start++
	}
	if start+room > len(items) {
		start = len(items) - room
	}
	if start < 0 {
		start = 0
	}
	strip := strings.Join(items[start:min(start+room, len(items))], "")

	hint := " " + s.currentViewDescriptor().Hint
	if gap := s.width - visibleWidth(strip) - runeLen(hint); gap > 2 {
		strip += strings.Repeat(" ", gap) + label(hint)
	}
	return padStyled(strip, s.width)
}

func (s *State) currentViewDescriptor() model.Descriptor {
	for _, descriptor := range model.Views {
		if descriptor.ID == s.view {
			return descriptor
		}
	}
	return model.Views[0]
}

// sidebar carries the state that is worth seeing from every view.
//
// Sections are emitted whole, in order of importance, and the least important
// ones are dropped when the terminal is short. Cutting the block at a fixed
// height would instead hide the top - the engagement and the provider - and
// leave the checks at the bottom, which is exactly the wrong way round.
func (s *State) sidebar() string {
	width := 26
	if s.width < 100 {
		width = 22
	}
	budget := s.contentHeight() - 1

	sections := []struct {
		heading string
		rows    []string
	}{
		{"SESSION", []string{
			kv("engagement", s.session.Engagement, width),
			kv("tester", s.session.Tester, width),
			kv("data", s.session.DataDir, width),
		}},
		{"PROVIDER", s.providerRows(width)},
		{"SCOPE", s.scopeRows(width)},
		{"FINDINGS", s.findingRows(width)},
		{"EXTERNAL", s.externalRows(width)},
		{"CHECKS", s.checkRows(width)},
	}

	lines := make([]string, 0, budget)
	for _, section := range sections {
		block := append([]string{strong(pad(section.heading, width))}, section.rows...)
		// The +1 is the blank line that separates this section from the last.
		if len(lines) > 0 && len(lines)+1+len(block) > budget {
			break
		}
		if len(lines) > 0 {
			lines = append(lines, "")
		}
		lines = append(lines, block...)
	}
	return joinLines(lines)
}

// providerRows is the provider block of the sidebar.
func (s *State) providerRows(width int) []string {
	key := good("set")
	switch {
	case !s.session.Provider.KeyReady:
		key = bad("missing")
	case s.session.Provider.Anonymous:
		key = good("No Key Needed")
	}
	return []string{
		kv("kind", s.session.Provider.Kind, width),
		kv("endpoint", s.session.Provider.BaseURL, width),
		kv("model", s.session.Provider.Model, width),
		label(pad("api key", 11)) + key,
	}
}

// scopeRows is the authorised scope block.
func (s *State) scopeRows(width int) []string {
	if len(s.scope) == 0 {
		return []string{bad(clip("empty - nothing testable", width))}
	}
	rows := make([]string, 0, 6)
	shown := s.scope
	if len(shown) > 5 {
		shown = shown[:5]
	}
	for _, target := range shown {
		rows = append(rows, themed(theme.Accent, pad(target.Kind, 6))+clip(target.Value, width-6))
	}
	if len(s.scope) > len(shown) {
		rows = append(rows, muted(fmt.Sprintf("+%d more", len(s.scope)-len(shown))))
	}
	return rows
}

// findingRows is the triage summary.
func (s *State) findingRows(width int) []string {
	rows := []string{truncateStyled(s.severityBreakdown(width), width)}
	if open := s.openFindings(); open > 0 {
		rows = append(rows, label(fmt.Sprintf("%d open", open)))
	}
	return rows
}

// externalRows reports which external binaries were found.
func (s *State) externalRows(width int) []string {
	ready := s.availableTools()
	if ready == 0 {
		return []string{muted("none found on PATH")}
	}
	return []string{
		good(fmt.Sprintf("%d available", ready)),
		muted(fmt.Sprintf("%d missing", len(s.tooling)-ready)),
	}
}

// checkRows is the configuration the core reported. These are the first thing
// anyone needs when a tool refuses to run, which is why they are the last
// section to be dropped.
//
// The colours come from an explicit list of faults rather than from guessing at
// words. A substring rule painted "no key needed" red, which told the operator
// something was wrong at the exact moment the tool was working perfectly: the
// free tier needs no key, and that is the good news.
func (s *State) checkRows(width int) []string {
	rows := make([]string, 0, len(s.diagnoses))
	for _, line := range s.diagnoses {
		text := strings.TrimSpace(line)
		rows = append(rows, checkStyle(text)(truncateStyled(text, width)))
	}
	return rows
}

// faultWords are the things in a check line that mean something is actually
// wrong. Anything else is either good or simply informational.
var faultWords = []string{"missing", "disabled", "not found", "failed", "error", "refused"}

// goodWords are the lines that report something working. "No Key Needed" is in
// here because the free tier needs no credential, and that is the good case:
// painting it as a fault told the operator something was broken at the exact
// moment the tool was working.
var goodWords = []string{"set", "ok", "no key needed"}

// checkStyle picks the colour for one check line.
func checkStyle(text string) func(string) string {
	lower := strings.ToLower(text)
	for _, word := range faultWords {
		if strings.Contains(lower, word) {
			return bad
		}
	}
	for _, word := range goodWords {
		if strings.Contains(lower, word) {
			return good
		}
	}
	return muted
}

// severityBreakdown is a one-line histogram of the findings by severity.
func (s *State) severityBreakdown(width int) string {
	order := []string{"critical", "high", "medium", "low", "info"}
	counts := map[string]int{}
	for _, item := range s.findings {
		counts[item.Severity]++
	}
	parts := make([]string, 0, len(order))
	for _, name := range order {
		if counts[name] == 0 {
			continue
		}
		parts = append(parts, themed(theme.Severity(name), fmt.Sprintf("%s %d", name[:1], counts[name])))
	}
	if len(parts) == 0 {
		return muted("nothing recorded")
	}
	return truncateStyled(strings.Join(parts, " "), width)
}

// prompt is the console's input line, or a hint of what to type elsewhere.
func (s *State) prompt() string {
	switch s.view {
	case model.ViewConsole:
		marker := themed(theme.Accent, "› ")
		if s.busy {
			marker = s.spinner() + " "
		}
		return marker + s.input.view("", true)
	case model.ViewScout:
		if s.scoutFocus {
			return themed(theme.Accent, "args › ") + s.scoutArgs.view("", true)
		}
		return muted("enter to type arguments, ctrl+r to run, esc for the console")
	case model.ViewScope:
		if s.scopeFocus {
			return themed(theme.Accent, "target › ") + s.scopeDraft.view("", true)
		}
		return muted("enter to add a target, backspace to remove, m to change mode")
	case model.ViewFindings:
		return muted(fmt.Sprintf("filter: %s   enter cycles status   d false positive   f fixed", s.filter))
	case model.ViewReport:
		return muted("m/h/s/j change format   w writes the report   page up and down scroll")
	case model.ViewAudit:
		return muted("every allow and deny decision, newest first")
	}
	return ""
}

// statusBar is the last row: what is happening, and the two settings that
// change what the agent is allowed to do.
//
// A warning takes the left slot while it is alive, so nothing is ever drawn on
// top of the view.
func (s *State) statusBar() string {
	left := s.status
	if left == "" {
		left = "ready"
	}
	// A turn in progress is worth saying so from any view, and saying where the
	// output is: the reason somebody concludes "there is no output" is that the
	// console is not the tab they happen to be looking at.
	if s.busy && s.view != model.ViewConsole {
		left = s.status + "  -  the output is on tab 1"
	}
	styled := clip(left, s.width/2)
	switch {
	case s.flash != "":
		styled = themed(theme.Danger, s.flash)
	case s.busy:
		styled = s.spinner() + " " + styled
	}
	scroll := ""
	if s.scroll > 0 {
		scroll = label(fmt.Sprintf("  +%d", s.scroll))
	}

	right := s.modeBadge() + "  " + clip(s.session.Provider.Model, 24)
	if s.width < 60 {
		right = s.modeBadge()
	}
	prefix := s.promptGlyph()
	return padStyled(prefix+styled+scroll, s.width-visibleWidth(right)) + right
}

// promptGlyph marks which view owns the keyboard.
func (s *State) promptGlyph() string {
	name := s.currentViewDescriptor().Label
	return lipgloss.NewStyle().Foreground(theme.Accent).Render(" " + pad(name, 10))
}

// shortenURL trims a base URL down to the part that identifies it.
func shortenURL(url string, width int) string {
	trimmed := strings.TrimPrefix(strings.TrimPrefix(url, "https://"), "http://")
	return clip(trimmed, width)
}
