#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const [,, ...args] = process.argv;

run(args)

async function run(args) {
    printDottedLine();
    console.log("")
    console.log("StringSanity (React / i18next) - " + Date())
    console.log("")
    printDottedLine();
    console.log("")

    if (args.length < 1) {
        console.log("Usage: ./cli-react.js <locales-directory> [--remove-extra] [--translate] [--language <code>] [--base-language <code>] [--namespace <name>]");
        console.log("Example: ./cli-react.js ../react-app/src/locales");
        console.log("         ./cli-react.js ../react-app/src/locales --remove-extra");
        console.log("         ./cli-react.js ../react-app/src/locales --translate");
        console.log("         ./cli-react.js ../react-app/src/locales --remove-extra --translate");
        console.log("         ./cli-react.js ../react-app/src/locales --translate --language fr-FR");
        console.log("         ./cli-react.js ../react-app/src/locales --translate --base-language en-GB");
        console.log("         ./cli-react.js ../react-app/src/locales --translate --namespace common");
        console.log("");
        console.log("Expects: <locales-directory>/<lang-tag>/<namespace>.json (e.g. en-US/common.json)");
        console.log("Base language defaults to 'en-US', falling back to 'en' if not present.");
        console.log("Namespace defaults to every .json file found in the base directory.");
        console.log("");
        console.log("--translate requires OPENAI_API_KEY environment variable");
        console.log("--language <code> restricts processing to a single locale folder (e.g. fr-FR, zh-Hans)");
        return;
    }

    let localesDir = args[0];
    let removeExtra = args.includes('--remove-extra');
    let translate = args.includes('--translate');

    let languageIndex = args.indexOf('--language');
    let languageFilter = languageIndex >= 0 ? args[languageIndex + 1] : null;
    if (languageIndex >= 0 && !languageFilter) {
        console.log("Error: --language requires a language code (e.g. --language fr-FR)");
        return;
    }

    let baseLanguageIndex = args.indexOf('--base-language');
    let baseLanguageOverride = baseLanguageIndex >= 0 ? args[baseLanguageIndex + 1] : null;
    if (baseLanguageIndex >= 0 && !baseLanguageOverride) {
        console.log("Error: --base-language requires a language code (e.g. --base-language en-US)");
        return;
    }

    let namespaceIndex = args.indexOf('--namespace');
    let namespaceFilter = namespaceIndex >= 0 ? args[namespaceIndex + 1] : null;
    if (namespaceIndex >= 0 && !namespaceFilter) {
        console.log("Error: --namespace requires a name (e.g. --namespace common)");
        return;
    }

    console.log("Locales directory: " + localesDir);
    if (removeExtra) {
        console.log("Mode: Remove extra strings not in base language");
    } else {
        console.log("Mode: Report extra strings (use --remove-extra to remove them)");
    }

    if (languageFilter) {
        console.log("Language filter: only processing '" + languageFilter + "'");
    }
    if (namespaceFilter) {
        console.log("Namespace filter: only processing '" + namespaceFilter + "'");
    }

    if (translate) {
        console.log("Translation: Enabled (using OpenAI API)");
        if (!process.env.OPENAI_API_KEY) {
            console.log("Error: OPENAI_API_KEY environment variable is required for translation");
            console.log("Set it with: export OPENAI_API_KEY=your-api-key");
            return;
        }
    } else {
        console.log("Translation: Disabled (use --translate to enable)");
    }

    if (!fs.existsSync(localesDir) || !fs.statSync(localesDir).isDirectory()) {
        console.log("Error: locales directory does not exist: " + localesDir);
        return;
    }

    // Resolve base language directory
    let baseLanguage = baseLanguageOverride || 'en-US';
    let baseDir = path.join(localesDir, baseLanguage);
    if (!fs.existsSync(baseDir)) {
        if (!baseLanguageOverride) {
            console.log("Base '" + baseLanguage + "' not found, falling back to 'en'");
            baseLanguage = 'en';
            baseDir = path.join(localesDir, baseLanguage);
        }
        if (!fs.existsSync(baseDir)) {
            console.log("Error: base language directory not found: " + baseDir);
            return;
        }
    }
    console.log("Base language: " + baseLanguage);
    console.log("Base dir: " + baseDir);

    // Determine namespaces to process
    let allNamespaces = fs.readdirSync(baseDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));

    if (allNamespaces.length === 0) {
        console.log("Error: no .json namespace files found in base dir");
        return;
    }

    let namespaces = namespaceFilter
        ? allNamespaces.filter(n => n === namespaceFilter)
        : allNamespaces;

    if (namespaces.length === 0) {
        console.log("Error: namespace '" + namespaceFilter + "' not found in base dir");
        return;
    }
    console.log("Namespaces: " + JSON.stringify(namespaces));

    // Find all language directories
    let localeEntries = fs.readdirSync(localesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(name => name !== baseLanguage);

    console.log("Found language directories: " + JSON.stringify(localeEntries));

    let processedCount = 0;
    let totalAddedStrings = 0;

    for (let language of localeEntries) {
        if (languageFilter && language !== languageFilter) continue;

        console.log("");
        console.log("Processing language: " + language);

        let langDir = path.join(localesDir, language);
        let perLangAdded = 0;
        let perLangExtra = 0;

        for (let namespace of namespaces) {
            let basePath = path.join(baseDir, namespace + '.json');
            let langPath = path.join(langDir, namespace + '.json');

            if (!fs.existsSync(basePath)) {
                console.log("  Skipping namespace '" + namespace + "': missing in base");
                continue;
            }

            let baseData;
            try {
                baseData = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
            } catch (err) {
                console.log("  Error parsing base " + basePath + ": " + err.message);
                continue;
            }

            let langData = {};
            if (fs.existsSync(langPath)) {
                try {
                    langData = JSON.parse(fs.readFileSync(langPath, 'utf-8'));
                } catch (err) {
                    console.log("  Warning: unable to parse " + langPath + " (" + err.message + "), treating as empty");
                    langData = {};
                }
            } else {
                console.log("  Creating new namespace file: " + langPath);
            }

            let baseFlat = flatten(baseData);
            let langFlat = flatten(langData);
            let baseKeys = Object.keys(baseFlat);
            let langKeys = Object.keys(langFlat);

            let extraKeys = langKeys.filter(k => !(k in baseFlat));
            if (extraKeys.length > 0) {
                console.log("  [" + namespace + "] Found " + extraKeys.length + " extra keys not in base:");
                extraKeys.forEach(k => console.log("    - " + k));
                if (removeExtra) {
                    console.log("  Removed " + extraKeys.length + " extra keys");
                } else {
                    console.log("  Use --remove-extra to remove these keys");
                }
                perLangExtra += extraKeys.length;
            }

            // Build output in base order, filling missing keys
            let outFlat = {};
            let nsAdded = 0;

            for (let key of baseKeys) {
                let existing = langFlat[key];
                if (existing != null && existing !== '') {
                    outFlat[key] = existing;
                    continue;
                }

                let baseValue = baseFlat[key];
                console.log("  [" + namespace + "] Missing translation for key: " + key);

                let translatedValue = baseValue;

                if (translate) {
                    let fullLanguageName = getLanguageName(language);
                    console.log("    Translating '" + baseValue + "' to " + fullLanguageName + " (" + language + ")...");
                    let result = await translateText(baseValue, fullLanguageName, process.env.OPENAI_API_KEY, key);

                    if (result && result !== baseValue) {
                        console.log("    ✓ Translation succeeded");
                        translatedValue = result;
                    } else if (!result) {
                        console.log("    ✗ Translation API returned null/empty — using English");
                        translatedValue = baseValue;
                    } else {
                        console.log("    ✓ Translation matches English value (universal term, no translation needed)");
                        translatedValue = baseValue;
                    }
                } else {
                    console.log("    Adding English value: '" + baseValue + "'");
                }

                outFlat[key] = translatedValue;
                nsAdded += 1;
            }

            // Carry forward extras unless removing
            if (!removeExtra) {
                for (let k of extraKeys) {
                    outFlat[k] = langFlat[k];
                }
            }

            let nested = unflatten(outFlat);
            fs.mkdirSync(langDir, { recursive: true });
            fs.writeFileSync(langPath, JSON.stringify(nested, null, 2) + '\n', 'utf-8');

            if (nsAdded > 0) {
                console.log("  [" + namespace + "] Added " + nsAdded + " keys");
                perLangAdded += nsAdded;
            }

            let finalCount = Object.keys(flatten(nested)).length;
            let removedNote = removeExtra ? "" : (extraKeys.length > 0 ? " (kept " + extraKeys.length + " extra)" : "");
            if (finalCount === baseKeys.length + (removeExtra ? 0 : extraKeys.length)) {
                console.log("  [" + namespace + "] ✓ " + finalCount + " keys total" + removedNote);
            }
        }

        totalAddedStrings += perLangAdded;
        if (perLangAdded === 0 && perLangExtra === 0) {
            console.log("  ✓ Language " + language + " already in sync across all namespaces");
        } else {
            console.log("  → Added " + perLangAdded + ", " + (removeExtra ? "removed " : "found ") + perLangExtra + " extra");
        }

        processedCount += 1;
    }

    console.log("")
    console.log("")
    console.log("Completed!")
    console.log("Processed " + processedCount + " languages");
    if (languageFilter && processedCount === 0) {
        console.log("WARNING: ⚠️ no locale folder matched --language '" + languageFilter + "'");
    }
    if (totalAddedStrings > 0) {
        console.log("Added " + totalAddedStrings + " keys across all languages");
        if (!translate) {
            console.log("Inserted English values as placeholders — these still need translation.");
        }
    } else {
        console.log("All languages already have complete translations! 🕺");
    }
    console.log("")
    console.log("")
    printDottedLine();
}

// --- JSON flatten / unflatten ------------------------------------------------

function flatten(obj, prefix = '', out = {}) {
    if (obj == null || typeof obj !== 'object') return out;
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const path = prefix ? prefix + '.' + key : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            flatten(value, path, out);
        } else {
            out[path] = value;
        }
    }
    return out;
}

function unflatten(flat) {
    const out = {};
    for (const dotPath of Object.keys(flat)) {
        const parts = dotPath.split('.');
        let cursor = out;
        for (let i = 0; i < parts.length - 1; i++) {
            if (cursor[parts[i]] == null || typeof cursor[parts[i]] !== 'object') {
                cursor[parts[i]] = {};
            }
            cursor = cursor[parts[i]];
        }
        cursor[parts[parts.length - 1]] = flat[dotPath];
    }
    return out;
}

// --- Language helpers --------------------------------------------------------

function getLanguageName(code) {
    // Region-aware lookup first (BCP-47), then fall back to base language.
    const languageMap = {
        // English variants
        'en': 'English',
        'en-US': 'English (United States)',
        'en-GB': 'English (United Kingdom)',
        'en-AU': 'English (Australia)',
        'en-CA': 'English (Canada)',
        // French variants
        'fr': 'French',
        'fr-FR': 'French (France)',
        'fr-CA': 'French (Canada)',
        // Spanish variants
        'es': 'Spanish',
        'es-ES': 'Spanish (Spain)',
        'es-MX': 'Spanish (Mexico)',
        // Portuguese variants
        'pt': 'Portuguese',
        'pt-PT': 'Portuguese (Portugal)',
        'pt-BR': 'Portuguese (Brazil)',
        // Chinese variants (script-tagged)
        'zh': 'Chinese (Simplified)',
        'zh-Hans': 'Chinese (Simplified)',
        'zh-Hant': 'Chinese (Traditional)',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        // Other base languages
        'ar': 'Arabic',
        'bg': 'Bulgarian',
        'ca': 'Catalan',
        'cs': 'Czech',
        'da': 'Danish',
        'de': 'German',
        'el': 'Greek',
        'fi': 'Finnish',
        'he': 'Hebrew',
        'hi': 'Hindi',
        'hr': 'Croatian',
        'hu': 'Hungarian',
        'id': 'Indonesian',
        'it': 'Italian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'ms': 'Malay',
        'nb': 'Norwegian Bokmål',
        'nl': 'Dutch',
        'no': 'Norwegian',
        'pl': 'Polish',
        'ro': 'Romanian',
        'ru': 'Russian',
        'sk': 'Slovak',
        'sv': 'Swedish',
        'th': 'Thai',
        'tr': 'Turkish',
        'uk': 'Ukrainian',
        'vi': 'Vietnamese'
    };

    if (languageMap[code]) return languageMap[code];
    const base = code.split('-')[0];
    return languageMap[base] || code;
}

async function translateText(text, targetLanguage, apiKey, context) {
    const openai = new OpenAI({ apiKey });

    try {
        let systemPrompt = `You are a professional translator. Translate the given text to ${targetLanguage}. Keep the same tone, style, and formatting. For mobile/web app strings, maintain technical accuracy and appropriate length for UI elements. Preserve any i18next placeholders such as {{name}} and ICU plural/select syntax exactly. Return only the translated text, nothing else.`;

        let userContent = text;
        if (context && context.trim().length > 0) {
            userContent = `Key path (for context): ${context}\n\nText to translate: ${text}`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-5.4",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            max_completion_tokens: 500,
            temperature: 0.3
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.log("    Translation error:", error.message);
        return null;
    }
}

function printDottedLine() {
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=");
}
