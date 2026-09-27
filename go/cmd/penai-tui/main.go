// Command penai-tui is the terminal client for PENAI.
//
// The client owns nothing but presentation: it starts the TypeScript core as a
// child process and exchanges newline-delimited JSON with it on stdio. That
// split is what lets the core be tested headlessly and the interface be
// replaced without touching the engine.
package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"penai/internal/ui/app"
)

// version is stamped by the build; the fallback keeps a plain `go build` honest.
var version = "0.1.0"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "penai: %v\n", err)
		os.Exit(1)
	}
}

func run(argv []string) error {
	for _, arg := range argv {
		switch strings.ToLower(arg) {
		case "--version", "-v":
			fmt.Printf("penai-tui %s\n", version)
			return nil
		case "--help", "-h":
			usage()
			return nil
		}
	}

	state, err := app.New()
	if err != nil {
		return err
	}
	defer state.Close()

	program := tea.NewProgram(
		state,
		tea.WithAltScreen(),
		// Bracketed paste keeps a multi-line selection from arriving as a
		// stream of single keys, and mouse motion lets the dialogs scroll.
		tea.WithReportFocus(),
	)
	_, err = program.Run()
	return err
}

func usage() {
	fmt.Print(`PENAI terminal client

USAGE
  penai-tui                 open the client, starting the core it needs

OPTIONS
  -h, --help      this text
  -v, --version   the version

ENVIRONMENT
  PENAI_CORE      override how the core is launched
                  (e.g. "node /path/to/dist/cmd/penai/main.js")
  PENAI_DATA_DIR  where the core keeps engagement evidence
  PENAI_API_KEY   key for the model endpoint
  PENAI_BASE_URL  the model endpoint
  PENAI_MODEL     the model id

Everything else the client does is a conversation with the core, so the same
configuration works for the headless commands: penai doctor, penai run,
penai ask, penai report.
`)
}
