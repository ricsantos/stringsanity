#!/usr/bin/env node
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

    if (args.length < 1 || args.length > 3) {
        console.log("Usage: ./cli.js <project-strings-directory> [--remove-extra] [--translate]");
        console.log("Example: ./cli.js ../ios-app/Resources");
        console.log("         ./cli.js ../ios-app/Resources --remove-extra");
        console.log("         ./cli.js ../ios-app/Resources --translate");
        console.log("         ./cli.js ../ios-app/Resources --remove-extra --translate");
        console.log("");
        console.log("--translate requires OPENAI_API_KEY environment variable");
        return;
    }

    let projectDir = args[0];
    let removeExtra = args.includes('--remove-extra');
    let translate = args.includes('--translate');
    
    console.log("Project strings directory: " + projectDir);
    if (removeExtra) {
        console.log("Mode: Remove extra strings not in base language");
    } else {
        console.log("Mode: Report extra strings (use --remove-extra to remove them)");
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
    // Use standard Localizable.strings filename
    let stringsFilename = "Localizable.strings";
    console.log("Strings filename: " + stringsFilename);
    let baseStringsPath = baseDir + "/" + stringsFilename
    console.log("Base strings path: " + baseStringsPath);

    // Read the base strings file to get the canonical list of all strings
    let baseData = i18nStringsFiles.readFileSync(baseStringsPath, { 'encoding': 'UTF-8', 'wantsComments': true });
    let baseKeys = Object.keys(baseData).sort(); // Sort alphabetically
    console.log("Base language has " + baseKeys.length + " keys");

    var processedCount = 0;
    var totalAddedStrings = 0;

    for (let i = 0; i < projectDirObj.length; i++) {
        let folderName = projectDirObj[i];
        if (folderName.endsWith(".lproj") == false) { continue }
        if (folderName == "Base.lproj" || folderName == "en.lproj") { continue }

        let language = folderName.replace(".lproj", "")
        console.log("");
        console.log("Processing language: " + language);

        let langStringsPath = projectDir + "/" + folderName + "/" + stringsFilename;
        console.log("Language strings path: " + langStringsPath);
        
        let langData = {};
        try {
            langData = i18nStringsFiles.readFileSync(langStringsPath, { 'encoding': 'UTF-8', 'wantsComments': true });
        } catch (err) {
            console.log("Warning: unable to read " + language + " strings file, skipping");
            continue;
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
            if (typeof baseData[key] === 'object') {
                baseValue = baseData[key].text || baseData[key].value || baseData[key];
            } else {
                baseValue = baseData[key];
            }
            
            let translatedValue = baseValue;
            let comment = "UNTRANSLATED";
            
            if (translate) {
                let fullLanguageName = getLanguageName(language);
                console.log("Translating '" + baseValue + "' to " + fullLanguageName + " (" + language + ")...");
                translatedValue = await translateText(baseValue, fullLanguageName, process.env.OPENAI_API_KEY);
                
                if (translatedValue && translatedValue !== baseValue) {
                    console.log("Translation: '" + translatedValue + "'");
                    comment = "Translated by Stringsanity";
                } else {
                    console.log("Translation failed, using English value");
                    translatedValue = baseValue;
                }
            } else {
                console.log("Adding English value: '" + baseValue + "'");
            }
            
            // Add the translated or English value
            langData[key] = {
                text: translatedValue,
                comment: comment
            };
            addedStringCount += 1;
        }

        // Always sort and rewrite the file to ensure alphabetical order
        let sortedLangData = {};
        Object.keys(langData).sort().forEach(key => {
            sortedLangData[key] = langData[key];
        });
        
        if (addedStringCount > 0) {
            console.log("Added " + addedStringCount + " untranslated strings for language " + language);
            totalAddedStrings += addedStringCount;
        }
        
        // Write the sorted file (always rewrite to maintain alphabetical order)
        i18nStringsFiles.writeFileSync(langStringsPath, sortedLangData, { 'encoding': 'UTF-8', 'wantsComments': true });
        
        let updatedLangKeys = Object.keys(langData);
        if (updatedLangKeys.length == baseKeys.length) {
            console.log("✓ Language " + language + " now has all " + baseKeys.length + " strings");
        } else if (updatedLangKeys.length > baseKeys.length) {
            console.log("WARNING: ⚠️ language " + language + " has " + updatedLangKeys.length + "/" + baseKeys.length + " strings (" + extraStringCount + " extra)");
        } else {
            console.log("WARNING: ⚠️ language " + language + " has " + updatedLangKeys.length + "/" + baseKeys.length + " strings (missing " + (baseKeys.length - updatedLangKeys.length) + ")");
        }

        processedCount += 1;
    }

    console.log("")
    console.log("")
    console.log("Completed!")
    console.log("Processed " + processedCount + " languages");
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

async function translateText(text, targetLanguage, apiKey) {
    const openai = new OpenAI({ apiKey: apiKey });
    
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a professional translator. Translate the given text to ${targetLanguage}. Keep the same tone, style, and formatting. For iOS/mobile app strings, maintain technical accuracy and appropriate length for UI elements. Return only the translated text, nothing else.`
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
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=" );
}