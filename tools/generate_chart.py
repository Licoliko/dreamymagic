#!/usr/bin/env python3
"""
譜面ジェネレーター (Pastel Kingdom Rhythm)

使い方:
  python tools/generate_chart.py songs/<曲ID>/audio.mp3 --id <曲ID> --title "..." --artist "..."
  -> 同フォルダに chart.json を出力し、songs.json 用スニペットを表示

難易度: EASY / NORMAL / HARD / VERYHARD
  - 同時押し(chord): NORMALから少し、HARD/VERYHARDで増加
  - フリック(flick): HARD / VERYHARD のみ (up/left/right)
必要ライブラリ:  pip install librosa numpy
"""
import sys, os, json, argparse
import numpy as np

def make_charts(path, seed=7, bpm_override=None):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    dur = float(librosa.get_duration(y=y, sr=sr))
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr, units='time')
    bpm = float(bpm_override) if bpm_override else float(np.atleast_1d(tempo)[0])
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
    FLICK_DIRS = ['up']
    def build(min_gap, min_lane_gap, energy_cut, strength_pct, hold_prob, chord_prob, flick_prob):
        picked = []; last_any = -10; last_lane = [-10]*4
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
            picked.append((round(t, 3), lane, s, e)); last_any = t; last_lane[lane] = t
        picked.sort()
        out = []
        for i, (t, lane, s, e) in enumerate(picked):
            gap = (picked[i+1][0]-t) if i+1 < len(picked) else 1.0
            note = {"t": t, "lane": lane, "hold": 0}
            if gap > 0.55 and e > 0.45 and rng.random() < hold_prob:
                note["hold"] = round(min(gap*0.7, 0.9), 3)
            elif flick_prob > 0 and gap > min_gap*1.1 and rng.random() < flick_prob:
                note["flick"] = str(rng.choice(FLICK_DIRS))
            out.append(note)
            # 同時押し: 別レーンにもう1つ
            if (chord_prob > 0 and note["hold"] == 0 and "flick" not in note
                    and gap > min_gap*1.5 and rng.random() < chord_prob):
                out.append({"t": t, "lane": (lane+2) % 4, "hold": 0})
        out.sort(key=lambda n: (n["t"], n["lane"]))
        return out
    charts = {
        "EASY":     {"lv": 3,  "notes": build(0.34, 0.45, 0.45, 70, 0.15, 0.00, 0.00)},
        "NORMAL":   {"lv": 5,  "notes": build(0.22, 0.30, 0.34, 45, 0.30, 0.03, 0.00)},
        "HARD":     {"lv": 8,  "notes": build(0.13, 0.18, 0.26, 20, 0.40, 0.08, 0.10)},
        "VERYHARD": {"lv": 11, "notes": build(0.10, 0.14, 0.20, 10, 0.42, 0.14, 0.16)},
    }
    if bpm_override:
        step = (60.0/float(bpm_override))/4.0   # 16分グリッド
        def quantize(notes):
            seen=set(); out=[]
            for n in notes:
                qt=round(round(n["t"]/step)*step, 3); key=(qt, n["lane"])
                if key in seen: continue
                seen.add(key); m=dict(n); m["t"]=qt; out.append(m)
            out.sort(key=lambda x:(x["t"], x["lane"])); return out
        for k in charts: charts[k]["notes"]=quantize(charts[k]["notes"])
    return {"bpm": round(bpm, 2), "duration": round(dur, 3), "lanes": 4, "charts": charts}

def cnt(d,k,key):
    notes=d["charts"][k]["notes"]
    return sum(1 for n in notes if (key=='flick' and n.get('flick')) or (key=='all'))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3"); ap.add_argument("--title", default=None)
    ap.add_argument("--artist", default=""); ap.add_argument("--id", default=None)
    ap.add_argument("--bpm", type=float, default=None, help="テンポを指定(検出値を上書き&グリッド整列)")
    args = ap.parse_args()
    data = make_charts(args.mp3, bpm_override=args.bpm)
    out = os.path.join(os.path.dirname(args.mp3), "chart.json")
    json.dump(data, open(out, "w"), ensure_ascii=False)
    sid = args.id or os.path.basename(os.path.dirname(args.mp3)) or "song"
    title = args.title or os.path.splitext(os.path.basename(args.mp3))[0]
    rel = os.path.dirname(args.mp3).replace("\\", "/")
    c = data["charts"]
    print("[OK]", out)
    print("BPM=%.1f dur=%.1fs  EASY %d / NORMAL %d / HARD %d (flick %d) / VERYHARD %d (flick %d)" % (
        data["bpm"], data["duration"], len(c["EASY"]["notes"]), len(c["NORMAL"]["notes"]),
        len(c["HARD"]["notes"]), cnt(data,"HARD","flick"),
        len(c["VERYHARD"]["notes"]), cnt(data,"VERYHARD","flick")))
    snippet = {"id": sid, "title": title, "artist": args.artist, "sub": "",
               "genres": ["オリジナル"], "isNew": True, "c1": "#ff9ad4", "c2": "#9b6bff",
               "bpm": data["bpm"], "duration": data["duration"],
               "audio": rel+"/audio.mp3", "chart": rel+"/chart.json", "jacket": rel+"/jacket.webp",
               "preview": round(data["duration"]*0.3, 1)}
    print(json.dumps(snippet, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
