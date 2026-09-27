package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestCoreCandidatesCoverTheRealLayout is the regression test for the bug that
// made the client look broken: it found the core only when the working
// directory happened to be the repository root, so launching the binary from
// anywhere else failed with "cannot find the penai core".
func TestCoreCandidatesCoverTheRealLayout(t *testing.T) {
	exe := os.Args[0]
	dir := filepath.Dir(exe)
	for _, want := range []string{
		filepath.Join(dir, "core", "penai.js"),
		filepath.Join(dir, "..", "dist", "cmd", "penai", "main.js"),
		filepath.Join(dir, "..", "share", "penai", "core", "penai.js"),
	} {
		if !containsPath(coreCandidates(), want) {
			t.Errorf("the layout near the binary is not searched: %s", want)
		}
	}
}

// TestCoreCandidatesWalkUpFromTheWorkingDirectory covers running from a
// subdirectory of the checkout.
func TestCoreCandidatesWalkUpFromTheWorkingDirectory(t *testing.T) {
	nested := filepath.Join(t.TempDir(), "a", "b", "c")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	previous, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(nested); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	defer os.Chdir(previous)

	found := false
	for _, candidate := range coreCandidates() {
		if strings.HasSuffix(candidate, filepath.Join("a", "dist", "cmd", "penai", "main.js")) {
			found = true
		}
	}
	if !found {
		t.Errorf("the working directory's ancestors are not searched: %v", coreCandidates())
	}
}

// TestCoreCandidatesAreAbsolute: a relative candidate would resolve against
// whatever the core's own working directory turns out to be.
func TestCoreCandidatesAreAbsolute(t *testing.T) {
	for _, candidate := range coreCandidates() {
		if !filepath.IsAbs(candidate) {
			t.Errorf("candidate is relative: %s", candidate)
		}
	}
}

// TestCoreCommandUsesTheOverride checks PENAI_CORE still wins, because that is
// the escape hatch for development and for packaging.
func TestCoreCommandUsesTheOverride(t *testing.T) {
	t.Setenv("PENAI_CORE", "bun run /somewhere/else/main.ts")
	command, args, err := coreCommand()
	if err != nil {
		t.Fatalf("coreCommand: %v", err)
	}
	if command != "bun" {
		t.Errorf("command = %q, want bun", command)
	}
	if strings.Join(args, " ") != "run /somewhere/else/main.ts" {
		t.Errorf("args = %v", args)
	}
}

func containsPath(paths []string, want string) bool {
	for _, path := range paths {
		if path == want {
			return true
		}
	}
	return false
}
