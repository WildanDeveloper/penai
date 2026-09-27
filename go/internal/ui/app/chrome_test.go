package app

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"

	"penai/internal/protocol"
	"penai/internal/ui/model"
	"penai/internal/ui/theme"
)

// TestStyledRowsSurviveTheHeader is a regression test for a bug that made the
// header unreadable: a plain rune-based clip was cutting a styled string in the
// middle of an escape sequence, so the terminal printed the codes as text and
// dropped the words after them.
func TestStyledRowsSurviveTheHeader(t *testing.T) {
	for _, width := range []int{60, 78, 80, 100, 130, 200} {
		s := populated(width, 30)
		for _, row := range strings.Split(s.View(), "\n") {
			visible := stripANSI(row)
			if strings.Contains(visible, "\x1b") {
				t.Fatalf("width %d: an escape sequence survived into the output: %q", width, row)
			}
			// A code cut in half shows up as its own characters in the text.
			if strings.Contains(visible, "[38") || strings.Contains(visible, "[0m") {
				t.Fatalf("width %d: a truncated escape code was printed as text: %q", width, visible)
			}
		}
	}
}

// TestHeaderKeepsItsWords checks the counts survive clipping.
func TestHeaderKeepsItsWords(t *testing.T) {
	s := populated(70, 20)
	header := stripANSI(s.header())
	for _, want := range []string{"scope", "findings", "tools"} {
		if !strings.Contains(header, want) {
			t.Errorf("header lost %q:\n%s", want, header)
		}
	}
}

// TestDialogsDoNotLeakCodes covers the dialogs, which mix styled fragments with
// padding and clipping; that is where a styled row most easily gets cut in the
// wrong place.
func TestDialogsDoNotLeakCodes(t *testing.T) {
	sources := []protocol.ModelSource{
		{ID: "zen", Label: "current", Kind: "openai", BaseURL: "https://opencode.ai/zen/v1", Models: []string{"gpt-5-codex", "claude-opus-4-6", "grok-code-fast"}},
		{ID: "gateway", Label: "gateway", Kind: "openai", BaseURL: "https://example.test/v1", APIKey: "sk-test", Models: []string{"a-model"}},
	}
	for _, width := range []int{60, 78, 80, 100, 130, 200} {
		for _, dialog := range []model.ModalKind{model.ModalHelp, model.ModalModel, model.ModalPalette, model.ModalConfirm} {
			s := populated(width, 24)
			s.modalSources = sources
			s.modal = dialog
			if dialog == model.ModalConfirm {
				s.confirm = &protocol.ConfirmRequest{
					Tool:    "http_probe",
					Command: "http_probe --url https://staging.example.test/very/long/path/that/needs/clipping",
					Reason:  "risk medium is above the balanced ceiling, so a human has to say yes",
					Risk:    "medium",
				}
			}
			for _, row := range strings.Split(s.View(), "\n") {
				visible := stripANSI(row)
				if strings.Contains(visible, "[38") || strings.Contains(visible, "[0m") || strings.Contains(visible, "\x1b") {
					t.Fatalf("%dx%v: code leaked into the text: %q", width, dialog, visible)
				}
				if runeLen(visible) > width {
					t.Fatalf("%dx%v: row is %d columns: %q", width, dialog, runeLen(visible), visible)
				}
			}
		}
	}
}

// TestStyledRowKeepsTrailingTextWhenCut makes sure the cut is at the end and not
// in the middle of the content.
func TestStyledRowKeepsTrailingTextWhenCut(t *testing.T) {
	row := lipgloss.NewStyle().Foreground(theme.Accent).Render("a long styled sentence that will not fit") +
		lipgloss.NewStyle().Foreground(theme.Muted).Render(" and the tail that matters")
	cut := stripANSI(truncateStyled(row, 20))
	if !strings.HasSuffix(cut, theme.Ellipsis) {
		t.Errorf("a cut row should end in the ellipsis, got %q", cut)
	}
	if strings.Contains(cut, "\x1b") {
		t.Errorf("codes leaked: %q", cut)
	}
	if got := runeLen(cut); got != 20 {
		t.Errorf("got %d columns %q, want 20", got, cut)
	}
}

// TestNavStripIsNeverSliced: a narrow navigation strip is built from whole
// items. Cutting a styled string by character count lands inside an escape
// sequence, and the terminal then prints the leftover of the code as text.
func TestNavStripIsNeverSliced(t *testing.T) {
	for _, width := range []int{40, 48, 55, 60, 70, 77, 78, 90, 120} {
		for _, view := range []model.View{model.ViewConsole, model.ViewScout, model.ViewFindings, model.ViewScope, model.ViewReport, model.ViewAudit} {
			s := populated(width, 30)
			s.view = view
			strip := s.navStrip()
			visible := stripANSI(strip)
			if strings.Contains(visible, "[38") || strings.Contains(visible, "\x1b") {
				t.Errorf("%d cols, view %v: a code leaked into the strip: %q", width, view, visible)
			}
			for i, row := range strings.Split(visible, "\n") {
				if w := runeLen(row); w > width {
					t.Errorf("%d cols, view %v: nav row %d is %d columns: %q", width, view, i, w, row)
				}
			}
			// The active view must be in the strip, or the operator has no idea
			// which tab they are on.
			if !strings.Contains(visible, s.currentViewDescriptor().Label) {
				t.Errorf("%d cols, view %v: the active view is missing from %q", width, view, visible)
			}
		}
	}
}
