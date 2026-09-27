// Package model is the TUI's own state: what is on screen and what the operator
// is doing right now.
package model

import (
	"penai/internal/protocol"
)

// View identifies an active panel.
type View int

// The six panels, in navigation order.
const (
	ViewConsole View = iota
	ViewScout
	ViewFindings
	ViewScope
	ViewReport
	ViewAudit
)

// Descriptor names a view for the navigation strip.
type Descriptor struct {
	ID    View
	Key   string
	Label string
	Hint  string
}

// Views is the navigation order, matching the digit keys.
var Views = []Descriptor{
	{ViewConsole, "1", "Console", "talk to the AI, watch it work"},
	{ViewScout, "2", "Scout", "run one tool by hand"},
	{ViewFindings, "3", "Findings", "triage recorded findings"},
	{ViewScope, "4", "Scope", "authorise targets, set mode"},
	{ViewReport, "5", "Report", "preview and export"},
	{ViewAudit, "6", "Audit", "every decision that was made"},
}

// Label returns the display name of a view.
func (v View) Label() string {
	for _, d := range Views {
		if d.ID == v {
			return d.Label
		}
	}
	return "?"
}

// LineKind marks how a transcript line should be coloured.
type LineKind int

// The kinds of line the console can hold.
const (
	KindHelp LineKind = iota
	KindUser
	KindAssistant
	KindNotice
	KindCommand
	KindTool
	KindResult
	KindError
)

// Line is one row of the console log.
type Line struct {
	Kind LineKind
	Text string
}

// ModalKind identifies which dialog is on top, if any.
type ModalKind int

// The dialogs.
const (
	ModalNone ModalKind = iota
	ModalHelp
	ModalPalette
	ModalModel
	ModalConfirm
)

// ModelSource is a re-export so views do not import the protocol package for one type.
type ModelSource = protocol.ModelSource

// Tool is a re-export for the same reason.
type Tool = protocol.Tool

// Finding is a re-export for the same reason.
type Finding = protocol.Finding

// AuditEntry is a re-export for the same reason.
type AuditEntry = protocol.AuditEntry
