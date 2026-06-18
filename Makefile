.PHONY: install build run start clean reset

# Set up the full build environment. Idempotent: only reinstalls when
# package.json changes (the node_modules timestamp gates it).
install: node_modules
	@# Electron downloads its binary in a postinstall step that can fail
	@# transiently, leaving node_modules/electron without path.txt. This check
	@# runs every time (cheap) so a broken install self-heals on re-run. We
	@# clear any partial dist/ first, since install.js won't overwrite it.
	@if [ ! -f node_modules/electron/path.txt ] || [ ! -d node_modules/electron/dist ]; then \
		echo "Electron binary missing; reinstalling it..."; \
		rm -rf node_modules/electron/dist node_modules/electron/path.txt; \
		node node_modules/electron/install.js; \
	fi

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

# Full reset. Also clears Electron's global download cache so the next install
# fetches the binary from scratch. Use this if Electron won't install correctly.
reset: clean
	rm -rf "$(HOME)/Library/Caches/electron"
	@echo "Reset complete. Run 'make run' to reinstall and launch."
