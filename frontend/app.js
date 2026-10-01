// // ============================================================
// // WhisperLive Browser Client
// // ============================================================
// //
// // Audio pipeline:
// //
// // Microphone / Browser Tab
// //        ↓
// //    MediaStream
// //        ↓
// //   AudioContext
// //        ↓
// //   AudioWorklet
// //        ↓
// //   Float32 audio
// //        ↓
// //   Resample to 16 kHz
// //        ↓
// //   Convert to PCM16
// //        ↓
// //   WebSocket
// //        ↓
// //   WhisperLive
// //        ↓
// //   faster-whisper
// //        ↓
// //   Transcript
// //
// // ============================================================

// // ============================================================
// // CONFIGURATION
// // ============================================================

// // WhisperLive default WebSocket port.
// const WHISPERLIVE_HOST = "127.0.0.1";
// const WHISPERLIVE_PORT = 9090;

// const WEBSOCKET_URL = `ws://${WHISPERLIVE_HOST}:${WHISPERLIVE_PORT}`;

// // Whisper expects 16 kHz audio.
// const TARGET_SAMPLE_RATE = 16000;

// // ============================================================
// // GLOBAL STATE
// // ============================================================

// let websocket = null;

// let audioContext = null;

// let sourceNode = null;

// let workletNode = null;

// let silentGainNode = null;

// let mediaStream = null;

// let isStreaming = false;

// let serverReady = false;

// // ============================================================
// // TRANSCRIPT STATE
// // ============================================================

// let committedSegments = [];

// let currentPartialText = "";

// // ============================================================
// // DOM ELEMENTS
// // ============================================================

// const micButton = document.getElementById("micButton");

// const tabButton = document.getElementById("tabButton");

// const stopButton = document.getElementById("stopButton");

// const modelSelect = document.getElementById("modelSelect");

// const languageSelect = document.getElementById("languageSelect");

// const statusElement = document.getElementById("status");

// const transcriptElement = document.getElementById("transcript");

// // ============================================================
// // BUTTON EVENTS
// // ============================================================

// micButton.addEventListener("click", startMicrophone);

// tabButton.addEventListener("click", startBrowserAudio);

// stopButton.addEventListener("click", stopStreaming);

// // ============================================================
// // STATUS
// // ============================================================

// function setStatus(message) {
//   statusElement.textContent = `Status: ${message}`;
// }

// // ============================================================
// // TRANSCRIPT
// // ============================================================

// function clearTranscript() {
//   committedSegments = [];
//   currentPartialText = "";

//   transcriptElement.textContent = "";
// }

// function updateTranscriptDisplay() {
//   const committedText = committedSegments
//     .map((segment) => segment.text || "")
//     .join(" ");

//   const combined =
//     committedText + (currentPartialText ? ` ${currentPartialText}` : "");

//   transcriptElement.textContent = combined.trim();

//   transcriptElement.scrollTop = transcriptElement.scrollHeight;
// }

// // ============================================================
// // GET FRONTEND SETTINGS
// // ============================================================

// function getSelectedModel() {
//   return modelSelect.value;
// }

// function getSelectedLanguage() {
//   const language = languageSelect.value;

//   // Empty language means WhisperLive can detect language.
//   if (language === "auto") {
//     return null;
//   }

//   return language;
// }

// // ============================================================
// // CREATE UNIQUE CLIENT ID
// // ============================================================

// function createClientId() {
//   if (typeof crypto !== "undefined" && crypto.randomUUID) {
//     return crypto.randomUUID();
//   }

//   return (
//     "browser-" + Date.now() + "-" + Math.random().toString(36).substring(2)
//   );
// }

// // ============================================================
// // WEBSOCKET
// // ============================================================

// async function connectWebSocket() {
//   return new Promise((resolve, reject) => {
//     console.log("Connecting to WhisperLive:", WEBSOCKET_URL);

//     websocket = new WebSocket(WEBSOCKET_URL);

//     websocket.binaryType = "arraybuffer";

//     let settled = false;

//     // --------------------------------------------------------
//     // OPEN
//     // --------------------------------------------------------

//     websocket.onopen = () => {
//       console.log("WebSocket connected");

//       const model = getSelectedModel();

//       const language = getSelectedLanguage();

//       // ------------------------------------------------------
//       // WhisperLive initial handshake
//       // ------------------------------------------------------

//       const options = {
//         uid: createClientId(),

//         // WhisperLive calls this "language".
//         //
//         // Swahili = "sw"
//         language: language,

//         // Whisper task.
//         task: "transcribe",

//         // This is the model selected in the frontend.
//         model: model,

//         // Enable WhisperLive VAD.
//         use_vad: true,

//         // We send Int16 PCM.
//         audio_format: "int16",

//         // Number of recent segments returned.
//         send_last_n_segments: 10,

//         // Optional.
//         no_speech_thresh: 0.45,

//         // Optional.
//         same_output_threshold: 7,
//       };

//       console.log("WhisperLive options:", options);

//       websocket.send(JSON.stringify(options));

//       setStatus(`Connecting to WhisperLive using ${model}...`);
//     };

//     // --------------------------------------------------------
//     // SERVER MESSAGE
//     // --------------------------------------------------------

//     websocket.onmessage = (event) => {
//       if (typeof event.data !== "string") {
//         console.warn("Received unexpected binary message");

//         return;
//       }

//       let message;

//       try {
//         message = JSON.parse(event.data);
//       } catch (error) {
//         console.error("Invalid JSON from WhisperLive:", event.data);

//         return;
//       }

//       console.log("WhisperLive message:", message);

//       // ----------------------------------------------------
//       // SERVER READY
//       // ----------------------------------------------------

//       if (message.message === "SERVER_READY") {
//         serverReady = true;

//         setStatus(`Ready — ${getSelectedModel()}`);

//         if (!settled) {
//           settled = true;
//           resolve();
//         }

//         return;
//       }

//       // ----------------------------------------------------
//       // SERVER WAIT
//       // ----------------------------------------------------

//       if (message.status === "WAIT") {
//         setStatus(`Server busy. Waiting...`);

//         return;
//       }

//       // ----------------------------------------------------
//       // WARNING
//       // ----------------------------------------------------

//       if (message.status === "WARNING") {
//         console.warn("WhisperLive warning:", message.message);

//         setStatus(`Warning: ${message.message}`);

//         return;
//       }

//       // ----------------------------------------------------
//       // ERROR
//       // ----------------------------------------------------

//       if (message.status === "ERROR") {
//         console.error("WhisperLive error:", message.message);

//         setStatus(`WhisperLive error: ${message.message}`);

//         if (!settled) {
//           settled = true;

//           reject(new Error(message.message || "WhisperLive error"));
//         }

//         return;
//       }

//       // ----------------------------------------------------
//       // DISCONNECT
//       // ----------------------------------------------------

//       if (message.message === "DISCONNECT") {
//         setStatus("WhisperLive disconnected");

//         return;
//       }

//       // ----------------------------------------------------
//       // TRANSCRIPTION
//       // ----------------------------------------------------

//       if (Array.isArray(message.segments)) {
//         handleSegments(message.segments);

//         return;
//       }
//     };

//     // --------------------------------------------------------
//     // ERROR
//     // --------------------------------------------------------

//     websocket.onerror = (error) => {
//       console.error("WebSocket error:", error);

//       setStatus("WebSocket error");

//       if (!settled) {
//         settled = true;
//         reject(new Error("Could not connect to WhisperLive"));
//       }
//     };

//     // --------------------------------------------------------
//     // CLOSE
//     // --------------------------------------------------------

//     websocket.onclose = (event) => {
//       console.log("WhisperLive WebSocket closed:", event.code, event.reason);

//       serverReady = false;

//       if (isStreaming) {
//         setStatus("WhisperLive connection closed");
//       }
//     };
//   });
// }

// // ============================================================
// // HANDLE WHISPERLIVE SEGMENTS
// // ============================================================

// function handleSegments(segments) {
//   if (!Array.isArray(segments)) {
//     return;
//   }

//   // WhisperLive sends recent segments.
//   //
//   // A segment looks like:
//   //
//   // {
//   //   start: "0.000",
//   //   end: "2.500",
//   //   text: "Hello",
//   //   completed: true
//   // }

//   const newCommitted = [];

//   let partial = "";

//   for (const segment of segments) {
//     if (!segment) {
//       continue;
//     }

//     const text = (segment.text || "").trim();

//     if (!text) {
//       continue;
//     }

//     if (segment.completed) {
//       newCommitted.push({
//         start: segment.start,
//         end: segment.end,
//         text: text,
//       });
//     } else {
//       partial += (partial ? " " : "") + text;
//     }
//   }

//   // ----------------------------------------------------------
//   // Update committed segments
//   // ----------------------------------------------------------

//   if (newCommitted.length > 0) {
//     for (const segment of newCommitted) {
//       const exists = committedSegments.some(
//         (existing) =>
//           existing.start === segment.start && existing.end === segment.end,
//       );

//       if (!exists) {
//         committedSegments.push(segment);
//       }
//     }
//   }

//   // ----------------------------------------------------------
//   // Partial result
//   // ----------------------------------------------------------

//   currentPartialText = partial;

//   updateTranscriptDisplay();

//   if (partial) {
//     setStatus(`Transcribing — ${getSelectedModel()}`);
//   } else {
//     setStatus(`Listening — ${getSelectedModel()}`);
//   }
// }

// // ============================================================
// // MICROPHONE
// // ============================================================

// async function startMicrophone() {
//   try {
//     console.log("Starting microphone...");

//     await stopStreaming();

//     clearTranscript();

//     // --------------------------------------------------------
//     // Connect to WhisperLive
//     // --------------------------------------------------------

//     await connectWebSocket();

//     if (!serverReady) {
//       throw new Error("WhisperLive is not ready");
//     }

//     // --------------------------------------------------------
//     // Request microphone
//     // --------------------------------------------------------

//     mediaStream = await navigator.mediaDevices.getUserMedia({
//       audio: {
//         channelCount: 1,
//         echoCancellation: true,
//         noiseSuppression: true,
//         autoGainControl: true,
//       },
//       video: false,
//     });

//     console.log("Microphone stream:", mediaStream);

//     const audioTracks = mediaStream.getAudioTracks();

//     if (audioTracks.length === 0) {
//       throw new Error("No microphone audio track found.");
//     }

//     isStreaming = true;

//     setStatus(`Listening — ${getSelectedModel()}`);

//     await startAudioProcessing(mediaStream);
//   } catch (error) {
//     console.error("Microphone error:", error);

//     setStatus(`Microphone error: ${error.message}`);

//     await stopStreaming();
//   }
// }

// // ============================================================
// // BROWSER / YOUTUBE AUDIO
// // ============================================================

// async function startBrowserAudio() {
//   try {
//     console.log("Starting browser audio capture...");

//     await stopStreaming();

//     clearTranscript();

//     // --------------------------------------------------------
//     // Connect to WhisperLive
//     // --------------------------------------------------------

//     await connectWebSocket();

//     if (!serverReady) {
//       throw new Error("WhisperLive is not ready");
//     }

//     // --------------------------------------------------------
//     // Browser tab capture
//     // --------------------------------------------------------

//     const displayOptions = {
//       video: {
//         displaySurface: "browser",
//       },

//       audio: {
//         suppressLocalAudioPlayback: false,
//       },

//       preferCurrentTab: false,

//       selfBrowserSurface: "exclude",

//       systemAudio: "include",

//       surfaceSwitching: "include",

//       monitorTypeSurfaces: "include",
//     };

//     mediaStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);

//     console.log("Display stream:", mediaStream);

//     const audioTracks = mediaStream.getAudioTracks();

//     if (audioTracks.length === 0) {
//       throw new Error(
//         "No audio was captured. " +
//           "Select a browser tab and enable " +
//           "'Share tab audio'.",
//       );
//     }

//     // --------------------------------------------------------
//     // Detect when browser sharing stops
//     // --------------------------------------------------------

//     const videoTracks = mediaStream.getVideoTracks();

//     if (videoTracks.length > 0) {
//       videoTracks[0].addEventListener("ended", () => {
//         console.log("Browser sharing stopped.");

//         stopStreaming();
//       });
//     }

//     isStreaming = true;

//     setStatus(`Listening — ${getSelectedModel()}`);

//     await startAudioProcessing(mediaStream);
//   } catch (error) {
//     console.error("Browser audio error:", error);

//     setStatus(`Browser audio error: ${error.message}`);

//     await stopStreaming();
//   }
// }

// // ============================================================
// // AUDIO PROCESSING
// // ============================================================

// async function startAudioProcessing(stream) {
//   console.log("Starting audio processing...");

//   // ----------------------------------------------------------
//   // AudioContext
//   // ----------------------------------------------------------

//   audioContext = new AudioContext();

//   console.log("Browser sample rate:", audioContext.sampleRate);

//   // ----------------------------------------------------------
//   // Resume AudioContext
//   // ----------------------------------------------------------

//   if (audioContext.state === "suspended") {
//     await audioContext.resume();
//   }

//   // ----------------------------------------------------------
//   // Load AudioWorklet
//   // ----------------------------------------------------------

//   await audioContext.audioWorklet.addModule("pcm_processor.js");

//   // ----------------------------------------------------------
//   // Create MediaStream source
//   // ----------------------------------------------------------

//   sourceNode = audioContext.createMediaStreamSource(stream);

//   // ----------------------------------------------------------
//   // Create AudioWorklet
//   // ----------------------------------------------------------

//   workletNode = new AudioWorkletNode(audioContext, "pcm_processor");

//   // ----------------------------------------------------------
//   // Receive Float32 samples
//   // ----------------------------------------------------------

//   workletNode.port.onmessage = (event) => {
//     if (!isStreaming) {
//       return;
//     }

//     if (!serverReady) {
//       return;
//     }

//     const samples = event.data;

//     if (!(samples instanceof Float32Array)) {
//       return;
//     }

//     // ------------------------------------------------------
//     // Browser sample rate → 16 kHz
//     // ------------------------------------------------------

//     const resampledAudio = resampleAudio(
//       samples,
//       audioContext.sampleRate,
//       TARGET_SAMPLE_RATE,
//     );

//     // ------------------------------------------------------
//     // Float32 → PCM16
//     // ------------------------------------------------------

//     const pcm16 = float32ToPCM16(resampledAudio);

//     // ------------------------------------------------------
//     // Send to WhisperLive
//     // ------------------------------------------------------

//     sendAudio(pcm16);
//   };

//   // ----------------------------------------------------------
//   // Connect source → worklet
//   // ----------------------------------------------------------

//   sourceNode.connect(workletNode);

//   // ----------------------------------------------------------
//   // Keep worklet alive without playback
//   // ----------------------------------------------------------

//   silentGainNode = audioContext.createGain();

//   silentGainNode.gain.value = 0;

//   workletNode.connect(silentGainNode);

//   silentGainNode.connect(audioContext.destination);

//   console.log("Audio processing started.");
// }

// // ============================================================
// // SEND PCM16 TO WHISPERLIVE
// // ============================================================

// function sendAudio(pcm16) {
//   if (!websocket) {
//     return;
//   }

//   if (websocket.readyState !== WebSocket.OPEN) {
//     return;
//   }

//   if (!serverReady) {
//     return;
//   }

//   // ----------------------------------------------------------
//   // Send raw PCM16 bytes.
//   //
//   // WhisperLive understands:
//   //
//   // audio_format: "int16"
//   //
//   // ----------------------------------------------------------

//   websocket.send(pcm16.buffer);
// }

// // ============================================================
// // RESAMPLE AUDIO
// // ============================================================

// function resampleAudio(input, inputSampleRate, outputSampleRate) {
//   // Already 16 kHz.
//   if (inputSampleRate === outputSampleRate) {
//     return input;
//   }

//   const ratio = inputSampleRate / outputSampleRate;

//   const outputLength = Math.round(input.length / ratio);

//   const output = new Float32Array(outputLength);

//   for (let i = 0; i < outputLength; i++) {
//     const position = i * ratio;

//     const left = Math.floor(position);

//     const right = Math.min(left + 1, input.length - 1);

//     const fraction = position - left;

//     const leftSample = input[left];

//     const rightSample = input[right];

//     // Linear interpolation.
//     output[i] = leftSample + (rightSample - leftSample) * fraction;
//   }

//   return output;
// }

// // ============================================================
// // FLOAT32 → PCM16
// // ============================================================

// function float32ToPCM16(float32Array) {
//   const pcm16 = new Int16Array(float32Array.length);

//   for (let i = 0; i < float32Array.length; i++) {
//     let sample = Math.max(-1, Math.min(1, float32Array[i]));

//     if (sample < 0) {
//       pcm16[i] = sample * 32768;
//     } else {
//       pcm16[i] = sample * 32767;
//     }
//   }

//   return pcm16;
// }

// // ============================================================
// // STOP STREAMING
// // ============================================================

// async function stopStreaming() {
//   console.log("Stopping streaming...");

//   isStreaming = false;

//   serverReady = false;

//   // ----------------------------------------------------------
//   // Stop microphone / browser sharing
//   // ----------------------------------------------------------

//   if (mediaStream) {
//     mediaStream.getTracks().forEach((track) => {
//       try {
//         track.stop();
//       } catch (error) {
//         console.warn("Could not stop track:", error);
//       }
//     });

//     mediaStream = null;
//   }

//   // ----------------------------------------------------------
//   // Disconnect worklet
//   // ----------------------------------------------------------

//   if (workletNode) {
//     try {
//       workletNode.disconnect();
//     } catch (error) {
//       console.warn("Could not disconnect worklet:", error);
//     }

//     workletNode = null;
//   }

//   // ----------------------------------------------------------
//   // Disconnect source
//   // ----------------------------------------------------------

//   if (sourceNode) {
//     try {
//       sourceNode.disconnect();
//     } catch (error) {
//       console.warn("Could not disconnect source:", error);
//     }

//     sourceNode = null;
//   }

//   // ----------------------------------------------------------
//   // Disconnect gain
//   // ----------------------------------------------------------

//   if (silentGainNode) {
//     try {
//       silentGainNode.disconnect();
//     } catch (error) {
//       console.warn("Could not disconnect gain:", error);
//     }

//     silentGainNode = null;
//   }

//   // ----------------------------------------------------------
//   // Close AudioContext
//   // ----------------------------------------------------------

//   if (audioContext) {
//     try {
//       if (audioContext.state !== "closed") {
//         await audioContext.close();
//       }
//     } catch (error) {
//       console.warn("Could not close AudioContext:", error);
//     }

//     audioContext = null;
//   }

//   // ----------------------------------------------------------
//   // Close WebSocket
//   // ----------------------------------------------------------

//   if (websocket) {
//     try {
//       if (
//         websocket.readyState === WebSocket.OPEN ||
//         websocket.readyState === WebSocket.CONNECTING
//       ) {
//         websocket.close();
//       }
//     } catch (error) {
//       console.warn("Could not close WebSocket:", error);
//     }

//     websocket = null;
//   }

//   setStatus("stopped");

//   console.log("Streaming stopped.");
// }

// // ============================================================
// // INITIAL STATE
// // ============================================================

// setStatus("stopped");
// ------------------------------------------------------------------------------------------
//     Second one
// ------------------------------------------------------------------------------------------

// const WHISPER_WS_URL = "ws://127.0.0.1:9090";
// const TRANSLATION_API_URL = "http://127.0.0.1:8001";

// const TARGET_SAMPLE_RATE = 16000;

// const statusElement = document.getElementById("status");
// const transcriptElement = document.getElementById("transcript");
// const translationElement = document.getElementById("translation");

// const modelSelect = document.getElementById("model");
// const sourceLanguageSelect = document.getElementById("sourceLanguage");
// const targetLanguageSelect = document.getElementById("targetLanguage");

// const startMicButton = document.getElementById("startMic");
// const startTabButton = document.getElementById("startTab");
// const stopButton = document.getElementById("stop");

// let websocket = null;
// let audioContext = null;
// let mediaStream = null;
// let sourceNode = null;
// let workletNode = null;

// let isRunning = false;
// let serverReady = false;

// let detectedLanguage = null;
// let partialElement = null;

// // WhisperLive can send the same recent completed segments repeatedly.
// // This set prevents us from displaying/translating the same segment again.
// const completedSegmentKeys = new Set();

// // Translation requests are serialized so results remain in transcript order.
// let translationQueue = Promise.resolve();

// const LANGUAGE_CODES = {
//   English: "en",
//   Swahili: "sw",
//   French: "fr",
//   German: "de",
//   Spanish: "es",
//   Portuguese: "pt",
//   Arabic: "ar",
//   Kinyarwanda: "rw",
//   Luganda: "lg",
// };

// const LANGUAGE_NAMES = {
//   en: "English",
//   sw: "Swahili",
//   fr: "French",
//   de: "German",
//   es: "Spanish",
//   pt: "Portuguese",
//   ar: "Arabic",
//   rw: "Kinyarwanda",
//   lg: "Luganda",
// };

// function setStatus(text) {
//   statusElement.textContent = text;
// }

// function createClientId() {
//   if (window.crypto && crypto.randomUUID) {
//     return crypto.randomUUID();
//   }

//   return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
// }

// function normalizeLanguageName(value) {
//   if (!value) return null;

//   const lower = value.toLowerCase();

//   return LANGUAGE_NAMES[lower] || value;
// }

// function appendLine(container, text, className = "line") {
//   if (!text || !text.trim()) return;

//   const element = document.createElement("div");
//   element.className = className;
//   element.textContent = text.trim();

//   container.appendChild(element);
//   container.scrollTop = container.scrollHeight;

//   return element;
// }

// function appendTranscript(text) {
//   appendLine(transcriptElement, text);
// }

// function appendTranslation(text) {
//   appendLine(translationElement, text);
// }

// function showPartialTranscript(text) {
//   if (!partialElement) {
//     partialElement = document.createElement("div");
//     partialElement.className = "line partial";
//     transcriptElement.appendChild(partialElement);
//   }

//   partialElement.textContent = text;
//   transcriptElement.scrollTop = transcriptElement.scrollHeight;
// }

// function clearPartialTranscript() {
//   if (partialElement) {
//     partialElement.remove();
//     partialElement = null;
//   }
// }

// function getSegmentKey(segment) {
//   const start = segment.start ?? "";
//   const end = segment.end ?? "";
//   const text = (segment.text || "").trim();

//   return `${start}|${end}|${text}`;
// }

// function enqueueTranslation(text, sourceLanguage, targetLanguage) {
//   translationQueue = translationQueue
//     .then(async () => {
//       if (!text || !text.trim()) return;

//       // If source and target are the same, no model call is necessary.
//       if (
//         sourceLanguage &&
//         sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()
//       ) {
//         appendTranslation(text);
//         return;
//       }

//       const response = await fetch(`${TRANSLATION_API_URL}/translate`, {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//           text: text.trim(),
//           source_lang: sourceLanguage,
//           target_lang: targetLanguage,
//         }),
//       });

//       if (!response.ok) {
//         const errorText = await response.text();
//         throw new Error(`Translation API ${response.status}: ${errorText}`);
//       }

//       const result = await response.json();

//       if (result.translation) {
//         appendTranslation(result.translation);
//       }
//     })
//     .catch((error) => {
//       console.error("Translation error:", error);

//       appendTranslation(`[Translation error: ${error.message}]`);
//     });

//   return translationQueue;
// }

// function handleWhisperMessage(event) {
//   if (typeof event.data !== "string") {
//     return;
//   }

//   let message;

//   try {
//     message = JSON.parse(event.data);
//   } catch (error) {
//     console.error("Invalid WhisperLive JSON:", event.data);
//     return;
//   }

//   if (message.message === "SERVER_READY") {
//     serverReady = true;
//     setStatus("WhisperLive ready — listening");
//     return;
//   }

//   if (message.message === "WAIT") {
//     setStatus("WhisperLive waiting for an available client slot");
//     return;
//   }

//   if (message.message === "DISCONNECT") {
//     setStatus("WhisperLive disconnected");
//     return;
//   }

//   if (message.message === "WARNING") {
//     console.warn("WhisperLive warning:", message);
//   }

//   if (message.message === "ERROR" || message.status === "ERROR") {
//     console.error("WhisperLive error:", message);
//     setStatus(
//       `WhisperLive error: ${message.message || message.error || "unknown error"}`,
//     );
//     return;
//   }

//   // Depending on the WhisperLive version/backend, language information
//   // may be available in the message. Keep the last detected language.
//   if (message.language) {
//     detectedLanguage = normalizeLanguageName(message.language);
//   }

//   if (!Array.isArray(message.segments)) {
//     return;
//   }

//   for (const segment of message.segments) {
//     const text = (segment.text || "").trim();

//     if (!text) continue;

//     if (!segment.completed) {
//       showPartialTranscript(text);
//       continue;
//     }

//     clearPartialTranscript();

//     const key = getSegmentKey(segment);

//     if (completedSegmentKeys.has(key)) {
//       continue;
//     }

//     completedSegmentKeys.add(key);

//     appendTranscript(text);

//     const selectedSource = sourceLanguageSelect.value;

//     let sourceLanguage;

//     if (selectedSource === "auto") {
//       sourceLanguage = detectedLanguage;
//     } else {
//       sourceLanguage = selectedSource;
//     }

//     if (!sourceLanguage) {
//       console.warn("No source language available yet; skipping translation.");
//       continue;
//     }

//     const targetLanguage = targetLanguageSelect.value;

//     enqueueTranslation(text, sourceLanguage, targetLanguage);
//   }
// }

// function connectWhisperLive() {
//   return new Promise((resolve, reject) => {
//     websocket = new WebSocket(WHISPER_WS_URL);
//     websocket.binaryType = "arraybuffer";

//     websocket.onopen = () => {
//       console.log("Connected to WhisperLive");

//       const selectedModel = modelSelect.value;
//       const selectedLanguage = sourceLanguageSelect.value;

//       const options = {
//         uid: createClientId(),
//         task: "transcribe",
//         model: selectedModel,
//         use_vad: true,
//         audio_format: "int16",

//         // Ask WhisperLive for enough recent segments to maintain context.
//         send_last_n_segments: 10,

//         // Useful for speech/no-speech filtering.
//         no_speech_thresh: 0.45,

//         // Prevent excessive repetition of identical output.
//         same_output_threshold: 7,
//       };

//       // Auto detection: omit language.
//       // Explicit language: send Whisper's language code.
//       if (selectedLanguage !== "auto") {
//         const code = LANGUAGE_CODES[selectedLanguage];

//         if (code) {
//           options.language = code;
//         }
//       }

//       websocket.send(JSON.stringify(options));

//       resolve();
//     };

//     websocket.onmessage = handleWhisperMessage;

//     websocket.onerror = (event) => {
//       console.error("WhisperLive WebSocket error:", event);

//       if (!serverReady) {
//         reject(
//           new Error("Could not connect to WhisperLive at " + WHISPER_WS_URL),
//         );
//       }
//     };

//     websocket.onclose = () => {
//       serverReady = false;
//       console.log("WhisperLive WebSocket closed");

//       if (isRunning) {
//         setStatus("WhisperLive connection closed");
//       }
//     };
//   });
// }

// function float32ToPCM16(float32Array) {
//   const pcm16 = new Int16Array(float32Array.length);

//   for (let i = 0; i < float32Array.length; i++) {
//     const sample = Math.max(-1, Math.min(1, float32Array[i]));

//     pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
//   }

//   return pcm16;
// }

// function resampleLinear(input, inputSampleRate, outputSampleRate) {
//   if (inputSampleRate === outputSampleRate) {
//     return input;
//   }

//   const ratio = inputSampleRate / outputSampleRate;

//   const outputLength = Math.floor(input.length / ratio);

//   const output = new Float32Array(outputLength);

//   for (let i = 0; i < outputLength; i++) {
//     const position = i * ratio;
//     const index = Math.floor(position);
//     const fraction = position - index;

//     const sample1 = input[index] || 0;
//     const sample2 = input[index + 1] || sample1;

//     output[i] = sample1 + (sample2 - sample1) * fraction;
//   }

//   return output;
// }

// async function setupAudioPipeline(stream) {
//   mediaStream = stream;

//   audioContext = new AudioContext();

//   await audioContext.audioWorklet.addModule("pcm_processor.js");

//   sourceNode = audioContext.createMediaStreamSource(mediaStream);

//   workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

//   workletNode.port.onmessage = (event) => {
//     if (!isRunning) return;

//     if (!websocket) return;

//     if (websocket.readyState !== WebSocket.OPEN) {
//       return;
//     }

//     if (!serverReady) {
//       return;
//     }

//     const float32Chunk = event.data;

//     const resampled = resampleLinear(
//       float32Chunk,
//       audioContext.sampleRate,
//       TARGET_SAMPLE_RATE,
//     );

//     const pcm16 = float32ToPCM16(resampled);

//     websocket.send(pcm16.buffer);
//   };

//   sourceNode.connect(workletNode);

//   // AudioWorkletNodes need to be connected into the graph
//   // in some browsers to keep processing active.
//   const silentGain = audioContext.createGain();

//   silentGain.gain.value = 0;

//   workletNode.connect(silentGain);
//   silentGain.connect(audioContext.destination);

//   await audioContext.resume();
// }

// async function startWithStream(stream, label) {
//   if (isRunning) {
//     await stop();
//   }

//   transcriptElement.innerHTML = "";
//   translationElement.innerHTML = "";

//   completedSegmentKeys.clear();
//   translationQueue = Promise.resolve();

//   detectedLanguage = null;
//   clearPartialTranscript();

//   isRunning = true;
//   serverReady = false;

//   updateButtons();

//   try {
//     setStatus(`Connecting to WhisperLive for ${label}...`);

//     await connectWhisperLive();

//     await setupAudioPipeline(stream);

//     setStatus(`Connected. Waiting for WhisperLive model...`);
//   } catch (error) {
//     console.error(error);

//     stream.getTracks().forEach((track) => track.stop());

//     mediaStream = null;
//     isRunning = false;

//     if (websocket) {
//       websocket.close();
//       websocket = null;
//     }

//     updateButtons();

//     setStatus(`Start failed: ${error.message}`);
//   }
// }

// async function startMicrophone() {
//   try {
//     const stream = await navigator.mediaDevices.getUserMedia({
//       audio: {
//         channelCount: 1,
//         echoCancellation: true,
//         noiseSuppression: true,
//         autoGainControl: true,
//       },
//       video: false,
//     });

//     await startWithStream(stream, "microphone");
//   } catch (error) {
//     console.error(error);

//     setStatus(`Microphone error: ${error.message}`);
//   }
// }

// async function startBrowserTab() {
//   try {
//     const stream = await navigator.mediaDevices.getDisplayMedia({
//       video: true,

//       audio: {
//         channelCount: 1,
//       },

//       systemAudio: "include",
//       surfaceSwitching: "include",
//       selfBrowserSurface: "exclude",
//       preferCurrentTab: false,
//     });

//     const audioTracks = stream.getAudioTracks();

//     if (!audioTracks.length) {
//       stream.getTracks().forEach((track) => track.stop());

//       throw new Error(
//         "No shared tab/system audio was provided. " +
//           "When sharing a browser tab, enable 'Share tab audio'.",
//       );
//     }

//     // WhisperLive needs audio only. Stop the display video track.
//     stream.getVideoTracks().forEach((track) => track.stop());

//     const audioOnlyStream = new MediaStream(audioTracks);

//     audioTracks[0].onended = () => {
//       if (isRunning) {
//         stop();
//       }
//     };

//     await startWithStream(audioOnlyStream, "browser/tab audio");
//   } catch (error) {
//     console.error(error);

//     setStatus(`Browser/tab capture error: ${error.message}`);
//   }
// }

// async function stop() {
//   isRunning = false;
//   serverReady = false;

//   if (workletNode) {
//     workletNode.port.onmessage = null;
//     workletNode.disconnect();
//     workletNode = null;
//   }

//   if (sourceNode) {
//     sourceNode.disconnect();
//     sourceNode = null;
//   }

//   if (audioContext) {
//     try {
//       await audioContext.close();
//     } catch (_) {}

//     audioContext = null;
//   }

//   if (mediaStream) {
//     mediaStream.getTracks().forEach((track) => track.stop());

//     mediaStream = null;
//   }

//   if (websocket) {
//     try {
//       websocket.close();
//     } catch (_) {}

//     websocket = null;
//   }

//   clearPartialTranscript();

//   updateButtons();

//   setStatus("Stopped");
// }

// function updateButtons() {
//   startMicButton.disabled = isRunning;
//   startTabButton.disabled = isRunning;
//   stopButton.disabled = !isRunning;

//   modelSelect.disabled = isRunning;
//   sourceLanguageSelect.disabled = isRunning;
// }

// startMicButton.addEventListener("click", startMicrophone);

// startTabButton.addEventListener("click", startBrowserTab);

// stopButton.addEventListener("click", stop);

// updateButtons();

const WHISPER_WS_URL = "ws://127.0.0.1:9090";
const TRANSLATION_API_URL = "http://127.0.0.1:8001";
const TTS_API_URL = "http://127.0.0.1:8002";

const TARGET_SAMPLE_RATE = 16000;
const VOICE_REFERENCE_SECONDS = 10;
const VOICE_REFERENCE_SAMPLES = TARGET_SAMPLE_RATE * VOICE_REFERENCE_SECONDS;

const statusElement = document.getElementById("status");
const transcriptElement = document.getElementById("transcript");
const translationElement = document.getElementById("translation");
const voiceStatusElement = document.getElementById("voiceStatus");
const replayButton = document.getElementById("replayTts");
const clearReplayButton = document.getElementById("clearReplay");

const modelSelect = document.getElementById("model");
const sourceLanguageSelect = document.getElementById("sourceLanguage");
const targetLanguageSelect = document.getElementById("targetLanguage");

const startMicButton = document.getElementById("startMic");
const startTabButton = document.getElementById("startTab");
const stopButton = document.getElementById("stop");

let websocket = null;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let workletNode = null;
let silentGainNode = null;

let isRunning = false;
let serverReady = false;
let detectedLanguage = null;
let partialElement = null;

const completedSegmentKeys = new Set();
let translationQueue = Promise.resolve();

// ------------------------------------------------------------
// Voice reference state
// ------------------------------------------------------------

let referenceChunks = [];
let referenceSampleCount = 0;
let referenceUploadStarted = false;
let referenceReady = false;
let referenceResolve = null;
let referenceReject = null;
let referencePromise = Promise.resolve();

// ------------------------------------------------------------
// TTS playback / recording state
// ------------------------------------------------------------

let ttsAudioContext = null;
let ttsOutputNode = null;
let ttsRecorder = null;
let ttsRecordingChunks = [];
let ttsReplayBlob = null;
let ttsReplayUrl = null;
let ttsPlaybackQueue = Promise.resolve();

const LANGUAGE_CODES = {
  English: "en",
  Swahili: "sw",
  French: "fr",
  German: "de",
  Spanish: "es",
  Portuguese: "pt",
  Arabic: "ar",
  Kinyarwanda: "rw",
  Luganda: "lg",
};

const LANGUAGE_NAMES = {
  en: "English",
  sw: "Swahili",
  fr: "French",
  de: "German",
  es: "Spanish",
  pt: "Portuguese",
  ar: "Arabic",
  rw: "Kinyarwanda",
  lg: "Luganda",
};

function setStatus(text) {
  statusElement.textContent = text;
}

function setVoiceStatus(text) {
  if (voiceStatusElement) {
    voiceStatusElement.textContent = text;
  }
}

function createClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeLanguageName(value) {
  if (!value) return null;
  return LANGUAGE_NAMES[value.toLowerCase()] || value;
}

function appendLine(container, text, className = "line") {
  if (!text || !text.trim()) return null;

  const element = document.createElement("div");
  element.className = className;
  element.textContent = text.trim();
  container.appendChild(element);
  container.scrollTop = container.scrollHeight;
  return element;
}

function appendTranscript(text) {
  appendLine(transcriptElement, text);
}

function appendTranslation(text) {
  appendLine(translationElement, text);
}

function showPartialTranscript(text) {
  if (!partialElement) {
    partialElement = document.createElement("div");
    partialElement.className = "line partial";
    transcriptElement.appendChild(partialElement);
  }
  partialElement.textContent = text;
  transcriptElement.scrollTop = transcriptElement.scrollHeight;
}

function clearPartialTranscript() {
  if (partialElement) {
    partialElement.remove();
    partialElement = null;
  }
}

function getSegmentKey(segment) {
  return `${segment.start ?? ""}|${segment.end ?? ""}|${(segment.text || "").trim()}`;
}

// ============================================================
// TTS AUDIO CONTEXT + RECORDING
// ============================================================

function getSupportedRecorderMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function ensureTtsAudio() {
  if (!ttsAudioContext) {
    ttsAudioContext = new AudioContext();
    ttsOutputNode = ttsAudioContext.createMediaStreamDestination();
  }

  if (ttsAudioContext.state === "suspended") {
    await ttsAudioContext.resume();
  }
}

function startTtsRecording() {
  if (!ttsOutputNode || typeof MediaRecorder === "undefined") {
    setVoiceStatus("TTS playback works, but browser recording is unavailable.");
    return;
  }

  if (ttsRecorder && ttsRecorder.state !== "inactive") return;

  ttsRecordingChunks = [];
  const mimeType = getSupportedRecorderMimeType();

  try {
    ttsRecorder = mimeType
      ? new MediaRecorder(ttsOutputNode.stream, { mimeType })
      : new MediaRecorder(ttsOutputNode.stream);

    ttsRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        ttsRecordingChunks.push(event.data);
      }
    };

    ttsRecorder.onstop = () => {
      if (!ttsRecordingChunks.length) return;

      const type = ttsRecorder.mimeType || "audio/webm";
      ttsReplayBlob = new Blob(ttsRecordingChunks, { type });

      if (ttsReplayUrl) URL.revokeObjectURL(ttsReplayUrl);
      ttsReplayUrl = URL.createObjectURL(ttsReplayBlob);

      if (replayButton) replayButton.disabled = false;
      setVoiceStatus("Voice-cloned speech recorded. Replay is ready.");
    };

    ttsRecorder.start(250);
  } catch (error) {
    console.warn("Could not start TTS recording:", error);
    ttsRecorder = null;
  }
}

function stopTtsRecording() {
  if (ttsRecorder && ttsRecorder.state !== "inactive") {
    ttsRecorder.stop();
  }
}

function clearTtsReplay() {
  ttsReplayBlob = null;
  if (ttsReplayUrl) {
    URL.revokeObjectURL(ttsReplayUrl);
    ttsReplayUrl = null;
  }
  if (replayButton) replayButton.disabled = true;
  setVoiceStatus("No replay recording.");
}

async function replayTts() {
  if (!ttsReplayBlob) return;

  await ensureTtsAudio();

  const url = URL.createObjectURL(ttsReplayBlob);
  const audio = new Audio(url);
  audio.preload = "auto";

  try {
    await audio.play();
    await new Promise((resolve, reject) => {
      audio.onended = resolve;
      audio.onerror = () =>
        reject(new Error("Replay audio could not be played."));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function playAudioBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const source = ttsAudioContext.createBufferSource();
    source.buffer = buffer;

    // One path goes to the speakers; the other goes to the MediaRecorder.
    source.connect(ttsAudioContext.destination);
    source.connect(ttsOutputNode);

    source.onended = () => {
      try {
        source.disconnect();
      } catch (_) {}
      resolve();
    };

    try {
      source.start(0);
    } catch (error) {
      reject(error);
    }
  });
}

function queueTts(text, targetLanguage) {
  if (!text || !text.trim()) return;

  ttsPlaybackQueue = ttsPlaybackQueue
    .then(async () => {
      // Do not generate speech until the 10-second reference is installed.
      await referencePromise;

      if (!referenceReady) return;

      await ensureTtsAudio();

      const response = await fetch(`${TTS_API_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          language: targetLanguage,
          exaggeration: 0.5,
          cfg: 0.5,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`TTS API ${response.status}: ${detail}`);
      }

      // Chatterbox returns WAV. Decode it immediately and play as soon as
      // this completed sentence is ready, while preserving sentence order.
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ttsAudioContext.decodeAudioData(
        arrayBuffer.slice(0),
      );

      await playAudioBuffer(audioBuffer);
    })
    .catch((error) => {
      console.error("TTS error:", error);
      appendTranslation(`[Speech error: ${error.message}]`);
    });

  return ttsPlaybackQueue;
}

// ============================================================
// 10-SECOND VOICE REFERENCE
// ============================================================

function resetVoiceReferenceState() {
  referenceChunks = [];
  referenceSampleCount = 0;
  referenceUploadStarted = false;
  referenceReady = false;

  referencePromise = new Promise((resolve, reject) => {
    referenceResolve = resolve;
    referenceReject = reject;
  });

  setVoiceStatus("Capturing 0.0 / 10.0 seconds for voice cloning…");
}

function encodeWavPcm16(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, value) {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function uploadVoiceReference(samples) {
  if (referenceUploadStarted) return;
  referenceUploadStarted = true;

  try {
    setVoiceStatus("10 seconds captured. Installing voice reference locally…");

    const wavBlob = encodeWavPcm16(samples, TARGET_SAMPLE_RATE);

    const response = await fetch(`${TTS_API_URL}/voice-reference`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: wavBlob,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Voice reference API ${response.status}: ${detail}`);
    }

    const result = await response.json();
    referenceReady = true;

    setVoiceStatus(
      `Voice cloning ready — ${Number(result.duration_seconds || 10).toFixed(1)}s reference installed locally.`,
    );

    if (referenceResolve) referenceResolve();
  } catch (error) {
    console.error("Voice reference upload failed:", error);
    referenceReady = false;
    setVoiceStatus(`Voice cloning failed: ${error.message}`);

    if (referenceReject) referenceReject(error);
  }
}

function captureVoiceReference(pcm16) {
  if (referenceUploadStarted || referenceSampleCount >= VOICE_REFERENCE_SAMPLES)
    return;

  const remaining = VOICE_REFERENCE_SAMPLES - referenceSampleCount;
  const take = Math.min(remaining, pcm16.length);
  const chunk = pcm16.slice(0, take);

  referenceChunks.push(chunk);
  referenceSampleCount += take;

  const seconds = referenceSampleCount / TARGET_SAMPLE_RATE;
  setVoiceStatus(
    `Capturing ${seconds.toFixed(1)} / ${VOICE_REFERENCE_SECONDS}.0 seconds for voice cloning…`,
  );

  if (referenceSampleCount >= VOICE_REFERENCE_SAMPLES) {
    const allSamples = new Int16Array(VOICE_REFERENCE_SAMPLES);
    let offset = 0;

    for (const part of referenceChunks) {
      allSamples.set(part, offset);
      offset += part.length;
    }

    // Release the chunk list before the network request.
    referenceChunks = [];
    void uploadVoiceReference(allSamples);
  }
}

async function clearServerVoiceReference() {
  try {
    await fetch(`${TTS_API_URL}/voice-reference`, { method: "DELETE" });
  } catch (error) {
    console.warn("Could not clear previous voice reference:", error);
  }
}

// ============================================================
// TRANSLATION
// ============================================================

function enqueueTranslation(text, sourceLanguage, targetLanguage) {
  translationQueue = translationQueue
    .then(async () => {
      if (!text || !text.trim()) return;

      let translatedText = text.trim();

      if (
        !sourceLanguage ||
        sourceLanguage.toLowerCase() !== targetLanguage.toLowerCase()
      ) {
        const response = await fetch(`${TRANSLATION_API_URL}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: text.trim(),
            source_lang: sourceLanguage,
            target_lang: targetLanguage,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Translation API ${response.status}: ${errorText}`);
        }

        const result = await response.json();
        translatedText = (result.translation || "").trim();
      }

      if (translatedText) {
        appendTranslation(translatedText);
        // TTS has its own queue, so a slow voice generation does not block
        // subsequent translations from appearing on screen.
        queueTts(translatedText, targetLanguage);
      }
    })
    .catch((error) => {
      console.error("Translation error:", error);
      appendTranslation(`[Translation error: ${error.message}]`);
    });

  return translationQueue;
}

// ============================================================
// WHISPERLIVE
// ============================================================

function handleWhisperMessage(event) {
  if (typeof event.data !== "string") return;

  let message;
  try {
    message = JSON.parse(event.data);
  } catch (error) {
    console.error("Invalid WhisperLive JSON:", event.data);
    return;
  }

  if (message.message === "SERVER_READY") {
    serverReady = true;
    setStatus("WhisperLive ready — listening");
    return;
  }

  if (message.status === "WAIT") {
    setStatus("WhisperLive waiting for an available client slot");
    return;
  }

  if (message.status === "WARNING") {
    console.warn("WhisperLive warning:", message);
    return;
  }

  if (message.status === "ERROR" || message.message === "ERROR") {
    console.error("WhisperLive error:", message);
    setStatus(
      `WhisperLive error: ${message.message || message.error || "unknown error"}`,
    );
    return;
  }

  if (message.message === "DISCONNECT") {
    setStatus("WhisperLive disconnected");
    return;
  }

  if (message.language) {
    detectedLanguage = normalizeLanguageName(message.language);
  }

  if (!Array.isArray(message.segments)) return;

  for (const segment of message.segments) {
    const text = (segment.text || "").trim();
    if (!text) continue;

    if (!segment.completed) {
      showPartialTranscript(text);
      continue;
    }

    clearPartialTranscript();

    const key = getSegmentKey(segment);
    if (completedSegmentKeys.has(key)) continue;

    completedSegmentKeys.add(key);
    appendTranscript(text);

    const selectedSource = sourceLanguageSelect.value;
    const sourceLanguage =
      selectedSource === "auto" ? detectedLanguage : selectedSource;

    if (!sourceLanguage) {
      console.warn("No source language available yet; skipping translation.");
      continue;
    }

    enqueueTranslation(text, sourceLanguage, targetLanguageSelect.value);
  }
}

function connectWhisperLive() {
  return new Promise((resolve, reject) => {
    websocket = new WebSocket(WHISPER_WS_URL);
    websocket.binaryType = "arraybuffer";

    websocket.onopen = () => {
      const selectedModel = modelSelect.value;
      const selectedLanguage = sourceLanguageSelect.value;

      const options = {
        uid: createClientId(),
        task: "transcribe",
        model: selectedModel,
        use_vad: true,
        audio_format: "int16",
        send_last_n_segments: 10,
        no_speech_thresh: 0.45,
        same_output_threshold: 7,
      };

      if (selectedLanguage !== "auto") {
        const code = LANGUAGE_CODES[selectedLanguage];
        if (code) options.language = code;
      }

      websocket.send(JSON.stringify(options));
      setStatus(`Connecting to WhisperLive using ${selectedModel}…`);
      resolve();
    };

    websocket.onmessage = handleWhisperMessage;

    websocket.onerror = () => {
      if (!serverReady) {
        reject(
          new Error(`Could not connect to WhisperLive at ${WHISPER_WS_URL}`),
        );
      }
    };

    websocket.onclose = () => {
      serverReady = false;
      if (isRunning) setStatus("WhisperLive connection closed");
    };
  });
}

// ============================================================
// AUDIO PROCESSING
// ============================================================

function float32ToPCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm16;
}

function resampleLinear(input, inputSampleRate, outputSampleRate) {
  if (inputSampleRate === outputSampleRate) return input;

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const sample1 = input[index] || 0;
    const sample2 = input[index + 1] || sample1;
    output[i] = sample1 + (sample2 - sample1) * fraction;
  }

  return output;
}

async function setupAudioPipeline(stream) {
  mediaStream = stream;
  audioContext = new AudioContext();

  await audioContext.audioWorklet.addModule("pcm_processor.js");

  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

  workletNode.port.onmessage = (event) => {
    if (!isRunning) return;

    const float32Chunk = event.data;
    if (!(float32Chunk instanceof Float32Array)) return;

    const resampled = resampleLinear(
      float32Chunk,
      audioContext.sampleRate,
      TARGET_SAMPLE_RATE,
    );

    const pcm16 = float32ToPCM16(resampled);

    // The exact same 16 kHz audio sent to Whisper becomes the Chatterbox
    // voice-cloning reference for the first 10 seconds.
    captureVoiceReference(pcm16);

    if (!serverReady || !websocket || websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    websocket.send(pcm16.buffer);
  };

  sourceNode.connect(workletNode);

  silentGainNode = audioContext.createGain();
  silentGainNode.gain.value = 0;
  workletNode.connect(silentGainNode);
  silentGainNode.connect(audioContext.destination);

  await audioContext.resume();
}

// ============================================================
// SESSION CONTROL
// ============================================================

async function startWithStream(stream, label) {
  if (isRunning) await stop();

  transcriptElement.innerHTML = "";
  translationElement.innerHTML = "";
  completedSegmentKeys.clear();
  translationQueue = Promise.resolve();
  ttsPlaybackQueue = Promise.resolve();
  detectedLanguage = null;
  clearPartialTranscript();
  clearTtsReplay();
  resetVoiceReferenceState();

  isRunning = true;
  serverReady = false;
  updateButtons();

  // Remove the previous session's reference before collecting this session's.
  await clearServerVoiceReference();

  try {
    setStatus(`Connecting to WhisperLive for ${label}…`);
    await connectWhisperLive();
    await setupAudioPipeline(stream);
    setStatus(
      `Connected. Speak/play audio for ${VOICE_REFERENCE_SECONDS} seconds to clone the voice…`,
    );
  } catch (error) {
    console.error(error);
    stream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
    isRunning = false;

    if (websocket) {
      websocket.close();
      websocket = null;
    }

    if (referenceReject) referenceReject(error);
    updateButtons();
    setStatus(`Start failed: ${error.message}`);
  }
}

async function startMicrophone() {
  // Called directly by the button click: unlock TTS audio before permission UI.
  try {
    await ensureTtsAudio();
    startTtsRecording();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    await startWithStream(stream, "microphone");
  } catch (error) {
    console.error(error);
    setStatus(`Microphone error: ${error.message}`);
  }
}

async function startBrowserTab() {
  try {
    await ensureTtsAudio();
    startTtsRecording();

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { channelCount: 1 },
      systemAudio: "include",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude",
      preferCurrentTab: false,
    });

    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(
        "No shared tab/system audio was provided. Enable 'Share tab audio'.",
      );
    }

    stream.getVideoTracks().forEach((track) => track.stop());
    const audioOnlyStream = new MediaStream(audioTracks);

    audioTracks[0].onended = () => {
      if (isRunning) stop();
    };

    await startWithStream(audioOnlyStream, "browser/tab audio");
  } catch (error) {
    console.error(error);
    setStatus(`Browser/tab capture error: ${error.message}`);
  }
}

async function stop() {
  const wasRunning = isRunning;
  isRunning = false;
  serverReady = false;

  if (workletNode) {
    workletNode.port.onmessage = null;
    try {
      workletNode.disconnect();
    } catch (_) {}
    workletNode = null;
  }

  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (_) {}
    sourceNode = null;
  }

  if (silentGainNode) {
    try {
      silentGainNode.disconnect();
    } catch (_) {}
    silentGainNode = null;
  }

  if (audioContext) {
    try {
      if (audioContext.state !== "closed") await audioContext.close();
    } catch (_) {}
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    mediaStream = null;
  }

  if (websocket) {
    try {
      websocket.close();
    } catch (_) {}
    websocket = null;
  }

  if (wasRunning && !referenceReady && referenceReject) {
    referenceReject(
      new Error(
        "Capture stopped before the 10-second voice reference was ready.",
      ),
    );
  }

  // Let already-generated speech finish so the replay recording contains
  // the complete TTS session rather than ending halfway through a sentence.
  try {
    await ttsPlaybackQueue;
  } catch (_) {}

  stopTtsRecording();
  updateButtons();
  setStatus("Stopped");
}

function updateButtons() {
  startMicButton.disabled = isRunning;
  startTabButton.disabled = isRunning;
  stopButton.disabled = !isRunning;
  modelSelect.disabled = isRunning;
  sourceLanguageSelect.disabled = isRunning;
  targetLanguageSelect.disabled = isRunning;
}

// ============================================================
// UI EVENTS
// ============================================================

startMicButton.addEventListener("click", startMicrophone);
startTabButton.addEventListener("click", startBrowserTab);
stopButton.addEventListener("click", stop);

if (replayButton) {
  replayButton.addEventListener("click", () => {
    replayTts().catch((error) => {
      console.error(error);
      setVoiceStatus(`Replay error: ${error.message}`);
    });
  });
}

if (clearReplayButton) {
  clearReplayButton.addEventListener("click", clearTtsReplay);
}

updateButtons();
setStatus("Idle");
setVoiceStatus(
  "Start a microphone or browser-audio session to capture a 10-second voice reference.",
);
