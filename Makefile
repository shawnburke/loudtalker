.PHONY: install build run start clean

# Set up the full build environment. Idempotent: only reinstalls when
# package.json changes (the node_modules timestamp gates it).
install: node_modules

node_modules: package.json
	npm install
	@touch node_modules

# Compile TypeScript and copy renderer assets into dist/.
build: install
	npm run build

# Build and launch the menu-bar app. Depends on install.
run: install
	npm start

# Alias for `make run`.
start: run

# Remove build output and installed dependencies.
clean:
	rm -rf dist node_modules
