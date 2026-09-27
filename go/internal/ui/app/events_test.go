package app

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/protocol"
	"penai/internal/ui/model"
)

// TestEveryEventRearmsThePump is a regression test for the worst kind of client
// bug: one that looks fine until the second message. The event reader is a
// command, so if handling an event does not hand back a fresh one the client
// goes quiet and the operator just sees the agent stop working.
func TestEveryEventRearmsThePump(t *testing.T) {
	events := []protocol.Event{
		{Event: "agent.status", Data: map[string]string{"message": "thinking"}},
		{Event: "agent.token", Data: map[string]string{"token": "hello"}},
		{Event: "agent.tool", Data: map[string]interface{}{"phase": "start", "tool": "tcp_scan", "command": "tcp_scan 10.0.0.1"}},
		{Event: "agent.tool", Data: map[string]interface{}{"phase": "end", "tool": "tcp_scan", "ok": true, "summary": "1 open port"}},
		{Event: "agent.done", Data: map[string]string{"text": "done"}},
		{Event: "finding.created", Data: protocol.Finding{ID: "fnd_1", Title: "Something", Severity: "low"}},
		{Event: "agent.notice", Data: map[string]string{"message": "out of scope, refused"}},
	}

	s := populated(120, 30)
	for i, event := range events {
		_, cmd := s.update(coreEventMsg(event))
		if cmd == nil {
			t.Fatalf("event %d (%s) returned no command, so the event pump stops there", i, event.Event)
		}
	}
}

// TestStreamingReplyIsShownWhileItArrives checks the reply is visible before it
// is complete, which is the whole point of streaming.
func TestStreamingReplyIsShownWhileItArrives(t *testing.T) {
	s := populated(120, 30)
	_, _ = s.update(coreEventMsg(protocol.Event{
		Event: "agent.token",
		Data:  map[string]string{"token": "the surface is three hosts and one app"},
	}))
	if s.streaming.String() == "" {
		t.Fatal("a token did not reach the streaming buffer")
	}
	view := stripANSI(s.consoleView())
	if !contains(view, "the surface is three hosts") {
		t.Errorf("the partial reply is not on screen:\n%s", view)
	}
	if s.busy {
		t.Error("the client should still be busy until the turn ends")
	}

	_, _ = s.update(coreEventMsg(protocol.Event{
		Event: "agent.done",
		Data:  map[string]string{"text": "the surface is three hosts and one app"},
	}))
	if s.busy {
		t.Error("the turn is over, the client should not be busy")
	}
	if !contains(stripANSI(s.consoleView()), "the surface is three hosts") {
		t.Error("the finished reply is not in the log")
	}
}

// TestApprovalRequestStopsEverythingElse checks an approval outranks the prompt:
// the core is blocked, so typing must not look like it did something.
func TestApprovalRequestStopsEverythingElse(t *testing.T) {
	s := populated(120, 30)
	_, _ = s.update(coreEventMsg(protocol.Event{
		Event: "agent.confirm",
		Data: map[string]interface{}{
			"request": protocol.ConfirmRequest{
				Tool:    "dir_fuzz",
				Command: "dir_fuzz http://127.0.0.1:8099",
				Reason:  "medium risk exceeds balanced mode ceiling (low)",
				Risk:    "medium",
			},
		},
	}))
	if s.confirm == nil {
		t.Fatal("the approval dialog did not open")
	}
	// A digit would normally switch views; it must not while a human is needed.
	next, _ := s.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'2'}})
	if next.(*State).view != model.ViewConsole {
		t.Error("keys should not change the view while an approval is pending")
	}
	if !contains(stripANSI(next.(*State).View()), "APPROVAL NEEDED") {
		t.Error("the approval dialog is not on screen")
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
