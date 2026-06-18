.PHONY: install build run start clean

# Set up the full build environment. Idempotent: only reinstalls when
# package.json changes (the node_modules timestamp gates it).
install: node_modules
	@# Electron downloads its binary in a postinstall step that can fail
	@# transiently, leaving node_modules/electron without path.txt. This check
	@# runs every time (cheap) so a broken install self-heals on re-run. We
	@# clear any partial dist/ first, since install.js won't overwrite it.
	@test -f node_modules/electron/path.txt || { \
		echo "Electron binary missing; reinstalling it..."; \
		rm -rf node_modules/electron/dist; \
		node node_modules/electron/install.js; \
	}

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
