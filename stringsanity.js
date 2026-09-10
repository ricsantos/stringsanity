#!/usr/bin/env node
// Interactive wizard: asks which platform / project / key / options to use,
// then spawns the matching cli-*.js with the right arguments and OPENAI_API_KEY.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { select, input, checkbox, confirm } = require('@inquirer/prompts');

const ROOT = __dirname;
const PROJECTS_FILE = path.join(ROOT, 'projects.json');
const KEY_PREFIX = 'OPENAI_API_KEY_';

const PLATFORMS = {
    ios:     { cli: 'cli-ios.js',     hint: 'Resources dir containing *.lproj',           defaults: ['--translate', '--no-comment'] },
    android: { cli: 'cli-android.js', hint: 'res dir containing values-*/strings.xml',    defaults: ['--translate'] },
    react:   { cli: 'cli-react.js',   hint: 'locales dir containing <lang>/<ns>.json',    defaults: ['--translate'] },
};

// Flags the wizard offers per platform. Value flags (--language etc.) prompt for a value afterwards.
const OPTIONS = {
    common: [
        { value: '--translate',    name: '--translate     fill missing entries via OpenAI' },
        { value: '--remove-extra', name: '--remove-extra  DELETE keys not present in base' },
        { value: '--language',     name: '--language      restrict to one locale', takesValue: 'language code (e.g. fr, de, zh-Hans)' },
    ],
    ios: [
        { value: '--no-comment',   name: '--no-comment    skip UNTRANSLATED / Translated-by comments' },
    ],
    react: [
        { value: '--namespace',     name: '--namespace     restrict to one namespace', takesValue: 'namespace (e.g. common)' },
        { value: '--base-language', name: '--base-language override base of en-US',   takesValue: 'base language (e.g. en-GB)' },
    ],
};

main().catch(err => {
    if (err && err.name === 'ExitPromptError') { process.exit(130); }
    console.error(err.message || err);
    process.exit(1);
});

async function main() {
    const store = loadStore();
    const last = store.projects.find(p => p.name === store.lastProject) || null;

    // 1. Platform
    const platform = await select({
        message: 'Platform',
        choices: Object.keys(PLATFORMS).map(p => ({ value: p, name: p })),
        default: last ? last.platform : 'ios',
    });

    // 2. Project
    const project = await pickProject(store, platform, last);

    // 3. Options
    const optionDefs = OPTIONS.common.concat(OPTIONS[platform] || []);
    const savedDefaults = project.defaults || PLATFORMS[platform].defaults;
    const chosen = await checkbox({
        message: 'Options (space to toggle, enter to accept)',
        choices: optionDefs.map(o => ({ value: o.value, name: o.name, checked: savedDefaults.includes(o.value) })),
    });

    const args = [project.path];
    for (const def of optionDefs) {
        if (!chosen.includes(def.value)) continue;
        args.push(def.value);
        if (def.takesValue) {
            args.push(await input({ message: def.takesValue, validate: v => v.trim() !== '' || 'Required' }));
        }
    }

    // 4. OpenAI key (only needed for --translate)
    let keyName = null;
    if (chosen.includes('--translate')) {
        keyName = await pickKey(project.key);
        project.key = keyName;
    }

    // 5. Guard the destructive flag
    if (chosen.includes('--remove-extra')) {
        const ok = await confirm({ message: '--remove-extra deletes keys from translated files. Continue?', default: false });
        if (!ok) { console.log('Aborted.'); return; }
    }

    // Remember the boolean flags (not --remove-extra, not value flags) as this project's defaults.
    project.defaults = chosen.filter(v => v !== '--remove-extra' && !optionDefs.find(d => d.value === v && d.takesValue));
    store.lastProject = project.name;
    saveStore(store);

    const cli = path.join(ROOT, PLATFORMS[platform].cli);
    const env = Object.assign({}, process.env);
    if (keyName) env.OPENAI_API_KEY = process.env[keyName];

    console.log('');
    console.log('$ ' + [cli].concat(args).map(quote).join(' ') + (keyName ? '   # OPENAI_API_KEY=$' + keyName : ''));
    console.log('');

    const child = spawn(process.execPath, [cli].concat(args), { stdio: 'inherit', env });
    child.on('exit', code => process.exit(code == null ? 1 : code));
}

async function pickProject(store, platform, last) {
    const NEW = '__new__';
    const candidates = store.projects.filter(p => p.platform === platform);
    let choice = NEW;
    if (candidates.length > 0) {
        choice = await select({
            message: 'Project',
            choices: candidates
                .map(p => ({ value: p.name, name: p.name, description: p.path }))
                .concat([{ value: NEW, name: '+ paste a new path' }]),
            default: last && last.platform === platform ? last.name : candidates[0].name,
        });
    }
    if (choice !== NEW) return store.projects.find(p => p.name === choice);

    const dir = await input({
        message: 'Path (' + PLATFORMS[platform].hint + ')',
        validate: v => isDir(expand(v)) || 'Not a directory: ' + expand(v),
    });
    const absPath = path.resolve(expand(dir));
    const name = await input({
        message: 'Name for this project',
        default: suggestName(absPath),
        validate: v => {
            if (v.trim() === '') return 'Required';
            if (store.projects.find(p => p.name === v.trim())) return 'Name already used';
            return true;
        },
    });
    const project = { name: name.trim(), platform, path: absPath, key: null, defaults: PLATFORMS[platform].defaults.slice() };
    store.projects.push(project);
    return project;
}

async function pickKey(preferred) {
    const names = Object.keys(process.env).filter(k => k.startsWith(KEY_PREFIX) && process.env[k]).sort();
    if (names.length === 0) {
        if (process.env.OPENAI_API_KEY) {
            console.log('No ' + KEY_PREFIX + '* entries in .env; using plain OPENAI_API_KEY.');
            return 'OPENAI_API_KEY';
        }
        throw new Error('No OpenAI key found. Add OPENAI_API_KEY_<NAME>=sk-... lines to ' + path.join(ROOT, '.env'));
    }
    if (names.length === 1) return names[0];
    return select({
        message: 'OpenAI key',
        choices: names.map(n => ({ value: n, name: n.slice(KEY_PREFIX.length), description: n + '=' + mask(process.env[n]) })),
        default: preferred && names.includes(preferred) ? preferred : names[0],
    });
}

function loadStore() {
    try {
        const data = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
        return { lastProject: data.lastProject || null, projects: Array.isArray(data.projects) ? data.projects : [] };
    } catch (e) {
        return { lastProject: null, projects: [] };
    }
}

function saveStore(store) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(store, null, 2) + '\n');
}

function expand(p) {
    return p.trim().replace(/^~(?=$|\/)/, process.env.HOME || '~');
}

function isDir(p) {
    try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

function suggestName(absPath) {
    // Use the first path segment that is not a generic locale-folder name.
    const generic = new Set(['resources', 'res', 'locales', 'main', 'src', 'app']);
    const parts = absPath.split(path.sep).filter(Boolean).reverse();
    return (parts.find(p => !generic.has(p.toLowerCase())) || parts[0] || 'project').toLowerCase();
}

function mask(key) {
    return key.length > 10 ? key.slice(0, 7) + '…' + key.slice(-4) : '…';
}

function quote(s) {
    return /[\s"'$]/.test(s) ? "'" + s.replace(/'/g, "'\\''") + "'" : s;
}
