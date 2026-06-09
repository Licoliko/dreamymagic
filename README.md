# Pastel Kingdom Rhythm 🎵

スマホで遊べるかわいい音ゲー。曲・譜面を**外部ファイル**として読み込みます。

## ⚠️ 重要：そのままダブルクリックでは動きません
ブラウザのセキュリティ上、`file://`（HTMLを直接開く）では外部のmp3/jsonを読み込めません。
**Webサーバー経由 or GitHub Pages** で開いてください。

### いちばん簡単：ローカルで試す
```bash
cd このフォルダ
python -m http.server 8000
# ブラウザで http://localhost:8000 を開く（スマホからは http://PCのIP:8000 ）
```

### GitHub Pages で公開（スマホでそのまま遊べる）
1. このフォルダを丸ごとGitリポジトリにして push
   ```bash
   git init && git add . && git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ>.git
   git push -u origin main
   ```
2. GitHubの **Settings → Pages → Build from branch → main / (root)** を選択
3. 数十秒後に `https://<ユーザー名>.github.io/<リポジトリ>/` で遊べます

## 📁 フォルダ構成
```
.
├── index.html          ゲーム本体
├── game.js             ロジック
├── songs.json          曲リスト（ここに曲を登録）
├── assets/
│   ├── char.webp       キャラ画像
│   └── avatar.webp     プロフィール用アイコン
├── songs/
│   ├── sakura/
│   │   ├── audio.mp3   音源
│   │   └── chart.json  譜面（自動生成）
│   └── seaoff/
│       ├── audio.mp3
│       └── chart.json
└── tools/
    └── generate_chart.py   譜面生成スクリプト
```

## ➕ 曲を追加する（推奨：事前に高品質な譜面を作る）
1. `songs/<曲ID>/` を作り、`audio.mp3` を置く
2. 譜面を生成：
   ```bash
   pip install librosa numpy
   python tools/generate_chart.py songs/<曲ID>/audio.mp3 --title "曲名" --artist "アーティスト"
   ```
   → `chart.json` が出力され、`songs.json` に貼るスニペットが表示されます
3. 表示されたスニペットを `songs.json` の `"songs"` 配列に追記して push

### 譜面をブラウザに自動生成させる（手軽だが簡易）
`songs.json` のその曲の `"chart"` を `"auto"` にすると、再生時にブラウザが音を解析して譜面を作ります（事前生成より精度は落ちます）。
```json
{ "id":"newsong", "title":"New Song", "audio":"songs/newsong/audio.mp3", "chart":"auto", "genres":["オリジナル"], "c1":"#ffb3df", "c2":"#9b6bff" }
```

### 端末の曲をその場で追加（インストール不要）
曲選択画面の **「＋ MP3を追加」** から端末内の音声ファイルを選ぶと、自動で譜面を作ってその場で遊べます（このセッション限り・保存はされません）。

## 🎮 遊び方
- 判定ラインに来たノーツに合わせて、4つのレーンをタップ
- PCは **D / F / J / K** キー
- 視聴ボタンで曲を試聴、難易度（EASY/NORMAL/HARD）と長さ（30秒/1分/フル）を選択
- クリアでコイン獲得（スコア・ランク・フルコンボでボーナス）。コインはブラウザに保存されます

## songs.json の各項目
| キー | 説明 |
|---|---|
| id | 一意のID（フォルダ名と合わせると分かりやすい） |
| title / artist / sub | 表示名・アーティスト・サブ表記 |
| genres | タブ絞り込み用（POPS / KAWAII / オリジナル など） |
| isNew | NEWバッジ表示 |
| c1 / c2 | ジャケットのグラデ色 |
| bpm / duration | 一覧表示用（chart.jsonにも入っています） |
| audio | mp3への相対パス |
| chart | chart.jsonへの相対パス、または "auto" |
| preview | 視聴の開始秒数（任意） |
