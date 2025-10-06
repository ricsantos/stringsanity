## StringSanity

Ensures all iOS localized strings files have the complete set of strings from the base language.

### Usage:

`$ ./cli.js <path-to-project-strings-directory>`

Example:

`$ ./cli.js ../ios-app/Resources`

### What it does:

1. Reads the base language file (`Base.lproj` or `en.lproj`) to get the canonical list of strings
2. For each other language (`.lproj` folders):
   - Checks what strings are missing compared to the base language
   - Adds missing strings using the English value with an "UNTRANSLATED" comment
   - Updates the language file with the complete set of strings

### Output:

Any strings added to language files will be marked with `/* UNTRANSLATED */` comments, making it easy to identify which strings need translation.
