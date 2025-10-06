#!/usr/bin/env node
const fs = require('fs');
//var StringsFile = require('strings-file');
var i18nStringsFiles = require('i18n-strings-files');

// https://x-team.com/blog/a-guide-to-creating-a-nodejs-command/

const [,, ...args] = process.argv

run(args)

function run(args) {
    printDottedLine();
    console.log("")
    console.log("StringSanity - " + Date())
    console.log("")
    printDottedLine();
    console.log("")

    if (args.length < 1 || args.length > 2) {
        console.log("Usage: ./cli.js <project-strings-directory> [--remove-extra]");
        console.log("Example: ./cli.js ../ios-app/Resources");
        console.log("         ./cli.js ../ios-app/Resources --remove-extra");
        return;
    }

    let projectDir = args[0];
    let removeExtra = args.length > 1 && args[1] === '--remove-extra';
    
    console.log("Project strings directory: " + projectDir);
    if (removeExtra) {
        console.log("Mode: Remove extra strings not in base language");
    } else {
        console.log("Mode: Report extra strings (use --remove-extra to remove them)");
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
            
            console.log("Adding English value: '" + baseValue + "'");
            
            // Add the English value with UNTRANSLATED comment using the same structure
            langData[key] = {
                text: baseValue,
                comment: "UNTRANSLATED"
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

function printDottedLine() {
    console.log("-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=" );
}