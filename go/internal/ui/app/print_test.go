package app

import (
	"strings"
	"testing"
)

// TestPrintFrame renders the frame and prints it, so a layout can be looked at
// without a terminal in the loop. It also holds the two invariants a full-screen
// program cannot afford to break.
//
//	PENAI_FRAME_SIZE=80x24 go test ./internal/ui/app -run TestPrintFrame -v
//	PENAI_FRAME_SIZE=80x24 PENAI_FRAME_VIEW=scope go test ... -run TestPrintFrame -v
func TestPrintFrame(t *testing.T) {
	width, height := frameSize()
	s := populated(width, height)
	s.view = frameView()

	frame := stripANSI(s.View())
	rows := strings.Split(frame, "\n")

	t.Logf("%dx%d, %d rows rendered", width, height, len(rows))
	for i, row := range rows {
		t.Logf("%2d|%s|", i+1, row)
	}

	if len(rows) != height {
		t.Errorf("the frame is %d rows, the terminal is %d: the screen would scroll", len(rows), height)
	}
	for i, row := range rows {
		if got := len([]rune(row)); got > width {
			t.Errorf("row %d is %d columns, the terminal is %d: %q", i+1, got, width, row)
		}
	}
}
