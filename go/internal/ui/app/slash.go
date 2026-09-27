package app

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/ui/model"
)

// runSlash executes a command that started with a slash.
//
// Anything not recognised here is reported rather than guessed at, so a typo
// in a command never silently does nothing.
func (s *State) runSlash(text string) (tea.Model, tea.Cmd) {
	fields := strings.Fields(text)
	command := strings.ToLower(fields[0])
	rest := strings.TrimSpace(strings.TrimPrefix(text, fields[0]))
	var cmds []tea.Cmd

	switch command {
	case "/help", "/?":
		s.openHelp()
		return s, nil

	case "/clear":
		s.lines = nil
		s.streaming.Reset()
		s.scroll = 0
		return s, nil

	case "/quit", "/exit":
		return s, tea.Quit

	case "/scope":
		return s.scopeCommand(rest)

	case "/mode":
		if rest == "" {
			s.note(model.KindNotice, "mode is %s (auto-runs up to its risk ceiling)", s.session.Mode)
			return s, nil
		}
		switch strings.ToLower(rest) {
		case "safe", "balanced", "full":
			return s, s.setMode(strings.ToLower(rest))
		default:
			s.note(model.KindError, "unknown mode %q: safe, balanced or full", rest)
			return s, nil
		}

	case "/tools":
		s.view = model.ViewScout
		return s, nil

	case "/findings":
		s.view = model.ViewFindings
		return s, nil

	case "/report":
		return s.reportCommand(rest)

	case "/audit":
		s.view = model.ViewAudit
		return s, nil

	case "/model":
		// The command returns the command that fetches the sources. Dropping it
		// opens an empty dialog, which reads as "nothing happened".
		cmds = append(cmds, s.openModel())

	case "/run":
		if rest == "" {
			s.view = model.ViewScout
			s.note(model.KindNotice, "usage: /run <tool> key=value  (the catalogue is open in the Scout tab)")
			return s, nil
		}
		parts := strings.SplitN(rest, " ", 2)
		name := parts[0]
		argText := ""
		if len(parts) > 1 {
			argText = parts[1]
		}
		args, err := parseArgs(argText)
		if err != nil {
			s.note(model.KindError, "%s", err.Error())
			return s, nil
		}
		s.lastToolName = name
		s.note(model.KindCommand, "%s %s", name, describeArgs(args))
		cmds = append(cmds, s.runTool(name, args))

	case "/finding":
		return s.findingCommand(rest)

	case "/status":
		fields := strings.Fields(rest)
		if len(fields) < 2 {
			s.note(model.KindError, "usage: /status <finding-id> <open|confirmed|false_positive|fixed>")
			return s, nil
		}
		cmds = append(cmds, s.setFindingStatus(fields[0], strings.ToLower(fields[1])))

	case "/doctor":
		s.view = model.ViewScope
		if len(s.diagnoses) > 0 {
			for _, line := range s.diagnoses {
				s.note(model.KindNotice, "%s", line)
			}
		}
		return s, nil

	case "/interrupt":
		cmds = append(cmds, s.interrupt())

	default:
		s.note(model.KindError, "unknown command %q. Press ? for the list.", command)
	}
	return s, tea.Batch(cmds...)
}

// scopeCommand handles adding, listing and removing authorised targets.
func (s *State) scopeCommand(rest string) (tea.Model, tea.Cmd) {
	parts := splitArgs(rest)
	if len(parts) == 0 {
		if len(s.scope) == 0 {
			s.note(model.KindNotice, "the scope is empty. Add one: /scope add 10.16.0.0/28")
			return s, nil
		}
		for _, target := range s.scope {
			s.note(model.KindNotice, "%s  [%s] %s", target.ID, target.Kind, target.Value)
		}
		return s, nil
	}

	action := strings.ToLower(parts[0])
	switch action {
	case "add":
		if len(parts) < 2 {
			s.note(model.KindError, "usage: /scope add <ip|cidr|host|url> [note]")
			return s, nil
		}
		value := parts[1]
		note := strings.Join(parts[2:], " ")
		s.note(model.KindCommand, "/scope add %s", value)
		return s, s.addTarget(value, note)

	case "rm", "remove":
		if len(parts) < 2 {
			s.note(model.KindError, "usage: /scope rm <target-id>")
			return s, nil
		}
		return s, s.removeTarget(parts[1])

	case "list", "ls":
		return s.scopeCommand("")

	default:
		// "/scope 10.0.0.1" is a shortcut for add, because that is what
		// almost every first command is.
		return s.scopeCommand("add " + rest)
	}
}

// reportCommand previews or exports the report.
func (s *State) reportCommand(rest string) (tea.Model, tea.Cmd) {
	parts := splitArgs(rest)
	format := s.reportForm
	path := ""
	if len(parts) > 0 {
		switch strings.ToLower(parts[0]) {
		case "markdown", "md", "html", "sarif", "json":
			format = strings.ToLower(parts[0])
			if format == "md" {
				format = "markdown"
			}
			parts = parts[1:]
		}
	}
	if len(parts) > 0 {
		path = strings.Join(parts, " ")
	}
	s.view = model.ViewReport
	s.reportForm = format
	if path != "" {
		return s, s.exportReport(format, path)
	}
	return s, s.previewReport(format)
}

// findingCommand records a finding by hand. The shorthand is
// "title|severity|asset|description", which is what a report needs.
func (s *State) findingCommand(rest string) (tea.Model, tea.Cmd) {
	if rest == "" {
		s.note(model.KindError, "usage: /finding <title>|<severity>|<asset>|<description>")
		return s, nil
	}
	parts := strings.Split(rest, "|")
	title := strings.TrimSpace(parts[0])
	if title == "" {
		s.note(model.KindError, "a finding needs a title")
		return s, nil
	}
	severity := "medium"
	asset := "unspecified"
	description := ""
	if len(parts) > 1 && strings.TrimSpace(parts[1]) != "" {
		severity = normalizeSeverity(strings.TrimSpace(parts[1]))
	}
	if len(parts) > 2 && strings.TrimSpace(parts[2]) != "" {
		asset = strings.TrimSpace(parts[2])
	}
	if len(parts) > 3 {
		description = strings.TrimSpace(strings.Join(parts[3:], "|"))
	}
	return s, s.addFinding(title, severity, asset, description)
}

// normalizeSeverity keeps the core's vocabulary, whatever was typed.
func normalizeSeverity(value string) string {
	switch strings.ToLower(value) {
	case "critical", "high", "medium", "low", "info":
		return strings.ToLower(value)
	default:
		return "medium"
	}
}

// helpText is what the help dialog shows; it is also the reference for the
// shortcuts, so the two can never drift apart.
func helpText() string {
	rows := [][2]string{
		{"1 .. 6", "jump to console, scout, findings, scope, report, audit"},
		{"tab / shift+tab", "cycle views"},
		{"ctrl+p", "the model dialog"},
		{"ctrl+k or ?", "this help"},
		{"/", "list the commands; enter runs, tab completes"},
		{"ctrl+g", "start a command"},
		{"ctrl+l", "clear the console"},
		{"enter", "send the prompt / run the selection"},
		{"esc", "close a dialog, or clear the prompt"},
		{"page up / down", "scroll the console"},
		{"ctrl+c", "quit"},
	}
	lines := make([]string, 0, len(rows)+len(suggestions))
	for _, row := range rows {
		lines = append(lines, fmt.Sprintf("%-16s %s", row[0], row[1]))
	}
	lines = append(lines, "", "commands")
	for _, item := range suggestions {
		lines = append(lines, fmt.Sprintf("%-16s %s", item.Command, item.Detail))
	}
	return strings.Join(lines, "\n")
}
