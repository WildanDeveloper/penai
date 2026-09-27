package width

import "testing"

// TestTheLocaleDecides checks the rule the whole layout rests on: the
// convention comes from the environment, not from a guess baked into the code.
func TestTheLocaleDecides(t *testing.T) {
	cases := []struct {
		override string
		locale   string
		want     int
	}{
		{override: "", locale: "en_US.UTF-8", want: 1},
		{override: "", locale: "C", want: 1},
		{override: "2", locale: "en_US.UTF-8", want: 2},
		{override: "1", locale: "ja_JP.UTF-8", want: 1},
		{override: "wide", locale: "en_US.UTF-8", want: 2},
		{override: "narrow", locale: "ja_JP.UTF-8", want: 1},
	}
	for _, item := range cases {
		t.Setenv("PENAI_AMBIGUOUS_WIDTH", item.override)
		t.Setenv("LANG", item.locale)
		t.Setenv("LC_ALL", item.locale)
		if got := Decide(); got != item.want {
			t.Errorf("override=%q locale=%q: got %d, want %d", item.override, item.locale, got, item.want)
		}
	}
}

// TestAmbiguousGlyphsFollowTheConvention: the same rule is one column in a
// normal terminal and two in a CJK one, and the measurement has to agree with
// whichever is in force.
func TestAmbiguousGlyphsFollowTheConvention(t *testing.T) {
	for _, glyph := range []string{"─", "│", "▸", "✓", "…", "·"} {
		if got := String(glyph); got != 1 && got != 2 {
			t.Errorf("%q measured as %d columns", glyph, got)
		}
		if String(glyph) != Rune([]rune(glyph)[0]) {
			t.Errorf("%q: String and Rune disagree", glyph)
		}
	}
	// ASCII is one column in either convention.
	if got := String("abcdef"); got != 6 {
		t.Errorf("ASCII measured as %d columns, want 6", got)
	}
}

// TestStripLeavesTheDrawnText: a styled row is measured by what is drawn, not
// by the bytes that describe it.
func TestStripLeavesTheDrawnText(t *testing.T) {
	row := "\x1b[38;5;203mhigh\x1b[0m \x1b[1;38;5;17;48;5;75m ▸ \x1b[0m tcp_scan"
	if got := Strip(row); got != "high  ▸  tcp_scan" {
		t.Fatalf("stripped to %q", got)
	}
	if got := Styled(row); got != String("high  ▸  tcp_scan") {
		t.Errorf("styled width %d, want %d", got, String("high  ▸  tcp_scan"))
	}
}

// TestStylesDoNotChangeTheWidth: the same text, coloured or not, is the same
// number of columns.
func TestStylesDoNotChangeTheWidth(t *testing.T) {
	plain := "the quick brown fox"
	styled := "\x1b[38;5;60m" + plain + "\x1b[0m"
	if Styled(styled) != String(plain) {
		t.Errorf("styled %d, plain %d", Styled(styled), String(plain))
	}
}

// TestWideCharactersCountAsTwo: a CJK ideograph is wide in every convention,
// which is not negotiable.
func TestWideCharactersCountAsTwo(t *testing.T) {
	if got := String("日本"); got != 4 {
		t.Errorf("two ideographs measured as %d columns, want 4", got)
	}
}
