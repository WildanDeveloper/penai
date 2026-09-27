package app

import (
	"os"
	"strconv"
	"strings"

	"penai/internal/ui/model"
)

// The frame harness works through the environment, because the testing package
// rejects any flag it does not own:
//
//	PENAI_FRAME_SIZE=80x24 PENAI_FRAME_VIEW=scope go test -run TestPrintFrame -v
func frameSize() (int, int) {
	raw := os.Getenv("PENAI_FRAME_SIZE")
	if raw == "" {
		return 100, 30
	}
	width, height, found := strings.Cut(raw, "x")
	if !found {
		return 100, 30
	}
	w, err := strconv.Atoi(width)
	if err != nil {
		return 100, 30
	}
	h, err := strconv.Atoi(height)
	if err != nil {
		return 100, 30
	}
	return w, h
}

func frameView() model.View {
	switch strings.ToLower(os.Getenv("PENAI_FRAME_VIEW")) {
	case "scout":
		return model.ViewScout
	case "findings":
		return model.ViewFindings
	case "scope":
		return model.ViewScope
	case "report":
		return model.ViewReport
	case "audit":
		return model.ViewAudit
	default:
		return model.ViewConsole
	}
}

// frameViewFromName maps a name to a view, for the tests that name one.
func frameViewFromName(name string) model.View {
	previous := os.Getenv("PENAI_FRAME_VIEW")
	os.Setenv("PENAI_FRAME_VIEW", name)
	defer os.Setenv("PENAI_FRAME_VIEW", previous)
	return frameView()
}
