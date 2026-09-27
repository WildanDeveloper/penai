// Package client speaks to the PENAI core over stdio.
//
// The core is a separate process. This type owns the pipe, the request counter
// and the reader goroutine that turns responses and events into channels, so the
// UI never has to think about transport.
package client

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"

	"penai/internal/protocol"
)

// Client is a connection to one core process.
type Client struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout *bufio.Reader

	mu      sync.Mutex
	nextID  int
	pending map[int]chan protocol.Response

	// Events carries core notifications (model tokens, tool output, findings).
	Events chan protocol.Event

	// Errors carries transport-level failures that end the session.
	Errors chan error

	closeOnce sync.Once
}

// Start launches the core. `command` is the core binary, typically
// "node /path/to/penai/dist/cmd/penai/main.js serve".
func Start(command string, args []string, env []string) (*Client, error) {
	cmd := exec.Command(command, args...)
	if len(env) > 0 {
		cmd.Env = append(cmd.Environ(), env...)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	cmd.Stderr = io.Discard

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting core: %w", err)
	}

	c := &Client{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  bufio.NewReaderSize(stdout, 1<<20),
		pending: map[int]chan protocol.Response{},
		Events:  make(chan protocol.Event, 256),
		Errors:  make(chan error, 1),
	}
	go c.read()
	return c, nil
}

func (c *Client) read() {
	defer close(c.Events)
	for {
		line, err := c.stdout.ReadBytes('\n')
		if len(line) > 0 {
			c.dispatch(line)
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				c.fail(fmt.Errorf("core stream: %w", err))
			} else {
				c.fail(errors.New("core exited"))
			}
			return
		}
	}
}

func (c *Client) dispatch(line []byte) {
	trimmed := trimSpace(line)
	if len(trimmed) == 0 {
		return
	}

	// An event has an "event" key; a response has "id" and result/error.
	var probe struct {
		Event string          `json:"event"`
		ID    int             `json:"id"`
		Raw   json.RawMessage `json:"-"`
	}
	if err := json.Unmarshal(trimmed, &probe); err != nil {
		return
	}

	if probe.Event != "" {
		var event protocol.Event
		if err := json.Unmarshal(trimmed, &event); err != nil {
			return
		}
		select {
		case c.Events <- event:
		default:
			// The UI is behind; dropping a progress token is preferable to
			// blocking the reader and stalling every other response.
		}
		return
	}

	var response protocol.Response
	if err := json.Unmarshal(trimmed, &response); err != nil {
		return
	}
	c.mu.Lock()
	waiter, ok := c.pending[response.ID]
	delete(c.pending, response.ID)
	c.mu.Unlock()
	if ok {
		waiter <- response
	}
}

func (c *Client) fail(err error) {
	c.mu.Lock()
	for id, waiter := range c.pending {
		delete(c.pending, id)
		waiter <- protocol.Response{ID: id, Error: &protocol.RPCError{Code: -1, Message: err.Error()}}
	}
	c.mu.Unlock()
	select {
	case c.Errors <- err:
	default:
	}
}

// Call sends a request and waits for its reply. Events for the same call are
// still delivered on the Events channel while this blocks.
func (c *Client) Call(method string, params interface{}, out interface{}) error {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	waiter := make(chan protocol.Response, 1)
	c.pending[id] = waiter
	c.mu.Unlock()

	payload, err := json.Marshal(protocol.Request{ID: id, Method: method, Params: params})
	if err != nil {
		return err
	}
	c.mu.Lock()
	_, err = c.stdin.Write(append(payload, '\n'))
	c.mu.Unlock()
	if err != nil {
		return fmt.Errorf("writing to core: %w", err)
	}

	response := <-waiter
	if response.Error != nil {
		return errors.New(response.Error.Message)
	}
	if out != nil && len(response.Result) > 0 {
		return json.Unmarshal(response.Result, out)
	}
	return nil
}

// Close shuts the core down.
func (c *Client) Close() {
	c.closeOnce.Do(func() {
		_ = c.stdin.Close()
		if c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
		}
		_ = c.cmd.Wait()
	})
}

// trimSpace is a local bytes.TrimSpace, kept here to avoid the strings import
// for a single call on the hot path.
func trimSpace(b []byte) []byte {
	start := 0
	for start < len(b) && isSpace(b[start]) {
		start++
	}
	end := len(b)
	for end > start && isSpace(b[end-1]) {
		end--
	}
	return b[start:end]
}

func isSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
