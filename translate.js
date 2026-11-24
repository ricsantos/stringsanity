// Shared OpenAI translation for cli-ios.js, cli-android.js and cli-react.js.
//
// translateMany() sends up to BATCH_SIZE strings in one request and asks for a
// JSON reply. Every request in the process goes through one limiter, so a CLI
// can start all of its files at once and still make at most CONCURRENCY calls.
// The first API error (after the SDK's own retries) stops every queued request.
const OpenAI = require('openai');

const MODEL = 'gpt-6.1-sol';
const BATCH_SIZE = 40;
const CONCURRENCY = 8;

// printf-style (%@, %d, %1$s, %.2f, %lld, %%) and i18next ({{name}}) placeholders
const PLACEHOLDER = /%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.\d+)?(?:hh|h|ll|l|q|L|z|t|j)?[@dDiuUxXoOeEfFgGcCsSaAp%]|\{\{[^}]+\}\}/g;

const RESPONSE_FORMAT = {
    type: 'json_schema',
    json_schema: {
        name: 'translations',
        strict: true,
        schema: {
            type: 'object',
            properties: {
                translations: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            text: { type: 'string' }
                        },
                        required: ['id', 'text'],
                        additionalProperties: false
                    }
                }
            },
            required: ['translations'],
            additionalProperties: false
        }
    }
};

let client = null;
let stopError = null;
let active = 0;
const queue = [];
const cache = new Map();

// items: [{ key, text, context? }] → Map(key → translation, or '' when the model gave none)
async function translateMany(items, targetLanguage, options = {}) {
    const { platformHint = '', appContext = null, label = targetLanguage } = options;
    const results = new Map();

    // Translate each distinct (text, context) once, and reuse results from earlier files
    const pending = new Map();
    for (const item of items) {
        const id = targetLanguage + '\u0000' + item.text + '\u0000' + (item.context || '');
        if (cache.has(id)) {
            results.set(item.key, cache.get(id));
            continue;
        }
        if (!pending.has(id)) {
            pending.set(id, { id, text: item.text, context: item.context, keys: [] });
        }
        pending.get(id).keys.push(item.key);
    }

    const entries = [...pending.values()];
    if (entries.length === 0) return results;

    const systemPrompt = buildSystemPrompt(targetLanguage, platformHint, appContext);
    const batches = [];
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        batches.push(entries.slice(i, i + BATCH_SIZE));
    }

    console.log("  [" + label + "] Translating " + entries.length + " strings to " + targetLanguage + " in " + batches.length + " request(s)...");
    let done = 0;
    await Promise.all(batches.map(async batch => {
        const translated = await translateBatch(batch, systemPrompt, label);
        for (const entry of batch) {
            const value = translated.get(entry.id) || '';
            if (value) cache.set(entry.id, value);
            for (const key of entry.keys) results.set(key, value);
        }
        done += batch.length;
        console.log("  [" + label + "] " + done + "/" + entries.length + " translated");
    }));

    return results;
}

function isStopped() {
    return stopError != null;
}

// Returns Map(entry.id → translated text). Entries the model could not translate are absent.
async function translateBatch(batch, systemPrompt, label) {
    const reply = await limit(() => requestTranslations(batch, systemPrompt));

    if (reply == null) {
        // Truncated, refused, or not valid JSON: split the batch and try again
        if (batch.length === 1) {
            console.log("  [" + label + "] ✗ No usable reply for '" + batch[0].text + "'");
            return new Map();
        }
        const mid = Math.ceil(batch.length / 2);
        const halves = await Promise.all([
            translateBatch(batch.slice(0, mid), systemPrompt, label),
            translateBatch(batch.slice(mid), systemPrompt, label)
        ]);
        return new Map([...halves[0], ...halves[1]]);
    }

    const out = new Map();
    const retry = [];
    batch.forEach((entry, i) => {
        const text = reply.get(String(i));
        if (!text || !text.trim()) {
            if (batch.length > 1) retry.push(entry);
            return;
        }
        if (!samePlaceholders(entry.text, text)) {
            if (batch.length > 1) {
                retry.push(entry);
                return;
            }
            console.log("  [" + label + "] ⚠️ Placeholders differ: '" + entry.text + "' → '" + text + "'");
        }
        out.set(entry.id, restoreWhitespace(entry.text, text));
    });

    // Give each missing or suspect entry one more try on its own
    const retried = await Promise.all(retry.map(entry => translateBatch([entry], systemPrompt, label)));
    for (const map of retried) {
        for (const [id, text] of map) out.set(id, text);
    }
    return out;
}

// Returns Map(id → text), or null when the reply is not usable. Throws on API errors.
async function requestTranslations(batch, systemPrompt) {
    const input = batch.map((entry, i) => {
        const item = { id: String(i), text: entry.text };
        if (entry.context && entry.context.trim().length > 0) item.context = entry.context;
        return item;
    });

    let response;
    try {
        response = await getClient().chat.completions.create({
            model: MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(input) }
            ],
            response_format: RESPONSE_FORMAT,
            max_completion_tokens: Math.min(32000, 1000 + batch.length * 400),
        });
    } catch (error) {
        // Stop the whole run: falling back to English would write a file full of UNTRANSLATED entries
        throw new Error("Translation failed: " + error.message);
    }

    const choice = response.choices[0];
    if (!choice || choice.finish_reason !== 'stop' || !choice.message.content) return null;
    try {
        const parsed = JSON.parse(choice.message.content);
        return new Map(parsed.translations.map(t => [t.id, t.text]));
    } catch (error) {
        return null;
    }
}

function buildSystemPrompt(targetLanguage, platformHint, appContext) {
    let prompt = `You are a professional translator. Translate each string to ${targetLanguage}. Keep the same tone, style, and formatting. ${platformHint}
Keep placeholders (such as %@, %d, %1$s, {{name}}), escape sequences, and markup exactly as they are. Use the same translation for the same term in every string.
The input is a JSON array of objects with "id", "text", and an optional "context" that describes the string. Do not translate the context.
Return one entry for every id, with "text" set to the translation only.`;
    if (appContext) {
        prompt += `\n\nNotes about this app:\n${appContext}`;
    }
    return prompt;
}

function samePlaceholders(source, translation) {
    const list = s => (s.match(PLACEHOLDER) || []).sort().join('\u0000');
    return list(source) === list(translation);
}

// Keep the source's leading/trailing whitespace (e.g. "Tip: " is followed by more text)
function restoreWhitespace(source, translation) {
    const leading = source.match(/^\s*/)[0];
    const trailing = source.match(/\s*$/)[0];
    return leading + translation.trim() + trailing;
}

function getClient() {
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 5 });
    }
    return client;
}

function limit(fn) {
    return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        pump();
    });
}

function pump() {
    while (active < CONCURRENCY && queue.length > 0) {
        const { fn, resolve, reject } = queue.shift();
        if (stopError) {
            reject(stopError);
            continue;
        }
        active++;
        fn()
            .then(resolve, error => {
                stopError = stopError || error;
                reject(error);
            })
            .finally(() => {
                active--;
                pump();
            });
    }
}

module.exports = { translateMany, isStopped };
