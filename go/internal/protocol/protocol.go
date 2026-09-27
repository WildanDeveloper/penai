// Package protocol mirrors the core's JSON-RPC surface.
//
// Kept as a separate package so the wire format has exactly one definition on
// each side of the boundary, and a change on either side is a compile error
// rather than a runtime surprise.
package protocol

import "encoding/json"

// Request is a single call from the client to the core.
type Request struct {
	ID     int         `json:"id"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

// Response is a single reply. Exactly one of Result or Error is set.
type Response struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *RPCError       `json:"error,omitempty"`
}

// Event is an unsolicited notification emitted while a long call runs, so the
// TUI can stream model tokens and tool output while waiting for the reply.
type Event struct {
	ID    int         `json:"id,omitempty"`
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// RPCError is a failure reported by the core.
type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Session is the state the TUI renders on start.
type Session struct {
	Engagement string       `json:"engagement"`
	Tester     string       `json:"tester"`
	Mode       string       `json:"mode"`
	Provider   Provider     `json:"provider"`
	Scope      []Target     `json:"scope"`
	Findings   []Finding    `json:"findings"`
	Audit      []AuditEntry `json:"audit"`
	Runs       []Run        `json:"runs"`
	Tools      []ToolStatus `json:"tools"`
	DataDir    string       `json:"dataDir"`
	Diagnoses  []string     `json:"diagnostics"`
}

// Provider describes where the model lives, without exposing the key.
type Provider struct {
	Kind     string `json:"kind"`
	BaseURL  string `json:"baseUrl"`
	Model    string `json:"model"`
	KeyReady bool   `json:"keyReady"`
	// Anonymous is true on an endpoint that serves models with no credential at
	// all, so "ready" there does not mean a key was found.
	Anonymous bool `json:"anonymous"`
}

// Target is an authorised asset.
type Target struct {
	ID    string `json:"id"`
	Value string `json:"value"`
	Kind  string `json:"kind"`
	Note  string `json:"note,omitempty"`
}

// Finding is a recorded result.
type Finding struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Severity     string `json:"severity"`
	Asset        string `json:"asset"`
	Description  string `json:"description"`
	Evidence     string `json:"evidence"`
	Reproduction string `json:"reproduction"`
	Remediation  string `json:"remediation"`
	CWE          string `json:"cwe,omitempty"`
	Status       string `json:"status"`
	Source       string `json:"source"`
	CreatedAt    string `json:"createdAt"`
}

// AuditEntry is one allow/deny decision.
type AuditEntry struct {
	ID       string `json:"id"`
	At       string `json:"at"`
	Actor    string `json:"actor"`
	Tool     string `json:"tool"`
	Command  string `json:"command"`
	Decision string `json:"decision"`
	Risk     string `json:"risk"`
	Reason   string `json:"reason"`
}

// Run is one tool execution with its evidence.
type Run struct {
	ID      string `json:"id"`
	At      string `json:"at"`
	Tool    string `json:"tool"`
	OK      bool   `json:"ok"`
	Summary string `json:"summary"`
}

// ToolStatus reports whether an external binary was found.
type ToolStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
}

// ArgSpec is one argument in a tool's schema.
type ArgSpec struct {
	Name        string      `json:"name"`
	Type        string      `json:"type"`
	Description string      `json:"description"`
	Required    bool        `json:"required"`
	Default     interface{} `json:"default,omitempty"`
	Example     string      `json:"example,omitempty"`
}

// Tool is a capability the operator or the agent can run.
type Tool struct {
	Name        string    `json:"name"`
	Title       string    `json:"title"`
	Category    string    `json:"category"`
	Risk        string    `json:"risk"`
	Kind        string    `json:"kind"`
	Description string    `json:"description"`
	Args        []ArgSpec `json:"args"`
	Available   bool      `json:"available"`
}

// ToolRun is the reply to tool.run. When Allowed is false the tool never ran and
// Action, Risk and Reason say why the policy engine stopped it.
type ToolRun struct {
	Allowed    bool   `json:"allowed"`
	Tool       string `json:"tool"`
	Command    string `json:"command"`
	RunID      string `json:"runId"`
	OK         bool   `json:"ok"`
	Summary    string `json:"summary"`
	Evidence   string `json:"evidence"`
	Error      string `json:"error"`
	DurationMs int    `json:"durationMs"`
	Action     string `json:"action"`
	Risk       string `json:"risk"`
	Reason     string `json:"reason"`
}

// ModelSource is a place models can be reached.
type ModelSource struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Kind    string   `json:"kind"`
	BaseURL string   `json:"baseUrl"`
	APIKey  string   `json:"apiKey"`
	Models  []string `json:"models"`
	Live    bool     `json:"live"`
	// Origin says where the source came from, so a list of endpoints can explain
	// itself.
	Origin string `json:"origin"`
}

// HasKey reports whether this source can actually be called.
func (m ModelSource) HasKey() bool { return m.APIKey != "" }

// AnonymousTier reports whether this source is the gateway's no-credential tier,
// where the token is the published literal "public" rather than a secret.
func (m ModelSource) AnonymousTier() bool { return m.APIKey == "public" && m.Origin == "current" }

// ConfirmRequest is raised when the core needs a human decision.
type ConfirmRequest struct {
	Tool    string `json:"tool"`
	Command string `json:"command"`
	Reason  string `json:"reason"`
	Risk    string `json:"risk"`
	Token   string `json:"token"`
}
