package app

import (
	"strings"
	"testing"

	"penai/internal/protocol"
	"penai/internal/ui/model"
)

// TestFindingsColumnsLineUp guards a table: the title column has to be padded
// to its width or the asset column runs into it. Padding a styled string with a
// rune count silently does nothing, so this is worth a test.
func TestFindingsColumnsLineUp(t *testing.T) {
	s := populated(120, 30)
	s.view = model.ViewFindings
	s.findings = []protocol.Finding{
		{ID: "fnd_1", Title: "Environment file exposed over HTTP", Severity: "high", Status: "open", Asset: "http://127.0.0.1:8099/.env"},
		{ID: "fnd_2", Title: "Short", Severity: "low", Status: "open", Asset: "short-asset"},
	}
	s.findIndex = 0

	rows := strings.Split(stripANSI(s.findingsView()), "\n")
	// The header names the columns; every finding row must start under it.
	if !strings.Contains(rows[1], "asset") {
		t.Fatalf("no header row: %q", rows[1])
	}
	for _, row := range rows[3:5] {
		at := strings.Index(row, "http://127.0.0.1:8099/.env")
		if at < 0 {
			continue
		}
		before := row[:at]
		if !strings.HasSuffix(before, "  ") {
			t.Errorf("the asset column is not separated from the title: %q", row)
		}
	}
}

// TestScopeRowsLineUp covers the same table problem in the scope view.
func TestScopeRowsLineUp(t *testing.T) {
	s := populated(120, 30)
	s.view = model.ViewScope
	rows := strings.Split(stripANSI(s.scopeView()), "\n")
	joined := strings.Join(rows, "\n")
	if !strings.Contains(joined, "10.16.0.0/28") {
		t.Errorf("the scope view lost a target:\n%s", joined)
	}
	if !strings.Contains(joined, "https://staging.example.test") {
		t.Errorf("the scope view lost a url target:\n%s", joined)
	}
}

// TestAuditViewShowsTheCommand is the reason the audit view exists: the command
// the engine would have run is the evidence, so it must be on screen.
func TestAuditViewShowsTheCommand(t *testing.T) {
	s := populated(120, 30)
	s.view = model.ViewAudit
	joined := stripANSI(s.auditView())
	if !strings.Contains(joined, "tcp_scan 10.99.0.0/24") {
		t.Errorf("the denied command is not shown:\n%s", joined)
	}
	if !strings.Contains(joined, "denied 1") {
		t.Errorf("the decision summary is missing:\n%s", joined)
	}
}

// TestAuditPairsEachDecisionWithItsCommand: the newest entry sits at the bottom,
// where the scroll offset starts, and its command has to travel with it. A
// reversed flat list separates the two and makes the log unreadable.
func TestAuditPairsEachDecisionWithItsCommand(t *testing.T) {
	s := populated(120, 30)
	s.view = model.ViewAudit
	rows := strings.Split(stripANSI(s.auditView()), "\n")

	deniedAt := -1
	for i, row := range rows {
		if strings.Contains(row, "denied") && strings.Contains(row, "tcp_scan") {
			deniedAt = i
		}
	}
	if deniedAt < 0 {
		t.Fatalf("the denied decision is missing:\n%s", strings.Join(rows, "\n"))
	}
	if deniedAt+1 >= len(rows) || !contains(rows[deniedAt+1], "tcp_scan 10.99.0.0/24") {
		t.Errorf("the command is not on the line below its decision:\n%s", strings.Join(rows, "\n"))
	}
}

// TestSidebarDropsWholeSections: on a short terminal the sidebar loses sections,
// and it must lose the least important ones rather than being cut at a fixed
// height, which would hide the engagement and the provider and leave the checks
// at the top.
func TestSidebarDropsWholeSections(t *testing.T) {
	short := stripANSI(populated(80, 24).sidebar())
	if !contains(short, "SESSION") || !contains(short, "PROVIDER") {
		t.Errorf("a short sidebar must keep the essentials:\n%s", short)
	}
	for _, dropped := range []string{"CHECKS", "EXTERNAL"} {
		if contains(short, dropped) {
			t.Errorf("%q should have been dropped on a 24 row terminal:\n%s", dropped, short)
		}
	}

	tall := stripANSI(populated(80, 44).sidebar())
	for _, want := range []string{"SESSION", "PROVIDER", "SCOPE", "FINDINGS", "EXTERNAL", "CHECKS"} {
		if !contains(tall, want) {
			t.Errorf("a tall sidebar should have %q:\n%s", want, tall)
		}
	}
}

// TestScoutAlwaysShowsTheLastRun is a regression test for the bug that made the
// client look broken on an ordinary terminal: at 80x24 the scout view overflowed
// its budget and was clipped at the end, so the result of the run the operator
// had just started never appeared.
func TestScoutAlwaysShowsTheLastRun(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {100, 30}, {60, 14}, {130, 40}, {200, 60}} {
		s := populated(size[0], size[1])
		s.view = model.ViewScout
		s.scoutIndex = 0
		s.scoutOutput = []string{
			"127.0.0.1:8099 open",
			"127.0.0.1:22 closed",
		}
		view := stripANSI(s.scoutView())
		if !contains(view, "LAST RUN") {
			t.Errorf("%dx%d: the result of the run is missing:\n%s", size[0], size[1], view)
		}
		if !contains(view, "127.0.0.1:8099 open") {
			t.Errorf("%dx%d: the evidence is missing:\n%s", size[0], size[1], view)
		}
		// The selected tool still has to be on screen: the footer must not
		// squeeze the list out entirely.
		if !contains(view, "tcp_scan") {
			t.Errorf("%dx%d: the tool list is gone:\n%s", size[0], size[1], view)
		}
	}
}
