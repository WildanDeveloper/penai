package app

import (
	"penai/internal/protocol"
)

// loadedMsg carries the first (or a refreshed) view of the session.
type loadedMsg struct {
	session protocol.Session
	tools   []protocol.Tool
}

// coreEventMsg is a notification from the core: a model token, tool output, a
// new finding, an approval request.
type coreEventMsg protocol.Event

// coreErrorMsg is a transport-level failure that ended the connection.
type coreErrorMsg struct{ err error }

// toolRunMsg is the reply to tool.run.
type toolRunMsg = toolRun

// findingsMsg replaces the findings list after a mutation.
//
// Every field decoded from JSON is exported and tagged. An unexported field
// cannot be set by encoding/json at all, and that fails silently: the message
// arrives, and every field in it is zero.
type findingsMsg struct {
	Findings []protocol.Finding `json:"findings"`
}

// scopeMsg replaces the scope list after a mutation.
type scopeMsg struct {
	Targets []protocol.Target `json:"targets"`
}

// sourcesMsg is the reply to model.sources.
type sourcesMsg struct {
	Sources []protocol.ModelSource `json:"sources"`
}

// reportMsg is a rendered report preview.
type reportMsg struct {
	Format string `json:"format"`
	Body   string `json:"body"`
}

// exportMsg is the outcome of writing a report to disk.
type exportMsg struct {
	Path     string `json:"path"`
	Format   string `json:"format"`
	Bytes    int    `json:"bytes"`
	Findings int    `json:"findings"`
}

// statusMsg sets the status line without a flash.
type statusMsg string

// flashExpiredMsg retires a status bar warning that has been shown long enough.
type flashExpiredMsg struct{}

// modelChangedMsg says the core accepted a new provider. The client has to read
// the session again: the header and the sidebar show the provider from the
// session, so without this the screen keeps naming the old model and the change
// only becomes visible after a restart.
type modelChangedMsg struct {
	model   string
	baseUrl string
}

// Local aliases, so the call sites in this package read as the client does
// rather than repeating the protocol package name on every decode.
type (
	target      = protocol.Target
	finding     = protocol.Finding
	modelSource = protocol.ModelSource
	auditEntry  = protocol.AuditEntry
	toolRun     = protocol.ToolRun
)
