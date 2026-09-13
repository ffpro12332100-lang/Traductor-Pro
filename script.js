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

// Estado y Caché en memoria para red ultralenta u offline
let debounceTimer = null;
let detectedLanguageCode = 'es';
let isRecording = false;
let recognition = null;
let speechSpeed = 1.0;
let currentFontSize = 16;
let activeAbortController = null;
let preMicText = ''; 

// Memoria local ultrarrápida (Caché offline)
const translationCache = new Map();
let translationHistory = [];
try {
    translationHistory = JSON.parse(localStorage.getItem('neo_trans_history') || '[]');
} catch(e) {
    translationHistory = [];
}

// API de Voz con Fallback seguro
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

// SISTEMA INTELIGENTE DE AUTO-PUNTUACIÓN Y GRAMÁTICA
function applySmartPunctuation(str, lang = 'es') {
    if (!str || !str.trim()) return str;

    let text = str.trim();

    // 1. Mayúscula inicial
    text = text.charAt(0).toUpperCase() + text.slice(1);

    // 2. Colocar comas tras conectores habituales en español e inglés
    const connectorRegexEs = /\b(sin embargo|por lo tanto|además|por ejemplo|en efecto|por favor)\b(?!\s*,)/gi;
    text = text.replace(connectorRegexEs, '$1,');

    const connectorRegexEn = /\b(however|therefore|besides|for example|in fact|please)\b(?!\s*,)/gi;
    text = text.replace(connectorRegexEn, '$1,');

    // 3. Detección Inteligente de Preguntas (Español)
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

    // 4. Detección Inteligente de Preguntas (Inglés)
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

// Inicialización optimizada de reconocimiento de voz
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
                inputText.value = applySmartPunctuation(inputText.value, sourceLang.value);
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

// CONTROLADOR DE DEBOUNCE / TIEMPO DE ESPERA TRAS ESCRIBIR SEGUIDO
inputText.addEventListener('input', () => {
    updateCounters();
    triggerDebouncedTranslate();
});

function triggerDebouncedTranslate() {
    clearTimeout(debounceTimer);
    const text = inputText.value;

    if (!text.trim()) {
        outputText.value = '';
        setStatus('Traduciendo...', false);
        return;
    }

    // Notificación visual rápida de pausa esperada si se escribe velozmente
    setStatus('Pausando para traducir...', true);

    // Ajuste dinámico de retardo de debounce según longitud de cadena (entre 650ms y 1200ms)
    const len = text.length;
    let waitTime = 700; 
    if (len > 3000) waitTime = 1200;
    else if (len > 800) waitTime = 950;

    debounceTimer = setTimeout(() => {
        translateText();
    }, waitTime);
}

sourceLang.addEventListener('change', () => { if(inputText.value.trim()) translateText(); });
targetLang.addEventListener('change', () => { if(inputText.value.trim()) translateText(); });

// INTERCAMBIO DE IDIOMAS CORREGIDO (SIN BORRAR EL TEXTO)
swapBtn.addEventListener('click', () => {
    const currentInput = inputText.value;
    const currentOutput = outputText.value;

    if (!currentInput.trim() && !currentOutput.trim()) return;

    let currentSource = sourceLang.value;
    let currentTarget = targetLang.value;

    if (currentSource === 'autodetect') {
        currentSource = detectedLanguageCode || 'es';
    }

    const canAssignSource = Array.from(sourceLang.options).some(o => o.value === currentTarget);
    const canAssignTarget = Array.from(targetLang.options).some(o => o.value === currentSource);

    if (canAssignSource) sourceLang.value = currentTarget;
    if (canAssignTarget) targetLang.value = currentSource;

    if (currentOutput.trim()) {
        inputText.value = currentOutput;
        outputText.value = currentInput;
    }

    updateCounters();
    if (inputText.value.trim()) translateText();
});

// Fetch con timeout y reintentos automáticos para soportar las peores conexiones
async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
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

// DIVISOR INTELIGENTE PARA CUALQUIER TIPO DE CADENA (Código, JSON, Marcado, Párrafos)
function splitTextIntoChunks(text, maxChunkLen = 1200) {
    if (text.length <= maxChunkLen) return [text];

    const chunks = [];
    // Preservar estructura dividiendo primariamente por saltos de línea dobles y simples
    const lines = text.split(/(\r?\n)/);
    let currentChunk = "";

    for (let part of lines) {
        if ((currentChunk + part).length > maxChunkLen) {
            if (currentChunk) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            if (part.length > maxChunkLen) {
                // Dividir por oraciones o símbolos de terminación en cadenas de código
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

// PARSER Y DESEMPAQUETADOR DE MOTOR INDIVIDUAL CON SOPORTE UNIVERSAL DE STRINGS
async function translateSingleChunk(textChunk, sLang, tLang, signal) {
    const subCacheKey = `${sLang}|${tLang}|${textChunk}`;
    if (translationCache.has(subCacheKey)) {
        return translationCache.get(subCacheKey);
    }

    // Motor 1: Google GTX Endpoint Avanzado
    try {
        const gUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sLang}&tl=${tLang}&dt=t&dt=bd&dt=ex&dt=ld&dt=md&dt=qca&dt=rw&dt=rm&dt=ss&dt=at&q=${encodeURIComponent(textChunk)}`;
        const response = await fetchWithTimeout(gUrl, { signal }, 5500);
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
        const response = await fetchWithTimeout(gUrl2, { signal }, 5500);
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
        const response = await fetchWithTimeout(lUrl, { signal }, 5500);
        if (response.ok) {
            const data = await response.json();
            if (data && data.translation) {
                translationCache.set(subCacheKey, data.translation);
                return data.translation;
            }
        }
    } catch (e) {}

    // Motor 4: MyMemory Backup de Alta Fidelidad
    try {
        const pair = (sLang === 'auto') ? `Autodetect|${tLang}` : `${sLang}|${tLang}`;
        const mUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textChunk)}&langpair=${pair}`;
        const response = await fetchWithTimeout(mUrl, { signal }, 6500);
        const data = await response.json();
        if (data.responseData && data.responseData.translatedText) {
            const resText = data.responseData.translatedText;
            translationCache.set(subCacheKey, resText);
            return resText;
        }
    } catch (e) {}

    throw new Error("No network engine responded");
}

// MOTOR PRINCIPAL TRIPLE CON FRAGMENTACIÓN DE TEXTO Y CACHÉ LOCAL
async function translateText() {
    const text = inputText.value;
    if (!text || !text.trim()) return;

    const sLang = sourceLang.value === 'autodetect' ? 'auto' : sourceLang.value;
    const tLang = targetLang.value;
    const cacheKey = `${sLang}|${tLang}|${text}`;

    // 1. Revisar Caché local para la frase completa
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
                outputText.value = "Error al conectar con los motores. Reintentando traducción...";
            }
        }
    } finally {
        if (!signal.aborted) {
            setStatus('Traduciendo...', false);
        }
    }
}

// REPRODUCCIÓN DE VOZ DE ALTA CAPACIDAD (Soporta Textos Extensos sin Cortarse)
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

        // Dividir en frases para evitar que la API TTS corte el audio en textos largos
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

// Menú de Herramientas de texto
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

// Opción inteligente manual de Auto-Puntuación ❓
document.getElementById('tool-punctuate').addEventListener('click', () => {
    if (inputText.value.trim()) {
        inputText.value = applySmartPunctuation(inputText.value, sourceLang.value);
        updateCounters();
        triggerDebouncedTranslate();
        showToast("Puntuación inteligente aplicada");
    }
});

// Controles de Tamaño de Texto
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

// Acciones de borrado con basureros SVG
btnClear.addEventListener('click', () => {
    inputText.value = '';
    outputText.value = '';
    updateCounters();
    setStatus('Traduciendo...', false);
    if (synth) synth.cancel();
});

btnClearOutput.addEventListener('click', () => {
    outputText.value = '';
    if (synth) synth.cancel();
});

// Historial con persistencia segura
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

// Vaciar todo el historial por completo
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
