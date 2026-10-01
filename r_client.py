from whisper_live.client import TranscriptionClient

import logging
logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

client = TranscriptionClient(
  "localhost",
  9090,
  lang="sw",
  translate=False,
  model="small",   # also support hf_model => `Systran/faster-whisper-small`
  use_vad=True,
  save_output_recording=True,                         # Only used for microphone input, False by Default
  output_recording_filename="./output_recording.wav", # Only used for microphone input
  mute_audio_playback=False,                          # Only used for file input, False by Default
  enable_translation=True,
  target_language="en",
#   enable_diarization=True,
#   max_speakers=4,
#   word_timestamps=True,
  initial_prompt=None,                               # Add context for the model, e.g. 'Jane Doe context'
)

client("audio/video_president_TZ.mp3")

# import pyaudio
# from whisper_live.client import StreamingTranscriptionClient

# RATE = 16000
# CHANNELS = 1
# CHUNK = 1024

# client = StreamingTranscriptionClient(
#     "localhost", 9090,
#     lang="en",
#     model="small",
#     on_session_started=lambda: print("Server ready"),
#     on_partial_transcript=lambda text, segs: print(f"… {text}", end="\r"),
#     on_committed_transcript=lambda text, segs: print(f"✓ {text}"),
#     on_error=lambda e: print(f"Error: {e}"),
#     on_close=lambda: print("Closed"),
# )

# audio = pyaudio.PyAudio()

# stream = audio.open(
#     format=pyaudio.paInt16,
#     channels=CHANNELS,
#     rate=RATE,
#     input=True,
#     frames_per_buffer=CHUNK,
# )

# try:
#     with client:
#         print("Speak into your microphone...")

#         while True:
#             chunk = stream.read(CHUNK, exception_on_overflow=False)
#             client.send(chunk, pcm_format="int16")

# except KeyboardInterrupt:
#     print("\nStopping...")

# finally:
#     stream.stop_stream()
#     stream.close()
#     audio.terminate()