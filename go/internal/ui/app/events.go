package app

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/protocol"
	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// showToolRun reports the outcome of a manual run, in the console and in the
// scout pane at the same time.
//
// A refusal is reported as a refusal rather than as a failure: the policy
// engine stopped it on purpose, and the operator needs the reason it gave.
func (s *State) showToolRun(run toolRun) {
	if !run.Allowed {
		s.scoutOutput = []string{themed(theme.Danger, run.Reason)}
		s.note(model.KindNotice, "%s: %s (%s) - %s", run.Tool, run.Action, run.Risk, run.Reason)
		return
	}

	s.scoutOutput = splitLines(run.Evidence)
	switch {
	case run.OK:
		s.note(model.KindResult, "%s: %s", run.Tool, run.Summary)
	case run.Error != "":
		s.note(model.KindError, "%s failed: %s", run.Tool, run.Error)
		s.scoutOutput = []string{themed(theme.Danger, run.Error)}
	default:
		s.note(model.KindError, "%s failed: %s", run.Tool, run.Summary)
	}
	if run.Command != "" {
		s.note(model.KindCommand, "%s", run.Command)
	}
	// The evidence is what the run is for, so it goes into the log too.
	for _, line := range splitLines(run.Evidence) {
		s.lines = append(s.lines, model.Line{Kind: model.KindTool, Text: line})
	}
	s.trimLog()
	if s.follow {
		s.scroll = 0
	}
}

// handleEvent folds one core notification into the console.
//
// Streaming turns arrive as a burst of small events, so every case here is
// cheap: append a line, set a status, and let the renderer do the rest.
func (s *State) handleEvent(event protocol.Event) (tea.Model, tea.Cmd) {
	switch event.Event {
	case "agent.token":
		var data struct {
			Token string `json:"token"`
		}
		if decode(event.Data, &data) {
			s.streaming.WriteString(data.Token)
			s.status = "replying"
		}

	case "agent.done":
		var data struct {
			Text string `json:"text"`
		}
		if decode(event.Data, &data) {
			text := data.Text
			if strings.TrimSpace(text) == "" {
				text = s.streaming.String()
			}
			for _, line := range splitLines(text) {
				s.lines = append(s.lines, model.Line{Kind: model.KindAssistant, Text: line})
			}
			s.streaming.Reset()
			s.busy = false
			s.status = "ready"
		}
		return s, nil

	case "agent.tool":
		var data struct {
			Phase   string                 `json:"phase"`
			Tool    string                 `json:"tool"`
			Args    map[string]interface{} `json:"args"`
			Command string                 `json:"command"`
			Text    string                 `json:"text"`
			OK      bool                   `json:"ok"`
			Summary string                 `json:"summary"`
		}
		if decode(event.Data, &data) {
			switch data.Phase {
			case "start":
				s.lastToolName = data.Tool
				s.status = "running " + data.Tool
				if data.Command != "" {
					s.note(model.KindCommand, "%s", data.Command)
				} else {
					s.note(model.KindCommand, "%s %s", data.Tool, describeArgs(data.Args))
				}
			case "output":
				for _, line := range splitLines(data.Text) {
					s.lines = append(s.lines, model.Line{Kind: model.KindTool, Text: line})
				}
			case "end":
				if data.OK {
					s.note(model.KindResult, "%s: %s", data.Tool, data.Summary)
				} else {
					s.note(model.KindError, "%s failed: %s", data.Tool, data.Summary)
				}
			}
			s.trimLog()
			if s.follow {
				s.scroll = 0
			}
		}

	case "agent.notice":
		var data struct {
			Message string `json:"message"`
		}
		if decode(event.Data, &data) {
			s.note(model.KindNotice, "%s", data.Message)
		}

	case "agent.status":
		var data struct {
			Message string `json:"message"`
		}
		if decode(event.Data, &data) && data.Message != "" {
			s.status = data.Message
		}

	case "agent.error":
		var data struct {
			Message string `json:"message"`
		}
		if decode(event.Data, &data) {
			s.busy = false
			s.status = "idle"
			s.warn("%s", data.Message)
		}

	case "agent.confirm":
		var data struct {
			Request protocol.ConfirmRequest `json:"request"`
		}
		if decode(event.Data, &data) {
			if data.Request.Tool != "" {
				s.lastToolName = data.Request.Tool
			}
			s.confirm = &data.Request
		}
		return s, nil

	case "finding.created":
		var created finding
		if decode(event.Data, &created) && created.ID != "" {
			s.findings = append([]finding{created}, s.findings...)
			s.note(model.KindResult, "finding [%s] %s  (%s)", created.Severity, created.Title, created.ID)
		}

	case "tool.decision":
		var data struct {
			Tool   string `json:"tool"`
			Action string `json:"action"`
			Risk   string `json:"risk"`
			Reason string `json:"reason"`
		}
		if decode(event.Data, &data) {
			s.note(model.KindNotice, "%s: %s (%s) - %s", data.Tool, data.Action, data.Risk, data.Reason)
		}

	case "tool.output":
		var data struct {
			Tool string `json:"tool"`
			Text string `json:"text"`
		}
		if decode(event.Data, &data) {
			for _, line := range splitLines(data.Text) {
				s.lines = append(s.lines, model.Line{Kind: model.KindTool, Text: line})
			}
			s.trimLog()
			if s.follow {
				s.scroll = 0
			}
		}
	}
	return s, nil
}

// decode turns an event's data into a typed struct, tolerating anything the
// core sends that this build does not know about.
func decode(data interface{}, out interface{}) bool {
	raw, err := json.Marshal(data)
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, out) == nil
}

// splitLines breaks tool output into console rows, dropping a trailing blank.
func splitLines(text string) []string {
	if text == "" {
		return nil
	}
	lines := []string{}
	start := 0
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			lines = append(lines, trimRight(text[start:i]))
			start = i + 1
		}
	}
	if start < len(text) {
		lines = append(lines, trimRight(text[start:]))
	}
	return lines
}

func trimRight(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\r' || s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

// describeArgs renders a tool call's arguments for the console.
func describeArgs(args map[string]interface{}) string {
	if len(args) == 0 {
		return ""
	}
	parts := make([]string, 0, len(args))
	for key, value := range args {
		if items, ok := value.([]interface{}); ok {
			texts := make([]string, 0, len(items))
			for _, item := range items {
				texts = append(texts, toText(item))
			}
			parts = append(parts, key+"="+strings.Join(texts, ","))
			continue
		}
		parts = append(parts, key+"="+toText(value))
	}
	sort.Strings(parts)
	return strings.Join(parts, " ")
}

func toText(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(raw)
	}
}
