---
name: stringsanity
description: Sync a project's localized string files against a base language using the StringSanity CLIs, optionally translating missing entries with OpenAI. Trigger when the user asks to sync locales, find or fill missing translation keys, remove extra keys, translate strings, or mentions stringsanity / cli-ios.js / cli-android.js / cli-react.js. Also trigger when the user points at an iOS `.lproj`, Android `values-<lang>/strings.xml`, or React i18next `<lang>/<namespace>.json` folder.
---

# StringSanity

StringSanity (https://github.com/ricsantos/stringsanity) ships three CLIs that sync a project's locale files against a base language and optionally translate missing entries via OpenAI.

Pick the CLI matching the **target project's** locale layout. The examples below assume `stringsanity` has been cloned and `npm install`-ed somewhere; substitute the actual path for `<stringsanity>` (or run from inside the clone with `./cli-*.js`).

| CLI | Platform | Locale layout |
| --- | --- | --- |
| `<stringsanity>/cli-ios.js` | iOS | every `Base.lproj/*.strings` (e.g. `Localizable.strings`, `InfoPlist.strings`; falls back to `en.lproj/`), peers in `<lang>.lproj/` |
| `<stringsanity>/cli-android.js` | Android | `values/strings.xml` (base), peers in `values-<lang>/strings.xml` |
| `<stringsanity>/cli-react.js` | React / i18next | `<bcp47-tag>/<namespace>.json` (base defaults to `en-US`, falls back to `en`) |

## Picking the right CLI

Look inside the user's target locale directory:
- `*.lproj` folders → **iOS**
- `values-*/strings.xml` → **Android**
- `<lang>/<file>.json` (e.g. `en-US/common.json`) → **React**

If ambiguous, ask before running.

## Shared flags

- `--translate` — fill missing entries via OpenAI. Requires `OPENAI_API_KEY` (loaded from `.env` automatically via `dotenv`, or from the shell env).
- `--remove-extra` — **destructive**: deletes keys present in a locale file but missing from the base. Without it, extras are only reported.
- `--language <code>` — restrict to a single locale folder (e.g. `fr`, `fr-FR`, `zh-Hans`).

## Per-CLI extras

**`cli-ios.js`**
- `--no-comment` — skip the `/* UNTRANSLATED */` / `/* Translated by Stringsanity */` markers on newly added entries.

**`cli-react.js`**
- `--base-language <code>` — override default base of `en-US` (e.g. `en-GB`).
- `--namespace <name>` — restrict to one namespace; default is every `.json` in the base dir.

## Examples

```bash
# Just report what's missing/extra (no writes to translations)
<stringsanity>/cli-android.js ./android/app/src/main/res

# Translate missing French keys only
export OPENAI_API_KEY=sk-...
<stringsanity>/cli-ios.js ./ios/Resources --translate --language fr

# React: translate one namespace for one locale
<stringsanity>/cli-react.js ./src/locales --translate --namespace common --language fr-FR

# Remove keys from translated files that no longer exist in base
<stringsanity>/cli-android.js ./android/app/src/main/res --remove-extra
```

## Behavior notes

- Translation model is `gpt-5.4`; uses `max_completion_tokens` (not `max_tokens`).
- iOS/Android output is sorted alphabetically. React preserves the base file's **insertion order** so nested groups stay readable.
- React translator preserves i18next placeholders (`{{name}}`) and ICU plural/select syntax verbatim, and passes region-aware language hints (e.g. `en-US` vs `en-GB`, `zh-Hans` vs `zh-Hant`).
- Android skips strings marked `translatable="false"`.
- iOS marks new entries with `/* UNTRANSLATED */` or `/* Translated by Stringsanity */` unless `--no-comment` is passed. JSON has no comments, so React reports status to stdout only.

## Guardrails

- **`--remove-extra` is destructive.** Don't add it unless the user explicitly asks to delete extra keys.
- **`--translate` costs API calls.** Confirm intent before running it across many locales, especially without `--language`.
- The base locale (`Base.lproj` / `en.lproj` for iOS, `values/` for Android, `en-US`/`en` for React) is treated as the source of truth and is never modified.
