# The terminal client.
#
# The core is TypeScript and lives one directory up; `make all` builds both so
# a single command produces a working pair.

BIN     := ../bin
VERSION := 0.1.0

.PHONY: all build test vet fmt check clean run

## all: build the core and the client together
all: build

## build: compile the client into ../bin/penai-tui
build:
	@mkdir -p $(BIN)
	go build -ldflags "-X main.version=$(VERSION)" -o $(BIN)/penai-tui ./cmd/penai-tui
	@echo "built $(BIN)/penai-tui"

## test: run the client test suite
test:
	go test ./...

## vet: run the Go vet checks
vet:
	go vet ./...

## fmt: format every file in place
fmt:
	gofmt -w .

## check: the gate - tests, vet and formatting
check: vet test
	@out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "not formatted:"; echo "$$out"; exit 1; fi
	@echo "go: clean"

## run: build and start the client against the core in this repository
run: build
	cd .. && PENAI_CORE="node $$PWD/dist/cmd/penai/main.js" $(BIN)/penai-tui

## clean: remove the built client
clean:
	rm -rf $(BIN)
