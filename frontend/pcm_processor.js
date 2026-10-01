// // ============================================================
// // PCM AudioWorklet Processor
// // ============================================================

// class PCMProcessor extends AudioWorkletProcessor {
//   constructor() {
//     super();

//     this.buffer = [];

//     // 2048 samples:
//     //
//     // 48 kHz -> ~42.7 ms
//     // 44.1 kHz -> ~46.4 ms
//     //
//     // Smaller chunks make the stream more responsive.
//     this.bufferSize = 2048;
//   }

//   process(inputs) {
//     const input = inputs[0];

//     if (!input || input.length === 0) {
//       return true;
//     }

//     const channelData = input[0];

//     if (!channelData) {
//       return true;
//     }

//     for (let i = 0; i < channelData.length; i++) {
//       this.buffer.push(channelData[i]);
//     }

//     while (this.buffer.length >= this.bufferSize) {
//       const chunk = this.buffer.splice(0, this.bufferSize);

//       const samples = new Float32Array(chunk);

//       this.port.postMessage(samples, [samples.buffer]);
//     }

//     return true;
//   }
// }

// registerProcessor("pcm_processor", PCMProcessor);

class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Copy the channel so the main thread receives a stable Float32Array.
    const samples = new Float32Array(input[0]);
    this.port.postMessage(samples, [samples.buffer]);

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
