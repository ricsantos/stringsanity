## StringSanity

Keeps localized string files for **iOS**, **Android**, and **React / i18next** projects in sync with their base language. Optionally uses OpenAI to translate missing entries automatically.

Each platform has its own CLI that understands the conventions of that platform's locale layout:

- **iOS** — `cli-ios.js` — `.lproj/*.strings` (e.g. `Localizable.strings`, `InfoPlist.strings`)
- **Android** — `cli-android.js` — `values-<lang>/strings.xml`
- **React / i18next** — `cli-react.js` — `<lang>/<namespace>.json`

### Installation

```bash
npm install
```

### Common flags

All three CLIs share the same vocabulary:

| Flag | Purpose |
| --- | --- |
| `--translate` | Fill missing entries via OpenAI (requires `OPENAI_API_KEY`) |
| `--remove-extra` | Delete keys present in a translated file but missing from the base |
| `--language <code>` | Restrict processing to a single locale folder |

---

### iOS — `cli-ios.js`

Layout expected:

```
Resources/
  Base.lproj/Localizable.strings   (or en.lproj)
  Base.lproj/InfoPlist.strings     (any other .strings files are picked up too)
  fr.lproj/Localizable.strings
  de.lproj/Localizable.strings
  ...
```

Every `.strings` file in the base lproj is processed; a language missing one of them (e.g. no `fr.lproj/InfoPlist.strings` yet) gets the file created.

Examples:

```bash
# Sync missing keys, marked as UNTRANSLATED
./cli-ios.js ../ios-app/Resources

# Remove keys not in base
./cli-ios.js ../ios-app/Resources --remove-extra

# AI translate missing keys
export OPENAI_API_KEY=your-api-key
./cli-ios.js ../ios-app/Resources --translate

# Restrict to French
./cli-ios.js ../ios-app/Resources --translate --language fr
```

Extra flag: `--no-comment` skips the `/* UNTRANSLATED */` / `/* Translated by Stringsanity */` comments on new entries.

Output:
- Without `--translate`: missing strings are marked `/* UNTRANSLATED */`.
- With `--translate`: translated strings are marked `/* Translated by Stringsanity */`.
- All files are sorted alphabetically.

---

### Android — `cli-android.js`

Layout expected:

```
res/
  values/strings.xml          ← base
  values-fr/strings.xml
  values-de/strings.xml
  values-zh-rCN/strings.xml
  ...
```

Strings marked `translatable="false"` in the base are skipped.

Examples:

```bash
./cli-android.js ../android-app/src/main/res
./cli-android.js ../android-app/src/main/res --remove-extra
./cli-android.js ../android-app/src/main/res --translate
./cli-android.js ../android-app/src/main/res --translate --language fr
```

Output:
- New entries are appended before `</resources>` with an XML comment indicating UNTRANSLATED or translated state.
- Android-specific escaping (`\'`, `\"`, `&amp;`) is handled automatically.

---

### React / i18next — `cli-react.js`

Layout expected (BCP-47 tag per folder, one JSON file per namespace):

```
src/locales/
  en-US/common.json           ← base (falls back to en/common.json)
  en-US/errors.json
  fr-FR/common.json
  fr-FR/errors.json
  de-DE/common.json
  zh-Hans/common.json
  ...
```

Examples:

```bash
# Sync all namespaces, all locales (fills missing keys with English)
./cli-react.js ../react-app/src/locales

# AI translate just French
export OPENAI_API_KEY=your-api-key
./cli-react.js ../react-app/src/locales --translate --language fr-FR

# Restrict to one namespace
./cli-react.js ../react-app/src/locales --translate --namespace common

# Use a non-default base language
./cli-react.js ../react-app/src/locales --base-language en-GB --translate
```

Extra flags:
- `--base-language <code>` — override the default base of `en-US` (falls back to `en` if neither folder exists).
- `--namespace <name>` — restrict to a single namespace file. By default every `.json` file in the base folder is processed.

Behavior notes:
- Nested JSON structures are diffed via dot-paths (`shared.cancel`, `purchaseCreditPack.purchase.errorTitle`) and re-nested when written.
- The base file's **insertion order** is preserved — new keys are inserted in the position they appear in the base, not sorted alphabetically. This keeps semantically-grouped JSON readable.
- i18next placeholders (`{{name}}`, ICU plural/select) are preserved verbatim during translation.
- Region-aware language hints (`en-US` vs `en-GB`, `fr-FR` vs `fr-CA`, `zh-Hans` vs `zh-Hant`) are passed to the translator.
- JSON has no comments, so untranslated/translated status is reported to stdout only.

---

### Features

**String Synchronization**
- Reads the base language file to get the canonical key list.
- For every other locale, identifies missing keys and inserts them.
- Reports (or removes, with `--remove-extra`) any keys not present in the base.

**AI-Powered Translation** (`--translate`)
- Uses the OpenAI API to translate missing entries.
- Preserves placeholders, escapes, and platform-specific quirks.
- Supports 30+ languages including English variants, Arabic, Chinese (Simplified/Traditional), Japanese, Korean, German, Spanish (ES/MX), French (FR/CA), Portuguese (PT/BR), and more.

**Extra String Cleanup** (`--remove-extra`)
- Identifies keys present in a translated file but missing from the base.
- Reports them by default; deletes them when the flag is set.

### Requirements

- Node.js
- OpenAI API key (only required when using `--translate`)

---

### Claude Code skill

This repo ships a [`SKILL.md`](./SKILL.md) so [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) can drive the CLIs for you (picking the right one, choosing flags, respecting guardrails around `--translate` and `--remove-extra`).

Install it once at the user level so it's available in every project:

```bash
mkdir -p ~/.claude/skills/stringsanity
cp SKILL.md ~/.claude/skills/stringsanity/SKILL.md
```

Or install it per-project (only loads when Claude runs inside that repo):

```bash
mkdir -p <your-project>/.claude/skills/stringsanity
cp SKILL.md <your-project>/.claude/skills/stringsanity/SKILL.md
```

Then in Claude Code, asks like *"sync the French translations in ./ios/Resources"* will auto-load the skill. You can also invoke it explicitly with `/stringsanity`.
