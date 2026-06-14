#!/usr/bin/env python3
"""
追加プレイモード譜面ジェネレーター (Pastel Kingdom Rhythm)

既存の chart.json (RHYTHM譜面 / charts.{EASY,NORMAL,HARD,VERYHARD}) に加えて、
以下2つの追加モード譜面を生成し、chart.json に追記する。

- STORY  : 曲をセクション(イントロ/Aメロ/Bメロ/サビ/ブリッジ等)に分割し、
           セクションごとにレーン配置パターン・密度・背景演出を切り替える。
           => charts_story.{EASY,NORMAL,HARD,VERYHARD} + sections配列
- EMOTION: エネルギーの勾配(微分)を検出し、急上昇区間=連打ラッシュ、
           下降/低エネルギー区間=ロングホールド中心に配置。
           => charts_emotion.{EASY,NORMAL,HARD,VERYHARD}

使い方:
  python tools/generate_alt_charts.py songs/<曲ID>/audio.mp3 [--bpm 130]
  python tools/generate_alt_charts.py --all   (songs/*/audio.mp3 を全部処理)
"""
import sys, os, json, argparse, glob
import numpy as np


def analyze(path, bpm_override=None):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    dur = float(librosa.get_duration(y=y, sr=sr))
    if bpm_override:
        bpm = float(bpm_override)
    else:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, units='time')
        bpm = float(np.atleast_1d(tempo)[0])

    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, backtrack=True, delta=0.05)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    onset_strengths = onset_env[onset_frames]

    rms = librosa.feature.rms(y=y)[0]
    rms_times = librosa.frames_to_time(np.arange(len(rms)), sr=sr)
    rms_max = float(rms.max()) or 1.0

    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    cent_times = librosa.frames_to_time(np.arange(len(cent)), sr=sr)

    return dict(y=y, sr=sr, dur=dur, bpm=bpm,
                 onset_times=onset_times, onset_strengths=onset_strengths,
                 rms=rms, rms_times=rms_times, rms_max=rms_max,
                 cent=cent, cent_times=cent_times)


def at(arr, atimes, t):
    i = min(max(np.searchsorted(atimes, t), 0), len(arr) - 1)
    return arr[i]


# ============================================================
# STORY MODE: セクション分割 + セクションごとの配置パターン
# ============================================================

def detect_sections(data, win_sec=8.0):
    """RMSエネルギーを区間ごとに平均し、レベル(0-3)に量子化してセクション境界を作る"""
    rms, rms_times, dur = data['rms'], data['rms_times'], data['dur']
    rms_max = data['rms_max']
    n_win = max(3, int(dur / win_sec))
    win_sec = dur / n_win
    levels = []
    for i in range(n_win):
        t0, t1 = i * win_sec, (i + 1) * win_sec
        mask = (rms_times >= t0) & (rms_times < t1)
        e = float(rms[mask].mean()) / rms_max if mask.any() else 0.0
        levels.append(e)
    # 0-3に量子化(全体の25/50/75パーセンタイル基準)
    qs = np.percentile(levels, [25, 50, 75])

    def lv(e):
        return 0 if e <= qs[0] else 1 if e <= qs[1] else 2 if e <= qs[2] else 3

    raw = [lv(e) for e in levels]
    # 隣接する同レベルを統合してセクション化
    sections = []
    cur_lv = raw[0]
    cur_start = 0.0
    for i in range(1, n_win):
        if raw[i] != cur_lv:
            sections.append({"start": round(cur_start, 2),
                              "end": round(i * win_sec, 2),
                              "level": cur_lv})
            cur_lv = raw[i]
            cur_start = i * win_sec
    sections.append({"start": round(cur_start, 2), "end": round(dur, 2), "level": cur_lv})

    # 短すぎる(3秒未満)セクションは前後に吸収
    merged = []
    for sec in sections:
        if merged and (sec["end"] - sec["start"]) < 3.0:
            merged[-1]["end"] = sec["end"]
        else:
            merged.append(dict(sec))
    # セクション名付与(レベル0=INTRO/OUTRO的, 1=VERSE, 2=PRE-CHORUS, 3=CHORUS)
    names = {0: "CALM", 1: "VERSE", 2: "BUILD", 3: "CHORUS"}
    for sec in merged:
        sec["name"] = names[sec["level"]]
    return merged


def build_story(data, sections, min_gap, min_lane_gap, energy_cut, strength_pct,
                 hold_prob, chord_prob, flick_prob, seed):
    """セクションのレベルに応じてレーン数・密度を変えながらノーツ配置"""
    onset_times, onset_strengths = data['onset_times'], data['onset_strengths']
    rms, rms_times, rms_max = data['rms'], data['rms_times'], data['rms_max']
    cent, cent_times = data['cent'], data['cent_times']
    dur = data['dur']
    rng = np.random.default_rng(seed)

    valid = cent[cent > 0]
    qs = np.percentile(valid, [25, 50, 75])

    def base_lane(t):
        c = at(cent, cent_times, t)
        return 0 if c <= qs[0] else 1 if c <= qs[1] else 2 if c <= qs[2] else 3

    def section_at(t):
        for sec in sections:
            if sec["start"] <= t < sec["end"]:
                return sec
        return sections[-1]

    # レベル別パラメータ: レーン範囲・密度補正・コード確率
    LEVEL_CFG = {
        0: dict(lanes=(1, 2), density_mul=0.55, chord_mul=0.0, hold_mul=1.6),   # CALM: 1-2レーン、ホールド多め
        1: dict(lanes=(0, 3), density_mul=0.85, chord_mul=0.6, hold_mul=1.0),   # VERSE: 標準
        2: dict(lanes=(0, 3), density_mul=1.05, chord_mul=1.0, hold_mul=0.7),   # BUILD: やや密
        3: dict(lanes=(0, 3), density_mul=1.35, chord_mul=1.6, hold_mul=0.5),   # CHORUS: 全レーン・密
    }

    scut = np.percentile(onset_strengths, strength_pct)
    picked = []
    last_any = -10
    last_lane = [-10] * 4

    for idx in np.argsort(onset_times):
        t = float(onset_times[idx]); s = float(onset_strengths[idx])
        if t < 1.5 or t > dur - 1.0:
            continue
        sec = section_at(t)
        cfg = LEVEL_CFG[sec["level"]]
        gap_req = min_gap / max(cfg["density_mul"], 0.3)
        if t - last_any < gap_req:
            continue
        e = at(rms, rms_times, t) / rms_max
        cut = energy_cut * (0.7 if sec["level"] >= 2 else 1.0)
        if e < cut and s < scut:
            continue
        lo, hi = cfg["lanes"]
        lane = base_lane(t)
        lane = min(max(lane, lo), hi)
        if t - last_lane[lane] < min_lane_gap:
            cand = [L for L in range(lo, hi + 1)]
            lane = max(cand, key=lambda L: t - last_lane[L])
        picked.append((round(t, 3), lane, sec["level"]))
        last_any = t
        last_lane[lane] = t

    picked.sort()
    out = []
    for i, (t, lane, lvl) in enumerate(picked):
        cfg = LEVEL_CFG[lvl]
        gap = (picked[i + 1][0] - t) if i + 1 < len(picked) else 1.0
        note = {"t": t, "lane": lane, "hold": 0}
        hp = min(0.9, hold_prob * cfg["hold_mul"])
        cp = min(0.9, chord_prob * cfg["chord_mul"])
        if gap > 0.55 and rng.random() < hp:
            note["hold"] = round(min(gap * 0.7, 1.4 if lvl == 0 else 0.9), 3)
        elif flick_prob > 0 and lvl >= 2 and gap > min_gap * 1.1 and rng.random() < flick_prob:
            note["flick"] = str(rng.choice(['up']))
        out.append(note)
        if cp > 0 and note["hold"] == 0 and "flick" not in note \
                and gap > min_gap * 1.5 and rng.random() < cp:
            lo, hi = cfg["lanes"]
            alt = (lane + 2) % 4
            alt = min(max(alt, lo), hi)
            if alt != lane:
                out.append({"t": t, "lane": alt, "hold": 0})
    out.sort(key=lambda n: (n["t"], n["lane"]))
    return out


# ============================================================
# EMOTION MODE: エネルギー勾配 -> 連打ラッシュ / ロングホールド
# ============================================================

def build_emotion(data, min_gap, min_lane_gap, base_density_pct, rush_mul,
                   hold_min_sec, seed):
    """
    RMSの一次差分(勾配)を見て:
      - 勾配が大きく正(上昇) かつ エネルギーが高い区間 -> 「ラッシュ」: 通常の密度を rush_mul 倍にして連打
      - エネルギーが低い/勾配が小さい区間 -> 「静寂」: ロングホールド中心、ノーツ数を絞る
      - それ以外 -> 標準密度
    """
    onset_times, onset_strengths = data['onset_times'], data['onset_strengths']
    rms, rms_times, rms_max = data['rms'], data['rms_times'], data['rms_max']
    cent, cent_times = data['cent'], data['cent_times']
    dur = data['dur']
    rng = np.random.default_rng(seed)

    valid = cent[cent > 0]
    qs = np.percentile(valid, [25, 50, 75])

    def base_lane(t):
        c = at(cent, cent_times, t)
        return 0 if c <= qs[0] else 1 if c <= qs[1] else 2 if c <= qs[2] else 3

    # RMSを平滑化して勾配を計算
    rms_norm = rms / rms_max
    smooth = np.convolve(rms_norm, np.ones(9) / 9, mode='same')
    grad = np.gradient(smooth, rms_times)
    grad_pos_thresh = np.percentile(grad[grad > 0], 70) if (grad > 0).any() else 0.0
    energy_mid = np.percentile(rms_norm, 50)

    def zone_at(t):
        e = at(rms_norm, rms_times, t)
        g = at(grad, rms_times, t)
        if g > grad_pos_thresh and e > energy_mid:
            return "rush"
        if e < energy_mid * 0.7 and g <= 0:
            return "calm"
        return "normal"

    scut = np.percentile(onset_strengths, base_density_pct)
    picked = []
    last_any = -10
    last_lane = [-10] * 4

    for idx in np.argsort(onset_times):
        t = float(onset_times[idx]); s = float(onset_strengths[idx])
        if t < 1.5 or t > dur - 1.0:
            continue
        zone = zone_at(t)
        if zone == "rush":
            gap_req = min_gap / rush_mul
        elif zone == "calm":
            gap_req = min_gap * 2.2
        else:
            gap_req = min_gap
        if t - last_any < gap_req:
            continue
        e = at(rms, rms_times, t) / rms_max
        if zone == "normal" and e < 0.18 and s < scut:
            continue
        lane = base_lane(t)
        if t - last_lane[lane] < min_lane_gap:
            lane = max(range(4), key=lambda L: t - last_lane[L])
        picked.append((round(t, 3), lane, zone))
        last_any = t
        last_lane[lane] = t

    picked.sort()
    out = []
    for i, (t, lane, zone) in enumerate(picked):
        gap = (picked[i + 1][0] - t) if i + 1 < len(picked) else 1.0
        note = {"t": t, "lane": lane, "hold": 0}
        if zone == "calm" and gap > hold_min_sec:
            note["hold"] = round(min(gap * 0.75, 2.0), 3)
        elif zone == "rush" and gap > min_gap * 1.3 and rng.random() < 0.18:
            note["flick"] = str(rng.choice(['up']))
        out.append(note)
        # rushゾーンは同時押し(連打感)を増やす
        if zone == "rush" and note["hold"] == 0 and "flick" not in note \
                and gap > min_gap * 1.2 and rng.random() < 0.35:
            out.append({"t": t, "lane": (lane + 2) % 4, "hold": 0})
    out.sort(key=lambda n: (n["t"], n["lane"]))
    return out


# ============================================================
# main
# ============================================================

def quantize_notes(notes, bpm, div=4):
    step = (60.0 / bpm) / div
    seen = set(); out = []
    for n in notes:
        qt = round(round(n["t"] / step) * step, 3)
        key = (qt, n["lane"])
        if key in seen:
            continue
        seen.add(key)
        m = dict(n); m["t"] = qt
        out.append(m)
    out.sort(key=lambda x: (x["t"], x["lane"]))
    return out


def process_song(audio_path, bpm_override=None):
    chart_path = os.path.join(os.path.dirname(audio_path), "chart.json")
    if not os.path.exists(chart_path):
        print(f"  [SKIP] {chart_path} not found")
        return

    with open(chart_path, encoding='utf-8') as f:
        chart = json.load(f)

    bpm = bpm_override or chart.get("bpm")
    print(f"  analyzing {audio_path} (BPM={bpm}) ...")
    data = analyze(audio_path, bpm_override=bpm)
    bpm = data['bpm']

    # ---- STORY ----
    sections = detect_sections(data)
    story_charts = {}
    STORY_PARAMS = {
        "EASY":     dict(min_gap=0.34, min_lane_gap=0.45, energy_cut=0.30, strength_pct=60, hold_prob=0.18, chord_prob=0.00, flick_prob=0.00, lv=3),
        "NORMAL":   dict(min_gap=0.24, min_lane_gap=0.30, energy_cut=0.22, strength_pct=40, hold_prob=0.22, chord_prob=0.05, flick_prob=0.00, lv=5),
        "HARD":     dict(min_gap=0.15, min_lane_gap=0.18, energy_cut=0.16, strength_pct=18, hold_prob=0.20, chord_prob=0.12, flick_prob=0.10, lv=8),
        "VERYHARD": dict(min_gap=0.11, min_lane_gap=0.14, energy_cut=0.12, strength_pct=10, hold_prob=0.18, chord_prob=0.20, flick_prob=0.16, lv=11),
    }
    for diff, p in STORY_PARAMS.items():
        notes = build_story(data, sections,
                             p["min_gap"], p["min_lane_gap"], p["energy_cut"], p["strength_pct"],
                             p["hold_prob"], p["chord_prob"], p["flick_prob"], seed=101)
        notes = quantize_notes(notes, bpm)
        story_charts[diff] = {"lv": p["lv"], "notes": notes}

    # ---- EMOTION ----
    emotion_charts = {}
    EMOTION_PARAMS = {
        "EASY":     dict(min_gap=0.34, min_lane_gap=0.45, base_density_pct=60, rush_mul=1.6, hold_min_sec=0.7, lv=3),
        "NORMAL":   dict(min_gap=0.24, min_lane_gap=0.30, base_density_pct=40, rush_mul=2.0, hold_min_sec=0.55, lv=5),
        "HARD":     dict(min_gap=0.15, min_lane_gap=0.18, base_density_pct=18, rush_mul=2.6, hold_min_sec=0.45, lv=8),
        "VERYHARD": dict(min_gap=0.11, min_lane_gap=0.14, base_density_pct=10, rush_mul=3.2, hold_min_sec=0.40, lv=11),
    }
    for diff, p in EMOTION_PARAMS.items():
        notes = build_emotion(data, p["min_gap"], p["min_lane_gap"], p["base_density_pct"],
                               p["rush_mul"], p["hold_min_sec"], seed=202)
        notes = quantize_notes(notes, bpm)
        emotion_charts[diff] = {"lv": p["lv"], "notes": notes}

    chart["sections"] = sections
    chart["charts_story"] = story_charts
    chart["charts_emotion"] = emotion_charts

    with open(chart_path, 'w', encoding='utf-8') as f:
        json.dump(chart, f, ensure_ascii=False)

    def summarize(charts):
        return ", ".join(f"{k}:{len(v['notes'])}" for k, v in charts.items())

    print(f"  sections: {len(sections)} ({', '.join(s['name'] for s in sections)})")
    print(f"  story  : {summarize(story_charts)}")
    print(f"  emotion: {summarize(emotion_charts)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp3", nargs='?', help="songs/<id>/audio.mp3")
    ap.add_argument("--bpm", type=float, default=None)
    ap.add_argument("--all", action="store_true", help="songs/*/audio.mp3 を全部処理")
    args = ap.parse_args()

    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if args.all:
        for chart_path in sorted(glob.glob(os.path.join(base, "songs", "*", "chart.json"))):
            audio_path = os.path.join(os.path.dirname(chart_path), "audio.mp3")
            if not os.path.exists(audio_path):
                continue
            with open(chart_path, encoding='utf-8') as f:
                bpm = json.load(f).get("bpm")
            print(f"[{os.path.basename(os.path.dirname(chart_path))}]")
            process_song(audio_path, bpm_override=bpm)
    elif args.mp3:
        process_song(args.mp3, bpm_override=args.bpm)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
