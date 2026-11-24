# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StringSanity syncs localized string files against a base language for iOS, Android, and React/i18next projects, and can fill missing entries via OpenAI. Plain Node.js (CommonJS), no build step, no tests, no linter.

## Commands

```bash
npm install
./cli-ios.js <Resources dir> [--translate] [--remove-extra] [--language fr] [--no-comment] [--context notes.md]
./cli-android.js <res dir>   [--translate] [--remove-extra] [--language fr]
./cli-react.js <locales dir> [--translate] [--remove-extra] [--language fr-FR] [--namespace common] [--base-language en-GB]
./stringsanity.js            # interactive wizard (same as `npm start`); needs a TTY, so don't run it from Claude Code
```

Running a CLI with no arguments prints its usage. There is no test suite (`npm test` just fails); verify changes by running the CLI against a scratch copy of a real locale directory and diffing the result. Omit `--translate` to avoid OpenAI calls while testing; omit `--remove-extra` unless testing deletion, since it rewrites target files.

## Architecture

- **Three CLIs, one shared translator.** `cli-ios.js`, `cli-android.js`, `cli-react.js` share only `translate.js`. Each CLI still duplicates its own arg parsing, `getLanguageName()` map, and console output style, so a change to those (language map, a common flag) must be made in all three files. `index.js` is empty and unused.
- **`translate.js`** owns the OpenAI call (model `gpt-6.1-sol`, `max_completion_tokens`, `response_format: json_schema`). `translateMany(items, languageName, { platformHint, appContext, label })` sends up to 40 strings per request and runs at most 8 requests at once across the whole process. It retries a missing or placeholder-changed string on its own, splits a truncated batch in half, and caches results per language. The first API error sets a stop flag (`isStopped()`) that rejects every queued request. Each CLI passes its own `platformHint` prompt line.
- **Common flow in each CLI:** pass 1 reads the base locale as the source of truth (never modified), and for each peer file reports keys missing from base (delete them with `--remove-extra`) and lists the missing keys → pass 2 starts `translateMany` for every file at once (only with `--translate`) → each file is written as soon as its own translations are complete, unless the run has stopped.
- **Per-platform I/O differs:**
  - iOS: parses with the `i18n-strings-files` library (values live under `.text`, comments under `.comment`). Processes every `.strings` file in `Base.lproj` (falls back to `en.lproj`), creates missing peer files, and always rewrites peers sorted alphabetically. The base entry's comment is passed to the translator as context.
  - Android: no XML parser. `<string>` elements are matched and edited with regexes on the raw text; new entries are appended before `</resources>` (not sorted). `translatable="false"` entries are skipped. Handles Android escaping in `escapeAndroid`/`unescapeAndroid`.
  - React: flattens nested JSON to dot-paths, diffs, then unflattens, preserving the base file's key insertion order. JSON has no comments, so translated/untranslated status only goes to stdout.
- **Wizard (`stringsanity.js`)** is a thin `@inquirer/prompts` front end. It builds an argv for one of the CLIs and spawns it, injecting the chosen `OPENAI_API_KEY_<NAME>` from `.env` as `OPENAI_API_KEY`. The CLIs know nothing about the wizard. Its `PLATFORMS`/`OPTIONS` tables must list any flag a CLI adds. Saved projects and per-project default flags persist in `projects.json` (git-ignored).
- **Secrets/state:** `.env` (git-ignored) holds `OPENAI_API_KEY` plus named `OPENAI_API_KEY_<NAME>` keys; every CLI loads it via `dotenv`.

## Docs to keep in sync

A flag or behavior change usually touches four places: the CLI's usage text, `README.md`, `SKILL.md` (the Claude Code skill users copy into `~/.claude/skills/stringsanity/`), and the wizard's `OPTIONS` table.
