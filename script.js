// Referencias DOM
const inputText = document.getElementById('input-text');
const outputText = document.getElementById('output-text');
const sourceLang = document.getElementById('source-lang');
const targetLang = document.getElementById('target-lang');
const swapBtn = document.getElementById('swap-languages');
const charNum = document.getElementById('char-num');
const wordNum = document.getElementById('word-num');
const statusText = document.getElementById('status-text');
const statusLabel = document.getElementById('status-label') || statusText;

const btnListenInput = document.getElementById('btn-listen-input');
const btnListenOutput = document.getElementById('btn-listen-output');
const btnMic = document.getElementById('btn-mic');
const btnCopyInput = document.getElementById('btn-copy-input');
const btnCopyOutput = document.getElementById('btn-copy-output');
const btnClear = document.getElementById('btn-clear');
const btnClearOutput = document.getElementById('btn-clear-output');
const btnTools = document.getElementById('btn-tools');
const toolsMenu = document.getElementById('tools-menu');

const btnHistory = document.getElementById('btn-history');
const historyModal = document.getElementById('history-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnClearHistory = document.getElementById('btn-clear-history');
const historyList = document.getElementById('history-list');

const btnSpeedToggle = document.getElementById('btn-speed-toggle');
const speedLabel = document.getElementById('speed-label');
const btnFontInc = document.getElementById('btn-font-inc');
const btnFontDec = document.getElementById('btn-font-dec');
const toastMsg = document.getElementById('toast-msg');
const toastText = document.getElementById('toast-text');

// Estado global y memorias
let debounceTimer = null;
let detectedLanguageCode = 'es';
let isRecording = false;
let recognition = null;
let speechSpeed = 1.0;
let currentFontSize = 16;
let activeAbortController = null;
let preMicText = ''; 
let lastTrimmedText = ''; // Almacena el texto limpio anterior para no re-traducir con solo espacios

// Restaurar idiomas guardados
try {
    const savedSource = localStorage.getItem('neo_trans_source');
    const savedTarget = localStorage.getItem('neo_trans_target');
    if (savedSource && Array.from(sourceLang.options).some(o => o.value === savedSource)) {
        sourceLang.value = savedSource;
    }
    if (savedTarget && Array.from(targetLang.options).some(o => o.value === savedTarget)) {
        targetLang.value = savedTarget;
    }
} catch(e) {}

// Caché de traducciones e historial
const translationCache = new Map();
let translationHistory = [];
try {
    translationHistory = JSON.parse(localStorage.getItem('neo_trans_history') || '[]');
} catch(e) {
    translationHistory = [];
}

// API de Voz
const synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function setStatus(text, active = true) {
    if (statusLabel) statusLabel.textContent = text;
    if (active) statusText.classList.add('active');
    else statusText.classList.remove('active');
}

function showToast(msg) {
    toastText.textContent = msg;
    toastMsg.classList.add('show');
    setTimeout(() => toastMsg.classList.remove('show'), 2500);
}

// Persistir idioma seleccionado al cambiar
sourceLang.addEventListener('change', () => {
    try { localStorage.setItem('neo_trans_source', sourceLang.value); } catch(e) {}
    if (inputText.value.trim()) translateText();
});

targetLang.addEventListener('change', () => {
    try { localStorage.setItem('neo_trans_target', targetLang.value); } catch(e) {}
    if (inputText.value.trim()) translateText();
});

// INTERCAMBIO DE IDIOMAS (Funciona SIEMPRE, con o sin texto)
swapBtn.addEventListener('click', () => {
    let currentSource = sourceLang.value;
    let currentTarget = targetLang.value;

    if (currentSource === 'autodetect') {
        currentSource = detectedLanguageCode || 'es';
    }

    const canAssignSource = Array.from(sourceLang.options).some(o => o.value === currentTarget);
    const canAssignTarget = Array.from(targetLang.options).some(o => o.value === currentSource);

    if (canAssignSource) sourceLang.value = currentTarget;
    if (canAssignTarget) targetLang.value = currentSource;

    // Guardar los nuevos idiomas intercambiados
    try {
        localStorage.setItem('neo_trans_source', sourceLang.value);
        localStorage.setItem('neo_trans_target', targetLang.value);
    } catch(e) {}

    const currentInput = inputText.value;
    const currentOutput = outputText.value;

    if (currentOutput.trim()) {
        inputText.value = currentOutput;
        outputText.value = currentInput;
        lastTrimmedText = currentOutput.trim();
        updateCounters();
        translateText();
    } else if (inputText.value.trim()) {
        translateText();
    }
});

// Auto-puntuación
function applySmartPunctuation(str) {
    if (!str || !str.trim()) return str;

    let text = str.trim();
    text = text.charAt(0).toUpperCase() + text.slice(1);

    const connectorRegexEs = /\b(sin embargo|por lo tanto|además|por ejemplo|en efecto|por favor)\b(?!\s*,)/gi;
    text = text.replace(connectorRegexEs, '$1,');

    const connectorRegexEn = /\b(however|therefore|besides|for example|in fact|please)\b(?!\s*,)/gi;
    text = text.replace(connectorRegexEn, '$1,');

    const questionWordsEs = [
        'qué', 'que', 'cómo', 'como', 'cuándo', 'cuando', 'dónde', 'donde', 
        'por qué', 'porque', 'quién', 'quien', 'quiénes', 'quienes', 
        'cuál', 'cual', 'cuáles', 'cuales', 'cuánto', 'cuanto', 'cuántos', 
        'cuantas', 'para qué', 'acaso'
    ];

    const startsWithQuestionEs = questionWordsEs.some(q => 
        new RegExp('^' + q + '\\b', 'i').test(text) || 
        new RegExp('^¿\\s*' + q + '\\b', 'i').test(text)
    );

    if (startsWithQuestionEs) {
        if (!text.startsWith('¿')) text = '¿' + text;
        if (!text.endsWith('?') && !text.endsWith('.')) text += '?';
        else if (text.endsWith('.')) text = text.slice(0, -1) + '?';
    }

    const questionWordsEn = [
        'what', 'why', 'where', 'when', 'who', 'whom', 'how', 'which', 
        'can you', 'could you', 'would you', 'is it', 'are you', 'do you', 'does it'
    ];

    const startsWithQuestionEn = questionWordsEn.some(q => 
        new RegExp('^' + q + '\\b', 'i').test(text)
    );

    if (startsWithQuestionEn) {
        if (!text.endsWith('?') && !text.endsWith('.')) text += '?';
        else if (text.endsWith('.')) text = text.slice(0, -1) + '?';
    }

    return text;
}

// Speech Recognition Init
if (!SpeechRecognition) {
    btnMic.style.opacity = '0.4';
    btnMic.title = 'Reconocimiento de voz no soportado por este navegador';
} else {
    try {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;

        recognition.onstart = () => {
            isRecording = true;
            btnMic.classList.add('recording');
            preMicText = inputText.value.trim();
            showToast('Escuchando voz...');
        };

        recognition.onresult = (event) => {
            let transcriptResult = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                transcriptResult += event.results[i][0].transcript;
            }

            let combined = preMicText;
            if (combined && !combined.endsWith(' ') && transcriptResult) {
                combined += ' ';
            }
            combined += transcriptResult;

            inputText.value = combined;
            updateCounters();
            triggerDebouncedTranslate();
        };

        recognition.onerror = (e) => {
            isRecording = false;
            btnMic.classList.remove('recording');
            if (e.error === 'not-allowed') showToast('Permiso de micrófono denegado');
        };

        recognition.onend = () => {
            isRecording = false;
            btnMic.classList.remove('recording');
            if (inputText.value.trim()) {
                inputText.value = applySmartPunctuation(inputText.value);
                updateCounters();
                triggerDebouncedTranslate();
            }
        };
    } catch (err) {
        console.warn('SpeechRecognition Init Fallback:', err);
    }
}

function updateCounters() {
    const val = inputText.value;
    charNum.textContent = val.length;
    const words = val.trim() ? val.trim().split(/\s+/).length : 0;
    wordNum.textContent = words;
}

// CONTROLADOR DE DEBOUNCE - IGNORA SI SOLO CAMBIARON ESPACIOS
inputText.addEventListener('input', () => {
    updateCounters();
    
    const currentTrimmed = inputText.value.trim();
    
    // Si el texto con trim no cambia (solo agregaron/quitaron espacios en los extremos o dobles espacios internos)
    if (currentTrimmed === lastTrimmedText) {
        if (!currentTrimmed) {
            outputText.value = '';
            setStatus('Traduciendo...', false);
        }
        return; 
    }
    
    triggerDebouncedTranslate();
});

function triggerDebouncedTranslate() {
    clearTimeout(debounceTimer);
    const text = inputText.value;
    const currentTrimmed = text.trim();

    if (!currentTrimmed) {
        lastTrimmedText = '';
        outputText.value = '';
        setStatus('Traduciendo...', false);
        return;
    }

    setStatus('Pausando para traducir...', true);

    const len = currentTrimmed.length;
    let waitTime = 550; 
    if (len > 3000) waitTime = 1000;
    else if (len > 800) waitTime = 750;

    debounceTimer = setTimeout(() => {
        lastTrimmedText = currentTrimmed;
        translateText();
    }, waitTime);
}

// FETCH CON TIMEOUT
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const combinedSignal = options.signal ? 
            anySignal([options.signal, controller.signal]) : controller.signal;
        
        const response = await fetch(url, { ...options, signal: combinedSignal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

function anySignal(signals) {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort();
            return signal;
        }
        signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    return controller.signal;
}

// SPLIT DE TEXTO EN BLOQUES INTELIGENTES
function splitTextIntoChunks(text, maxChunkLen = 1200) {
    if (text.length <= maxChunkLen) return [text];

    const chunks = [];
    const lines = text.split(/(\r?\n)/);
    let currentChunk = "";

    for (let part of lines) {
        if ((currentChunk + part).length > maxChunkLen) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            if (part.length > maxChunkLen) {
                const sentences = part.match(/[^.!?;\n]+[.!?;\n]+|[^.!?;\n]+/g) || [part];
                for (let sentence of sentences) {
                    if ((currentChunk + sentence).length > maxChunkLen) {
                        if (currentChunk) chunks.push(currentChunk);
                        currentChunk = sentence;
                    } else {
                        currentChunk += sentence;
                    }
                }
            } else {
                currentChunk = part;
            }
        } else {
            currentChunk += part;
        }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks.length > 0 ? chunks : [text];
}

// MOTORES DE TRADUCCIÓN PARALELOS
async function translateSingleChunk(textChunk, sLang, tLang, signal) {
    const subCacheKey = `${sLang}|${tLang}|${textChunk}`;
    if (translationCache.has(subCacheKey)) {
        return translationCache.get(subCacheKey);
    }

    // Motor 1: Google GTX Endpoint
    try {
        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sLang}&tl=${tLang}&dt=t&dt=bd&dt=ex&dt=ld&dt=md&dt=qca&dt=rw&dt=rm&dt=ss&dt=at&q=${encodeURIComponent(textChunk)}`;
        const response = await fetchWithTimeout(gUrl, { signal }, 5000);
        if (response.ok) {
            const data = await response.json();
            if (data && data[0]) {
                const translated = data[0].map(item => item && item[0] ? item[0] : '').join('');
                if (data[2]) detectedLanguageCode = data[2].toLowerCase();
                if (translated) {
                    translationCache.set(subCacheKey, translated);
                    return translated;
                }
            }
        }
    } catch (e) {}

    // Motor 2: Google Chrome Client Fallback
    try {
        const gUrl2 = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=${sLang}&tl=${tLang}&dt=t&q=${encodeURIComponent(textChunk)}`;
        const response = await fetchWithTimeout(gUrl2, { signal }, 5000);
        if (response.ok) {
            const data = await response.json();
            if (data && data[0]) {
                const translated = data[0].map(item => item && item[0] ? item[0] : '').join('');
                if (translated) {
                    translationCache.set(subCacheKey, translated);
                    return translated;
                }
            }
        }
    } catch (e) {}

    // Motor 3: Lingva Mirror API
    try {
        const lUrl = `https://lingva.ml/api/v1/${sLang}/${tLang}/${encodeURIComponent(textChunk)}`;
        const response = await fetchWithTimeout(lUrl, { signal }, 5000);
        if (response.ok) {
            const data = await response.json();
            if (data && data.translation) {
                translationCache.set(subCacheKey, data.translation);
                return data.translation;
            }
        }
    } catch (e) {}

    // Motor 4: MyMemory
    try {
        const pair = (sLang === 'auto') ? `Autodetect|${tLang}` : `${sLang}|${tLang}`;
        const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textChunk)}&langpair=${pair}`;
        const response = await fetchWithTimeout(mUrl, { signal }, 6000);
        const data = await response.json();
        if (data.responseData && data.responseData.translatedText) {
            const resText = data.responseData.translatedText;
            translationCache.set(subCacheKey, resText);
            return resText;
        }
    } catch (e) {}

    throw new Error("No network engine responded");
}

// MOTOR PRINCIPAL CON GESTIÓN DE ABORTO
async function translateText() {
    const text = inputText.value;
    if (!text || !text.trim()) return;

    const sLang = sourceLang.value === 'autodetect' ? 'auto' : sourceLang.value;
    const tLang = targetLang.value;
    const cacheKey = `${sLang}|${tLang}|${text.trim()}`;

    if (translationCache.has(cacheKey)) {
        outputText.value = translationCache.get(cacheKey);
        setStatus('Traduciendo...', false);
        return;
    }

    setStatus('Traduciendo...', true);

    if (activeAbortController) {
        activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    try {
        const chunks = splitTextIntoChunks(text, 1200);
        const translatedChunks = [];

        for (let i = 0; i < chunks.length; i++) {
            if (signal.aborted) return;
            
            if (chunks.length > 1) {
                setStatus(`Traduciendo (${i + 1}/${chunks.length})...`, true);
            }

            const translatedPart = await translateSingleChunk(chunks[i], sLang, tLang, signal);
            translatedChunks.push(translatedPart);
        }

        if (signal.aborted) return;

        const fullTranslation = translatedChunks.join('');
        outputText.value = fullTranslation;
        translationCache.set(cacheKey, fullTranslation);
        saveToHistory(text, fullTranslation, sLang, tLang);

    } catch (error) {
        if (error.name !== 'AbortError') {
            if (!navigator.onLine) {
                outputText.value = "[Modo Sin Conexión] Sin acceso a la red de traducción.";
                showToast("Comprueba tu conexión a internet");
            } else {
                outputText.value = "Error al conectar con los motores. Reintentando...";
            }
        }
    } finally {
        if (!signal.aborted) {
            setStatus('Traduciendo...', false);
        }
    }
}

// SÍNTESIS DE VOZ
function speakText(text, langCode, buttonElement) {
    if (!text || !text.trim()) {
        showToast("No hay texto para escuchar");
        return;
    }

    if (!synth) {
        showToast("Síntesis de voz no disponible");
        return;
    }

    try {
        if (synth.speaking) synth.cancel();

        const targetLanguage = (langCode === 'autodetect' || langCode === 'auto') 
            ? (detectedLanguageCode || 'es') 
            : langCode;

        const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
        let currentSentenceIndex = 0;

        if (buttonElement) buttonElement.classList.add('active-speaking');

        function speakNextSentence() {
            if (currentSentenceIndex >= sentences.length) {
                if (buttonElement) buttonElement.classList.remove('active-speaking');
                return;
            }

            const sentenceText = sentences[currentSentenceIndex].trim();
            if (!sentenceText) {
                currentSentenceIndex++;
                speakNextSentence();
                return;
            }

            const utterance = new SpeechSynthesisUtterance(sentenceText);
            utterance.lang = targetLanguage;
            utterance.rate = speechSpeed;

            utterance.onend = () => {
                currentSentenceIndex++;
                speakNextSentence();
            };

            utterance.onerror = () => {
                if (buttonElement) buttonElement.classList.remove('active-speaking');
            };

            synth.speak(utterance);
        }

        speakNextSentence();

    } catch (e) {
        if (buttonElement) buttonElement.classList.remove('active-speaking');
    }
}

btnListenInput.addEventListener('click', () => speakText(inputText.value, sourceLang.value, btnListenInput));
btnListenOutput.addEventListener('click', () => speakText(outputText.value, targetLang.value, btnListenOutput));

btnMic.addEventListener('click', () => {
    if (!recognition) {
        showToast("Micrófono no soportado en este navegador");
        return;
    }

    try {
        if (isRecording) {
            recognition.stop();
        } else {
            recognition.lang = sourceLang.value === 'autodetect' ? 'es-ES' : sourceLang.value;
            recognition.start();
        }
    } catch (e) {
        isRecording = false;
        btnMic.classList.remove('recording');
    }
});

btnSpeedToggle.addEventListener('click', () => {
    if (speechSpeed === 1.0) speechSpeed = 0.8;
    else if (speechSpeed === 0.8) speechSpeed = 0.5;
    else speechSpeed = 1.0;

    speedLabel.textContent = `${speechSpeed}x`;
    showToast(`Velocidad de voz: ${speechSpeed}x`);
});

// COPIAR TEXTO
function copyText(text) {
    if (!text.trim()) return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast("¡Texto copiado!")).catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    try {
        document.execCommand('copy');
        showToast("¡Texto copiado!");
    } catch (err) {
        showToast("Error al copiar texto");
    }
    document.body.removeChild(textArea);
}

btnCopyInput.addEventListener('click', () => copyText(inputText.value));
btnCopyOutput.addEventListener('click', () => copyText(outputText.value));

// MENÚ DE HERRAMIENTAS
btnTools.addEventListener('click', (e) => {
    e.stopPropagation();
    toolsMenu.classList.toggle('show');
});

document.addEventListener('click', () => toolsMenu.classList.remove('show'));

document.getElementById('tool-upper').addEventListener('click', () => {
    inputText.value = inputText.value.toUpperCase();
    triggerDebouncedTranslate();
});

document.getElementById('tool-lower').addEventListener('click', () => {
    inputText.value = inputText.value.toLowerCase();
    triggerDebouncedTranslate();
});

document.getElementById('tool-title').addEventListener('click', () => {
    inputText.value = inputText.value.replace(/\w\S*/g, (w) => w.replace(/^\w/, (c) => c.toUpperCase()));
    triggerDebouncedTranslate();
});

document.getElementById('tool-clean').addEventListener('click', () => {
    inputText.value = inputText.value.replace(/\s+/g, ' ').trim();
    updateCounters();
    triggerDebouncedTranslate();
});

document.getElementById('tool-punctuate').addEventListener('click', () => {
    if (inputText.value.trim()) {
        inputText.value = applySmartPunctuation(inputText.value);
        updateCounters();
        triggerDebouncedTranslate();
        showToast("Puntuación inteligente aplicada");
    }
});

// FUENTES
btnFontInc.addEventListener('click', () => {
    if (currentFontSize < 24) {
        currentFontSize += 2;
        inputText.style.fontSize = `${currentFontSize}px`;
        outputText.style.fontSize = `${currentFontSize}px`;
    }
});

btnFontDec.addEventListener('click', () => {
    if (currentFontSize > 12) {
        currentFontSize -= 2;
        inputText.style.fontSize = `${currentFontSize}px`;
        outputText.style.fontSize = `${currentFontSize}px`;
    }
});

// BORRADO
btnClear.addEventListener('click', () => {
    inputText.value = '';
    outputText.value = '';
    lastTrimmedText = '';
    updateCounters();
    setStatus('Traduciendo...', false);
    if (synth) synth.cancel();
});

btnClearOutput.addEventListener('click', () => {
    outputText.value = '';
    if (synth) synth.cancel();
});

// HISTORIAL
function saveToHistory(srcText, tgtText, sL, tL) {
    if (!srcText.trim() || srcText.length < 2) return;
    if (translationHistory.length > 0 && translationHistory[0].srcText === srcText) return;

    translationHistory.unshift({ 
        srcText, 
        tgtText, 
        sL, 
        tL, 
        date: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
    });

    if (translationHistory.length > 30) translationHistory.pop();
    try {
        localStorage.setItem('neo_trans_history', JSON.stringify(translationHistory));
    } catch(e) {}
}

function renderHistory() {
    historyList.innerHTML = '';
    if (translationHistory.length === 0) {
        historyList.innerHTML = '<p style="color: var(--text-dim); text-align: center; padding: 20px;">No hay historial guardado aún.</p>';
        return;
    }

    translationHistory.forEach(item => {
        const el = document.createElement('div');
        el.className = 'history-item';
        el.innerHTML = `
            <div class="history-meta">
                <span>${item.sL.toUpperCase()} ➔ ${item.tL.toUpperCase()}</span>
                <span>${item.date}</span>
            </div>
            <div class="history-src">${item.srcText}</div>
            <div class="history-tgt">${item.tgtText}</div>
        `;
        el.addEventListener('click', () => {
            inputText.value = item.srcText;
            outputText.value = item.tgtText;
            lastTrimmedText = item.srcText.trim();
            updateCounters();
            historyModal.classList.remove('open');
        });
        historyList.appendChild(el);
    });
}

btnHistory.addEventListener('click', () => {
    renderHistory();
    historyModal.classList.add('open');
});

btnClearHistory.addEventListener('click', () => {
    if (translationHistory.length === 0) return;
    translationHistory = [];
    try {
        localStorage.removeItem('neo_trans_history');
    } catch(e) {}
    renderHistory();
    showToast("Historial eliminado por completo");
});

btnCloseModal.addEventListener('click', () => historyModal.classList.remove('open'));
historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) historyModal.classList.remove('open');
});
