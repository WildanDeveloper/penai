package app

import (
	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/client"
)

// call performs one request and decodes the reply.
//
// Streaming methods (agent.send) are called the same way; their events arrive
// on the client's event channel while this is still blocked, which is exactly
// what the console wants.
func call[T any](core *client.Client, method string, params interface{}) (T, error) {
	var out T
	err := core.Call(method, params, &out)
	return out, err
}

// refresh is a small wrapper so views can ask for the same reload in one line.
func (s *State) reload() tea.Cmd { return s.refresh() }

// setMode changes the execution ceiling in the core.
func (s *State) setMode(mode string) tea.Cmd {
	return func() tea.Msg {
		if _, err := call[any](s.core, "session.setMode", map[string]string{"mode": mode}); err != nil {
			return coreErrorMsg{err}
		}
		return statusMsg("mode: " + mode)
	}
}

// addTarget authorises a target in the core.
func (s *State) addTarget(value, note string) tea.Cmd {
	return func() tea.Msg {
		params := map[string]string{"value": value}
		if note != "" {
			params["note"] = note
		}
		out, err := call[struct {
			Targets []target `json:"targets"`
		}](s.core, "scope.add", params)
		if err != nil {
			return coreErrorMsg{err}
		}
		return scopeMsg{Targets: out.Targets}
	}
}

// removeTarget drops a target from the core.
func (s *State) removeTarget(id string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[struct {
			Targets []target `json:"targets"`
		}](s.core, "scope.remove", map[string]string{"id": id})
		if err != nil {
			return coreErrorMsg{err}
		}
		return scopeMsg{Targets: out.Targets}
	}
}

// runTool executes one tool through the core's policy engine.
func (s *State) runTool(name string, args map[string]interface{}) tea.Cmd {
	return func() tea.Msg {
		out, err := call[toolRunMsg](s.core, "tool.run", map[string]interface{}{
			"tool": name,
			"args": args,
		})
		if err != nil {
			return coreErrorMsg{err}
		}
		return out
	}
}

// send asks the agent for one turn.
func (s *State) send(text string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[struct {
			OK       bool      `json:"ok"`
			Error    string    `json:"error"`
			Findings []finding `json:"findings"`
		}](s.core, "agent.send", map[string]string{"text": text})
		if err != nil {
			return coreErrorMsg{err}
		}
		if !out.OK {
			return coreErrorMsg{errStale{out.Error}}
		}
		return findingsMsg{Findings: out.Findings}
	}
}

// interrupt stops the agent mid-turn.
func (s *State) interrupt() tea.Cmd {
	return func() tea.Msg {
		if _, err := call[any](s.core, "agent.interrupt", nil); err != nil {
			return coreErrorMsg{err}
		}
		return statusMsg("interrupted")
	}
}

// answerConfirm replies to an approval request the core is blocked on.
func (s *State) answerConfirm(approved bool) tea.Cmd {
	return func() tea.Msg {
		if _, err := call[any](s.core, "agent.confirm", map[string]bool{"approved": approved}); err != nil {
			return coreErrorMsg{err}
		}
		return statusMsg("approval answered")
	}
}

// loadSources reads the model sources, optionally refreshing one from its
// endpoint (the `r` key in the model dialog).
func (s *State) loadSources(live bool, index int) tea.Cmd {
	return func() tea.Msg {
		params := map[string]interface{}{"live": live}
		if live {
			params["index"] = index
		}
		out, err := call[struct {
			Sources []modelSource `json:"sources"`
		}](s.core, "model.sources", params)
		if err != nil {
			return coreErrorMsg{err}
		}
		return sourcesMsg{Sources: out.Sources}
	}
}

// useModel saves the chosen provider and model.
func (s *State) useModel(source modelSource, name string) tea.Cmd {
	return func() tea.Msg {
		if _, err := call[any](s.core, "model.use", map[string]string{
			"kind":    source.Kind,
			"baseUrl": source.BaseURL,
			"apiKey":  source.APIKey,
			"model":   name,
		}); err != nil {
			return coreErrorMsg{err}
		}
		return modelChangedMsg{model: name, baseUrl: source.BaseURL}
	}
}

// previewReport renders a report without writing it.
func (s *State) previewReport(format string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[reportMsg](s.core, "report.preview", map[string]string{"format": format})
		if err != nil {
			return coreErrorMsg{err}
		}
		return out
	}
}

// exportReport renders and writes a report.
func (s *State) exportReport(format, path string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[exportMsg](s.core, "report.export", map[string]string{
			"format": format,
			"path":   path,
		})
		if err != nil {
			return coreErrorMsg{err}
		}
		return out
	}
}

// setFindingStatus triages one finding.
func (s *State) setFindingStatus(id, status string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[struct {
			Finding finding `json:"finding"`
		}](s.core, "findings.update", map[string]string{"id": id, "status": status})
		if err != nil {
			return coreErrorMsg{err}
		}
		return findingsMsg{Findings: replaceFinding(s.findings, out.Finding)}
	}
}

// addFinding records a finding the operator typed in.
func (s *State) addFinding(title, severity, asset, description string) tea.Cmd {
	return func() tea.Msg {
		out, err := call[struct {
			Finding finding `json:"finding"`
		}](s.core, "findings.add", map[string]string{
			"title":       title,
			"severity":    severity,
			"asset":       asset,
			"description": description,
		})
		if err != nil {
			return coreErrorMsg{err}
		}
		return findingsMsg{Findings: append([]finding{out.Finding}, s.findings...)}
	}
}

// replaceFinding swaps one record in place, or drops it when it is gone.
func replaceFinding(list []finding, next finding) []finding {
	for i, item := range list {
		if item.ID == next.ID {
			list[i] = next
			return list
		}
	}
	return list
}

// errStale is a rejection the core reported in its reply body rather than as a
// transport error, so it deserves a quieter presentation.
type errStale struct{ message string }

func (e errStale) Error() string { return e.message }

// nextStatus walks a finding through its triage states.
func nextStatus(current string) string {
	switch current {
	case "open":
		return "confirmed"
	case "confirmed":
		return "false_positive"
	case "false_positive":
		return "fixed"
	default:
		return "open"
	}
}
