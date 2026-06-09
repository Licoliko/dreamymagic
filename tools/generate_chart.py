#!/usr/bin/env python3
"""
譜面ジェネレーター (Pastel Kingdom Rhythm)

新しい曲を追加する手順:
  1) songs/<曲ID>/ フォルダを作り、audio.mp3 を置く
  2) このスクリプトを実行:
       python tools/generate_chart.py songs/<曲ID>/audio.mp3
     → 同じフォルダに chart.json が出力され、songs.json に貼る用のスニペットが表示されます
  3) 表示されたスニペットを songs.json の "songs" 配列に追記

必要ライブラリ:  pip install librosa numpy
"""
import sys, os, json, argparse
import numpy as np

def make_charts(path, seed=7):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    dur = float(librosa.get_duration(y=y, sr=sr))
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr, units='time')
    bpm = float(np.atleast_1d(tempo)[0])
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, backtrack=True)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    onset_strengths = onset_env[onset_frames]
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    cent_times = librosa.frames_to_time(np.arange(len(cent)), sr=sr)
    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    rms_max = float(rms.max()) or 1.0
    def at(arr, atimes, t):
        i = min(max(np.searchsorted(atimes, t), 0), len(arr)-1); return arr[i]
    valid = cent[cent > 0]; qs = np.percentile(valid, [25, 50, 75])
    def lane_for(t):
        c = at(cent, cent_times, t)
        return 0 if c <= qs[0] else 1 if c <= qs[1] else 2 if c <= qs[2] else 3
    rng = np.random.default_rng(seed)
    def build(min_gap, min_lane_gap, energy_cut, strength_pct, hold_prob):
        notes = []; last_any = -10; last_lane = [-10]*4
        scut = np.percentile(onset_strengths, strength_pct)
        for idx in np.argsort(onset_times):
            t = float(onset_times[idx]); s = float(onset_strengths[idx])
            if t < 1.5 or t > dur-1.0: continue
            if t-last_any < min_gap: continue
            e = at(rms, rms_times, t)/rms_max
            if e < energy_cut and s < scut: continue
            lane = lane_for(t)
            if t-last_lane[lane] < min_lane_gap:
                lane = max(range(4), key=lambda L: t-last_lane[L])
            notes.append((round(t, 3), lane)); last_any = t; last_lane[lane] = t
        notes.sort(); out = []
        for i, (t, lane) in enumerate(notes):
            gap = (notes[i+1][0]-t) if i+1 < len(notes) else 1.0
            e = at(rms, rms_times, t)/rms_max
            if gap > 0.55 and e > 0.45 and rng.random() < hold_prob:
                out.append({"t": t, "lane": lane, "hold": round(min(gap*0.7, 0.9), 3)})
            else:
                out.append({"t": t, "lane": lane, "hold": 0})
        return out
    charts = {
        "EASY":   {"lv": 3, "notes": build(0.34, 0.45, 0.45, 70, 0.15)},
        "NORMAL": {"lv": 5, "notes": build(0.22, 0.30, 0.34, 45, 0.30)},
        "HARD":   {"lv": 8, "notes": build(0.13, 0.18, 0.26, 20, 0.40)},
    }
    return {"bpm": round(bpm, 2), "duration": round(dur, 3), "lanes": 4, "charts": charts}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3", help="path to audio (mp3/wav/...)")
    ap.add_argument("--title", default=None)
    ap.add_argument("--artist", default="")
    ap.add_argument("--id", default=None)
    args = ap.parse_args()
    data = make_charts(args.mp3)
    out = os.path.join(os.path.dirname(args.mp3), "chart.json")
    json.dump(data, open(out, "w"), ensure_ascii=False)
    sid = args.id or os.path.basename(os.path.dirname(args.mp3)) or "song"
    title = args.title or os.path.splitext(os.path.basename(args.mp3))[0]
    rel = os.path.dirname(args.mp3).replace("\\", "/")
    print("\n[OK] chart.json ->", out)
    print("BPM=%.1f  duration=%.1fs  notes: EASY %d / NORMAL %d / HARD %d" % (
        data["bpm"], data["duration"],
        len(data["charts"]["EASY"]["notes"]), len(data["charts"]["NORMAL"]["notes"]), len(data["charts"]["HARD"]["notes"])))
    snippet = {"id": sid, "title": title, "artist": args.artist, "sub": "",
               "genres": ["オリジナル"], "isNew": True, "c1": "#ff9ad4", "c2": "#9b6bff",
               "bpm": data["bpm"], "duration": data["duration"],
               "audio": rel+"/audio.mp3", "chart": rel+"/chart.json", "preview": round(data["duration"]*0.3, 1)}
    print("\n--- songs.json の \"songs\" 配列に追記するスニペット ---")
    print(json.dumps(snippet, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
