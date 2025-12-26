## StringSanity

Ensures all iOS localized strings files have the complete set of strings from the base language. Optionally uses AI to automatically translate missing strings.

### Installation

```bash
npm install
```

### Usage

```bash
./cli.js <path-to-project-strings-directory> [--remove-extra] [--translate]
```

### Examples

Basic sync (adds missing strings with English values):
```bash
./cli.js ../ios-app/Resources
```

Remove extra strings not in base language:
```bash
./cli.js ../ios-app/Resources --remove-extra
```

AI-powered translation using OpenAI:
```bash
export OPENAI_API_KEY=your-api-key
./cli.js ../ios-app/Resources --translate
```

Combined (translate missing + remove extra):
```bash
./cli.js ../ios-app/Resources --remove-extra --translate
```

### Features

**String Synchronization**
- Reads the base language file (`Base.lproj` or `en.lproj`) to get the canonical list of strings
- For each other language (`.lproj` folders):
  - Identifies missing strings compared to the base language
  - Adds missing strings with appropriate values
  - Maintains alphabetical order in all files

**AI-Powered Translation** (`--translate` flag)
- Automatically translates missing strings using OpenAI's GPT-4o-mini
- Uses context from original comments to improve translation quality
- Supports 30+ languages including Arabic, Chinese, Japanese, German, Spanish, French, and more
- Marks translations with "Translated by Stringsanity" comment
- Requires `OPENAI_API_KEY` environment variable

**Extra String Cleanup** (`--remove-extra` flag)
- Identifies strings that exist in translated files but not in the base language
- Reports extra strings (default) or removes them (with flag)
- Helps keep translation files clean and in sync

### Output

- Without `--translate`: Missing strings are marked with `/* UNTRANSLATED */` comments
- With `--translate`: Successfully translated strings are marked with `/* Translated by Stringsanity */` comments
- All files are automatically sorted alphabetically for consistency

### Requirements

- Node.js
- OpenAI API key (only required when using `--translate` flag)
