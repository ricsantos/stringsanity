#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const OpenAI = require('openai');
var i18nStringsFiles = require('i18n-strings-files');

// https://x-team.com/blog/a-guide-to-creating-a-nodejs-command/

const [,, ...args] = process.argv

run(args)

async function run(args) {
    printDottedLine();
    console.log("")
    console.log("StringSanity - " + Date())
    console.log("")
    printDottedLine();
    console.log("")

    if (args.length < 1) {
        console.log("Usage: ./cli-ios.js <project-strings-directory> [--remove-extra] [--translate] [--language <code>] [--no-comment]");
        console.log("Example: ./cli-ios.js ../ios-app/Resources");
        console.log("         ./cli-ios.js ../ios-app/Resources --remove-extra");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate");
        console.log("         ./cli-ios.js ../ios-app/Resources --remove-extra --translate");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate --language fr");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate --no-comment");
        console.log("");
        console.log("--translate requires OPENAI_API_KEY environment variable");
        console.log("--language <code> restricts processing to a single .lproj (e.g. fr, de, zh-Hans)");
        console.log("--no-comment skips writing 'UNTRANSLATED' / 'Translated by Stringsanity' comments on new entries");
        return;
    }

    let projectDir = args[0];
    let removeExtra = args.includes('--remove-extra');
    let translate = args.includes('--translate');
    let noComment = args.includes('--no-comment');
    let languageIndex = args.indexOf('--language');
    let languageFilter = languageIndex >= 0 ? args[languageIndex + 1] : null;
    if (languageIndex >= 0 && !languageFilter) {
        console.log("Error: --language requires a language code (e.g. --language fr)");
        return;
    }

    console.log("Project strings directory: " + projectDir);
    if (removeExtra) {
        console.log("Mode: Remove extra strings not in base language");
    } else {
        console.log("Mode: Report extra strings (use --remove-extra to remove them)");
    }

    if (languageFilter) {
        console.log("Language filter: only processing '" + languageFilter + "'");
    }

    if (noComment) {
        console.log("Comments: Disabled (no comments will be written for new entries)");
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

    let projectDirObj = fs.readdirSync(projectDir);
    console.log("Project dir contents: " + JSON.stringify(projectDirObj, null, 2));

    let baseDir = projectDir + "/" + "Base.lproj"
    console.log("Base dir: " + baseDir);
    let baseDirObj = null;
    try {
        baseDirObj = fs.readdirSync(baseDir);
    } catch (error) {
        console.log("Unable to read Base.lproj - falling back to en.lproj")
        baseDir = projectDir + "/" + "en.lproj"
        try {
            baseDirObj = fs.readdirSync(baseDir);
        } catch (error2) {
            console.log("Error: Unable to find Base.lproj or en.lproj directory");
            return;
        }
    }
    
    console.log("Base dir contents: " + JSON.stringify(baseDirObj, null, 2));
    // Process every .strings file found in the base lproj (e.g. Localizable.strings, InfoPlist.strings)
    let stringsFilenames = baseDirObj.filter(name => name.endsWith(".strings")).sort();
    if (stringsFilenames.length == 0) {
        console.log("Error: no .strings files found in " + baseDir);
        return;
    }
    console.log("Strings files: " + stringsFilenames.join(", "));

    var processedCount = 0;
    var totalAddedStrings = 0;
    let processedLanguages = new Set();

    for (let f = 0; f < stringsFilenames.length; f++) {
        let stringsFilename = stringsFilenames[f];
        console.log("");
        printDottedLine();
        console.log("Strings filename: " + stringsFilename);
        let baseStringsPath = baseDir + "/" + stringsFilename
        console.log("Base strings path: " + baseStringsPath);

        // Read the base strings file to get the canonical list of all strings
        let baseData = i18nStringsFiles.readFileSync(baseStringsPath, { 'encoding': 'UTF-8', 'wantsComments': true });
        let baseKeys = Object.keys(baseData).sort(); // Sort alphabetically
        console.log("Base language has " + baseKeys.length + " keys");

        for (let i = 0; i < projectDirObj.length; i++) {
            let folderName = projectDirObj[i];
            if (folderName.endsWith(".lproj") == false) { continue }
            if (folderName == "Base.lproj" || folderName == "en.lproj") { continue }

            let language = folderName.replace(".lproj", "")
            if (languageFilter && language !== languageFilter) { continue }
            console.log("");
            console.log("Processing language: " + language);

            let langStringsPath = projectDir + "/" + folderName + "/" + stringsFilename;
            console.log("Language strings path: " + langStringsPath);

            let langData = {};
            if (fs.existsSync(langStringsPath)) {
                try {
                    langData = i18nStringsFiles.readFileSync(langStringsPath, { 'encoding': 'UTF-8', 'wantsComments': true });
                } catch (err) {
                    console.log("Warning: unable to read " + language + " " + stringsFilename + ", skipping");
                    continue;
                }
            } else {
                console.log("File does not exist yet, will create it");
            }

            var addedStringCount = 0;
            var extraStringCount = 0;

            // Check for extra strings that exist in this language but not in base
            let langKeys = Object.keys(langData);
            let extraKeys = [];
            for (let k = 0; k < langKeys.length; k++) {
                let langKey = langKeys[k];
                if (!baseKeys.includes(langKey)) {
                    extraKeys.push(langKey);
                    extraStringCount++;
                }
            }
            
            if (extraKeys.length > 0) {
                console.log("Found " + extraKeys.length + " extra strings not in base language:");
                extraKeys.forEach(key => {
                    console.log("  - " + key);
                    if (removeExtra) {
                        delete langData[key];
                    }
                });
                
                if (removeExtra) {
                    console.log("Removed " + extraKeys.length + " extra strings");
                } else {
                    console.log("Use --remove-extra flag to remove these strings");
                }
            }

            for (let j = 0; j < baseKeys.length; j++) {
                let key = baseKeys[j];
                let langValue = langData[key];
                if (langValue != null) { continue }
                
                console.log("Missing translation for key: " + key);
                
                // Extract the base value - the library uses 'text' property, not 'value'
                let baseValue;
                let originalComment;
                if (typeof baseData[key] === 'object') {
                    baseValue = baseData[key].text || baseData[key].value || baseData[key];
                    originalComment = baseData[key].comment;
                } else {
                    baseValue = baseData[key];
                    originalComment = undefined;
                }

                console.log("Original comment for key '" + key + "':", originalComment);

                let translatedValue = baseValue;
                let comment = "UNTRANSLATED";

                if (translate) {
                    let fullLanguageName = getLanguageName(language);
                    console.log("Translating '" + baseValue + "' to " + fullLanguageName + " (" + language + ")...");
                    translatedValue = await translateText(baseValue, fullLanguageName, process.env.OPENAI_API_KEY, originalComment);

                    console.log("Translation result: '" + translatedValue + "'");

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
                
                // Add the translated or English value
                if (noComment) {
                    langData[key] = { text: translatedValue };
                } else {
                    langData[key] = {
                        text: translatedValue,
                        comment: comment
                    };
                }
                addedStringCount += 1;
            }

            // Always sort and rewrite the file to ensure alphabetical order
            let sortedLangData = {};
            Object.keys(langData).sort().forEach(key => {
                sortedLangData[key] = langData[key];
            });
            
            if (addedStringCount > 0) {
                console.log("Added " + addedStringCount + " untranslated strings for language " + language + " (" + stringsFilename + ")");
                totalAddedStrings += addedStringCount;
            }

            // Write the sorted file (always rewrite to maintain alphabetical order)
            i18nStringsFiles.writeFileSync(langStringsPath, sortedLangData, { 'encoding': 'UTF-8', 'wantsComments': true });

            let updatedLangKeys = Object.keys(langData);
            if (updatedLangKeys.length == baseKeys.length) {
                console.log("✓ Language " + language + " now has all " + baseKeys.length + " strings in " + stringsFilename);
            } else if (updatedLangKeys.length > baseKeys.length) {
                console.log("WARNING: ⚠️ language " + language + " has " + updatedLangKeys.length + "/" + baseKeys.length + " strings in " + stringsFilename + " (" + extraStringCount + " extra)");
            } else {
                console.log("WARNING: ⚠️ language " + language + " has " + updatedLangKeys.length + "/" + baseKeys.length + " strings in " + stringsFilename + " (missing " + (baseKeys.length - updatedLangKeys.length) + ")");
            }

            processedLanguages.add(language);
            processedCount += 1;
        }
    }

    console.log("")
    console.log("")
    console.log("Completed!")
    console.log("Processed " + processedLanguages.size + " languages across " + stringsFilenames.length + " strings files");
    if (languageFilter && processedCount === 0) {
        console.log("WARNING: ⚠️ no .lproj folder matched --language '" + languageFilter + "'");
    }
    if (totalAddedStrings > 0) {
        console.log("Added " + totalAddedStrings + " untranslated strings across all languages");
        console.log("These strings are marked with 'UNTRANSLATED' comments and need translation.");
    } else {
        console.log("All languages already have complete translations! 🕺");
    }
    console.log("")
    console.log("")
    printDottedLine();   
}

function normalizeKey(key) {
    // Normalize common Unicode variations to standard ASCII
    return key
        .replace(/['']/g, "'")  // Replace curly apostrophes with straight apostrophe
        .replace(/[""]/g, '"')  // Replace curly quotes with straight quotes
        .replace(/[\u2013\u2014]/g, "-")  // Replace em/en dashes with hyphen
        .replace(/[\u2026]/g, "...") // Replace ellipsis with three dots
        .trim();                // Remove leading/trailing whitespace
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
        'zh-Hans': 'Chinese (Simplified)',
        'zh-Hant': 'Chinese (Traditional)'
    };
    
    return languageMap[code] || code;
}

async function translateText(text, targetLanguage, apiKey, context) {
    const openai = new OpenAI({ apiKey: apiKey });

    try {
        let systemPrompt = `You are a professional translator. Translate the given text to ${targetLanguage}. Keep the same tone, style, and formatting. For iOS/mobile app strings, maintain technical accuracy and appropriate length for UI elements. Return only the translated text, nothing else.`;

        let userContent = text;
        if (context && context.trim().length > 0) {
            userContent = `Context: ${context}\n\nText to translate: ${text}`;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-5.4",
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userContent
                }
            ],
            max_completion_tokens: 500,
            temperature: 0.3
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.log("Translation error:", error.message);
        return null;
    }
}

function printDottedLine() {
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=" );
}