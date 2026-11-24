#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { translateMany, isStopped } = require('./translate');
var i18nStringsFiles = require('i18n-strings-files');

// https://x-team.com/blog/a-guide-to-creating-a-nodejs-command/

const [,, ...args] = process.argv

run(args).catch(error => {
    console.log("");
    console.log("✗ " + error.message);
    console.log("Stopped. Files still waiting for translations were not written. Fix the problem and run again.");
    process.exitCode = 1;
});

async function run(args) {
    printDottedLine();
    console.log("")
    console.log("StringSanity - " + Date())
    console.log("")
    printDottedLine();
    console.log("")

    if (args.length < 1) {
        console.log("Usage: ./cli-ios.js <project-strings-directory> [--remove-extra] [--translate] [--language <code>] [--no-comment] [--context <file>]");
        console.log("Example: ./cli-ios.js ../ios-app/Resources");
        console.log("         ./cli-ios.js ../ios-app/Resources --remove-extra");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate");
        console.log("         ./cli-ios.js ../ios-app/Resources --remove-extra --translate");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate --language fr");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate --no-comment");
        console.log("         ./cli-ios.js ../ios-app/Resources --translate --context translator-notes.md");
        console.log("");
        console.log("--translate requires OPENAI_API_KEY environment variable");
        console.log("--language <code> restricts processing to a single .lproj (e.g. fr, de, zh-Hans)");
        console.log("--no-comment skips writing 'UNTRANSLATED' / 'Translated by Stringsanity' comments on new entries");
        console.log("--context <file> adds app-wide translator notes (glossary, do-not-translate terms) to every translation");
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
    let contextIndex = args.indexOf('--context');
    let contextFile = contextIndex >= 0 ? args[contextIndex + 1] : null;
    if (contextIndex >= 0 && !contextFile) {
        console.log("Error: --context requires a file path (e.g. --context translator-notes.md)");
        return;
    }
    let appContext = contextFile ? fs.readFileSync(contextFile, 'utf8').trim() : null;

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

    if (appContext) {
        console.log("Context: " + contextFile + " (" + appContext.length + " chars)");
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

    // Pass 1: read every (strings file, language) pair and list its missing keys
    let jobs = [];
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

            // Check for extra strings that exist in this language but not in base
            let extraKeys = Object.keys(langData).filter(key => !baseKeys.includes(key));
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

            let missing = [];
            for (let key of baseKeys) {
                if (langData[key] != null) { continue }
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
                missing.push({ key: key, text: baseValue, context: originalComment });
            }

            jobs.push({ language, stringsFilename, langStringsPath, langData, baseKeys, extraStringCount: extraKeys.length, missing });
        }
    }

    // Pass 2: translate all pairs concurrently, then write each file when its translations are complete
    console.log("");
    printDottedLine();
    await Promise.all(jobs.map(async job => {
        let translations = new Map();
        if (translate && job.missing.length > 0) {
            translations = await translateMany(job.missing, getLanguageName(job.language), {
                platformHint: "For iOS/mobile app strings, maintain technical accuracy and appropriate length for UI elements.",
                appContext: appContext,
                label: job.language + " " + job.stringsFilename
            });
        }
        if (isStopped()) { return }
        totalAddedStrings += writeJob(job, translations);
        processedLanguages.add(job.language);
        processedCount += 1;
    }));

    function writeJob(job, translations) {
        let { language, stringsFilename, langStringsPath, langData, baseKeys, extraStringCount } = job;
        console.log("");
        console.log("Writing " + language + " " + stringsFilename);

        for (let { key, text: baseValue } of job.missing) {
            let translatedValue = baseValue;
            let comment = "UNTRANSLATED";

            if (translate) {
                let result = translations.get(key);
                if (result && result !== baseValue) {
                    console.log("✓ " + key + ": '" + result + "'");
                    translatedValue = result;
                    comment = "Translated by Stringsanity";
                } else if (!result) {
                    console.log("✗ " + key + ": no translation returned, using English");
                } else {
                    console.log("✓ " + key + ": matches English value (universal term, no translation needed)");
                    comment = "Translated by Stringsanity";
                }
            } else {
                console.log("Adding English value for " + key + ": '" + baseValue + "'");
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
        }

        // Always sort and rewrite the file to ensure alphabetical order
        let sortedLangData = {};
        Object.keys(langData).sort().forEach(key => {
            sortedLangData[key] = langData[key];
        });

        let addedStringCount = job.missing.length;
        if (addedStringCount > 0) {
            console.log("Added " + addedStringCount + " strings for language " + language + " (" + stringsFilename + ")");
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
        return addedStringCount;
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
        'az': 'Azerbaijani',
        'bg': 'Bulgarian', 
        'ca': 'Catalan',
        'cs': 'Czech',
        'da': 'Danish',
        'de': 'German',
        'el': 'Greek',
        'en': 'English',
        'es': 'Spanish',
        'es-419': 'Spanish (Latin America)',
        'fi': 'Finnish',
        'fr': 'French',
        'he': 'Hebrew',
        'hi': 'Hindi',
        'hr': 'Croatian',
        'hu': 'Hungarian',
        'id': 'Indonesian',
        'it': 'Italian',
        'ja': 'Japanese',
        'kk': 'Kazakh',
        'ko': 'Korean',
        'lt': 'Lithuanian',
        'ms': 'Malay',
        'nb': 'Norwegian Bokmål',
        'nl': 'Dutch',
        'no': 'Norwegian',
        'pl': 'Polish',
        'pt': 'Portuguese',
        'pt-BR': 'Portuguese (Brazil)',
        'pt-PT': 'Portuguese (Portugal)',
        'ro': 'Romanian',
        'ru': 'Russian',
        'sk': 'Slovak',
        'sl': 'Slovenian',
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

function printDottedLine() {
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=" );
}