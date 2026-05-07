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
    console.log("StringSanity (Android) - " + Date())
    console.log("")
    printDottedLine();
    console.log("")

    if (args.length < 1) {
        console.log("Usage: ./cli-android.js <res-directory> [--remove-extra] [--translate] [--language <code>]");
        console.log("Example: ./cli-android.js ../android-app/src/main/res");
        console.log("         ./cli-android.js ../android-app/src/main/res --remove-extra");
        console.log("         ./cli-android.js ../android-app/src/main/res --translate");
        console.log("         ./cli-android.js ../android-app/src/main/res --remove-extra --translate");
        console.log("         ./cli-android.js ../android-app/src/main/res --translate --language fr");
        console.log("");
        console.log("Expects: <res-directory>/values/strings.xml as the base language");
        console.log("         <res-directory>/values-{lang}/strings.xml for each language");
        console.log("");
        console.log("--translate requires OPENAI_API_KEY environment variable");
        console.log("--language <code> restricts processing to a single values-<code> folder (e.g. fr, de, zh-rCN)");
        return;
    }

    let resDir = args[0];
    let removeExtra = args.includes('--remove-extra');
    let translate = args.includes('--translate');
    let languageIndex = args.indexOf('--language');
    let languageFilter = languageIndex >= 0 ? args[languageIndex + 1] : null;
    if (languageIndex >= 0 && !languageFilter) {
        console.log("Error: --language requires a language code (e.g. --language fr)");
        return;
    }

    console.log("Android res directory: " + resDir);
    if (removeExtra) {
        console.log("Mode: Remove extra strings not in base language");
    } else {
        console.log("Mode: Report extra strings (use --remove-extra to remove them)");
    }

    if (languageFilter) {
        console.log("Language filter: only processing '" + languageFilter + "'");
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

    let baseStringsPath = path.join(resDir, 'values', 'strings.xml');
    if (!fs.existsSync(baseStringsPath)) {
        console.log("Error: Could not find base strings at " + baseStringsPath);
        return;
    }

    console.log("Base strings path: " + baseStringsPath);

    let baseContent = fs.readFileSync(baseStringsPath, 'utf-8');
    let baseStrings = parseStringsXml(baseContent);
    let baseKeys = Object.keys(baseStrings).sort();
    console.log("Base language has " + baseKeys.length + " translatable string keys");

    let resDirContents = fs.readdirSync(resDir);
    let langDirs = resDirContents.filter(d => d.startsWith('values-'));
    console.log("Found language directories: " + JSON.stringify(langDirs));

    let processedCount = 0;
    let totalAddedStrings = 0;

    for (let langDir of langDirs) {
        let langCode = langDir.replace('values-', '');
        if (languageFilter && langCode !== languageFilter) continue;
        let langStringsPath = path.join(resDir, langDir, 'strings.xml');

        if (!fs.existsSync(langStringsPath)) {
            console.log("Skipping " + langDir + ": no strings.xml found");
            continue;
        }

        console.log("");
        console.log("Processing language: " + langCode + " (" + langDir + ")");

        let langContent = fs.readFileSync(langStringsPath, 'utf-8');
        let langStrings = parseStringsXml(langContent);
        let langKeys = Object.keys(langStrings);

        let addedStringCount = 0;
        let extraStringCount = 0;

        // Check for extra strings not present in base
        let extraKeys = langKeys.filter(k => !baseKeys.includes(k));
        if (extraKeys.length > 0) {
            console.log("Found " + extraKeys.length + " extra strings not in base language:");
            extraKeys.forEach(key => {
                console.log("  - " + key);
                extraStringCount++;
            });

            if (removeExtra) {
                for (let key of extraKeys) {
                    langContent = removeStringElement(langContent, key);
                }
                console.log("Removed " + extraKeys.length + " extra strings");
            } else {
                console.log("Use --remove-extra flag to remove these strings");
            }
        }

        // Find and handle missing strings
        let stringsToAdd = [];
        for (let key of baseKeys) {
            if (langStrings[key] != null) continue;

            console.log("Missing translation for key: " + key);

            let baseValue = baseStrings[key];
            let translatedValue = baseValue;
            let comment = "UNTRANSLATED";

            if (translate) {
                let isoCode = androidLangCodeToIso(langCode);
                let fullLanguageName = getLanguageName(isoCode);
                console.log("Translating '" + baseValue + "' to " + fullLanguageName + " (" + langCode + ")...");
                translatedValue = await translateText(baseValue, fullLanguageName, process.env.OPENAI_API_KEY);

                if (translatedValue && translatedValue !== baseValue) {
                    console.log("✓ Translation succeeded (differs from English)");
                    comment = "Translated by Stringsanity";
                } else if (!translatedValue) {
                    console.log("✗ Translation API returned null/empty");
                    translatedValue = baseValue;
                } else {
                    console.log("✓ Translation matches English value (universal term, no translation needed)");
                    comment = "Translated by Stringsanity";
                    translatedValue = baseValue;
                }
            } else {
                console.log("Adding English value: '" + baseValue + "'");
            }

            stringsToAdd.push({ name: key, value: translatedValue, comment });
            addedStringCount++;
        }

        if (stringsToAdd.length > 0) {
            langContent = addStringElements(langContent, stringsToAdd);
        }

        fs.writeFileSync(langStringsPath, langContent, 'utf-8');

        if (addedStringCount > 0) {
            console.log("Added " + addedStringCount + " strings for language " + langCode);
            totalAddedStrings += addedStringCount;
        }

        let updatedCount = Object.keys(parseStringsXml(langContent)).length;
        if (updatedCount === baseKeys.length) {
            console.log("✓ Language " + langCode + " now has all " + baseKeys.length + " strings");
        } else if (updatedCount > baseKeys.length) {
            console.log("WARNING: ⚠️ language " + langCode + " has " + updatedCount + "/" + baseKeys.length + " strings (" + extraStringCount + " extra)");
        } else {
            console.log("WARNING: ⚠️ language " + langCode + " has " + updatedCount + "/" + baseKeys.length + " strings (missing " + (baseKeys.length - updatedCount) + ")");
        }

        processedCount++;
    }

    console.log("")
    console.log("")
    console.log("Completed!")
    console.log("Processed " + processedCount + " languages");
    if (languageFilter && processedCount === 0) {
        console.log("WARNING: ⚠️ no values-<code> folder matched --language '" + languageFilter + "'");
    }
    if (totalAddedStrings > 0) {
        console.log("Added " + totalAddedStrings + " strings across all languages");
        console.log("Strings marked 'UNTRANSLATED' need human review.");
    } else {
        console.log("All languages already have complete translations! 🕺");
    }
    console.log("")
    console.log("")
    printDottedLine();
}

// Parse only <string> elements from strings.xml, skipping translatable="false"
function parseStringsXml(content) {
    const result = {};
    const regex = /<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        const attrs = match[2];
        if (attrs.includes('translatable="false"')) continue;
        result[match[1]] = unescapeAndroid(match[3]);
    }
    return result;
}

// Remove a <string name="key">...</string> element from XML content
function removeStringElement(content, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`[ \\t]*<string\\s+name="${escaped}"[^>]*>[\\s\\S]*?<\\/string>[ \\t]*\\n?`, 'g');
    return content.replace(regex, '');
}

// Append new <string> elements before </resources>
function addStringElements(content, stringsToAdd) {
    const lines = stringsToAdd.map(({ name, value, comment }) => {
        return `    <!-- ${comment} -->\n    <string name="${name}">${escapeAndroid(value)}</string>`;
    });
    const insertion = '\n' + lines.join('\n') + '\n';
    return content.replace(/(\s*<\/resources>)/, insertion + '$1');
}

function escapeAndroid(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"');
}

function unescapeAndroid(text) {
    return text
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

// Convert Android locale codes to standard ISO codes for language name lookup
// e.g. zh-rCN → zh-CN, pt-rBR → pt-BR
function androidLangCodeToIso(code) {
    return code.replace(/-r([A-Z]{2})$/, '-$1');
}

function getLanguageName(code) {
    const languageMap = {
        'ar': 'Arabic',
        'bg': 'Bulgarian',
        'ca': 'Catalan',
        'cs': 'Czech',
        'da': 'Danish',
        'de': 'German',
        'el': 'Greek',
        'en': 'English',
        'es': 'Spanish',
        'fi': 'Finnish',
        'fr': 'French',
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
        'pt': 'Portuguese',
        'pt-BR': 'Portuguese (Brazil)',
        'ro': 'Romanian',
        'ru': 'Russian',
        'sk': 'Slovak',
        'sv': 'Swedish',
        'th': 'Thai',
        'tr': 'Turkish',
        'uk': 'Ukrainian',
        'vi': 'Vietnamese',
        'zh': 'Chinese (Simplified)',
        'zh-CN': 'Chinese (Simplified)',
        'zh-TW': 'Chinese (Traditional)',
        'zh-Hans': 'Chinese (Simplified)',
        'zh-Hant': 'Chinese (Traditional)'
    };

    return languageMap[code] || code;
}

async function translateText(text, targetLanguage, apiKey) {
    const openai = new OpenAI({ apiKey });

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a professional translator. Translate the given text to ${targetLanguage}. Keep the same tone, style, and formatting. For Android app strings, maintain technical accuracy and appropriate length for UI elements. Return only the translated text, nothing else.`
                },
                {
                    role: "user",
                    content: text
                }
            ],
            max_tokens: 500,
            temperature: 0.3
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.log("Translation error:", error.message);
        return null;
    }
}

function printDottedLine() {
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=");
}
