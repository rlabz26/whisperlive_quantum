import time
from faster_whisper import WhisperModel

model = WhisperModel("Systran/faster-whisper-tiny", device="cpu", compute_type="int8")

start = time.time()
segments, info = model.transcribe("audio/video_president_TZ.mp3", language="sw")
segments = list(segments)
print(f"Took {time.time()-start:.1f}s for a ~30s clip")
for seg in segments:
    print(seg.text)

# from faster_whisper import WhisperModel

# model = WhisperModel(
#     "Systran/faster-whisper-tiny",
#     device="cpu",
#     compute_type="int8",
# )

# segments, info = model.transcribe(
#     "audio/seg_1.mp3",
#     language="sw",
#     task="transcribe",
#     vad_filter=True,
# )

# segments = list(segments)

# print("language:", info.language)

# for seg in segments:
#     print(seg.start, seg.end, repr(seg.text))