# JXLPress

JPEG XL への変換を行う Windows / macOS 向け Electron デスクトップアプリです。画像の変換には libjxl の `cjxl`、プレビューの復号には `djxl` を使います。

作者: [yomotsu](https://github.com/yomotsu) ・ ダウンロード: [Releases](https://github.com/yomotsu/jxlpress/releases) ・ 不具合の報告: [Issues](https://github.com/yomotsu/jxlpress/issues)

## ライセンス

アプリ本体は MIT ライセンスです（Copyright (c) 2026 yomotsu、`LICENSE`）。同梱物のライセンスは [`licenses/THIRD_PARTY_NOTICES.txt`](licenses/THIRD_PARTY_NOTICES.txt) を確認してください。

HEIC / HEIF のデコードに使う `libheif-js`（libheif / libde265 を含む）は LGPL-3.0 です。これらは改変せずに使用し、アプリのアーカイブ外の `app.asar.unpacked/node_modules/libheif-js/` に配置して、差し替え可能にしています。

HEVC（HEIC）のデコードには特許ライセンス上の論点があります。本アプリは無償で配布します。

## 機能

- Distance（整数 0〜10、既定 2）と Effort を指定して JPEG XL に変換。「ロスレス」のチェックは Distance 0 と連動
- 追加の `cjxl` 引数、Modular、EPF、Gaborish、スレッド数などを詳細オプションで設定
- 出力先は既定でデスクトップ。任意のフォルダや「元と同じ場所」も選択でき、同名ファイルは改名・上書き・スキップを選択
- EXIF は既定で引き継ぎ。オプトアウトでき、XMP / JUMBF も個別に削除可能
- 複数画像やフォルダをまとめてドロップし、並列変換
- ファイルメニューやクリップボードから画像を追加し、最近使った項目から再追加
- 現在の設定で JXL を生成し、元画像とスライダーで比較プレビュー
- HEIC / HEIF は main プロセスで libheif-js（WASM）によりデコードし、ICC / nclx の色情報と EXIF を引き継ぐ
- JPEG は自動判定し、常にロスレス再圧縮（元の JPEG をビット単位で復元可能）。Distance / Effort は JPEG 以外にだけ効き、一覧が JPEG だけのときは入力が無効になる

`cjxl` / `djxl` はアプリに同梱し、UI には出しません。

## 利用者向け

起動時に GitHub Releases を確認し、新しい版があるときだけウィンドウ右下に「新しいバージョンがあります」と表示します（押すとダウンロードページが開きます）。自動ではインストールしません。ヘルプ →「アップデートを確認…」からも確認できます。更新確認でアプリが通信する先は `api.github.com` のみで、送る情報は User-Agent に含まれるアプリのバージョンだけです。

### インストール

**macOS**: dmg を開き、アプリを「アプリケーション」フォルダにコピーします。初回起動時に「"JXLPress.app"は開かれていません」と表示されたら、「完了」を押し（「ゴミ箱に入れる」は押さない）、「システム設定 → プライバシーとセキュリティ」の下部に表示される「このまま開く」を押してから起動してください。それでも「壊れているため開けません」と表示される場合は、ターミナルで次を実行してください。

```sh
xattr -dr com.apple.quarantine "/Applications/JXLPress.app"
```

**Windows**: インストーラー（`JXLPress-<version>-win-x64-setup.exe`）またはポータブル版（`JXLPress-<version>-win-x64-portable.exe`）を実行します。SmartScreen に「Windows によって PC が保護されました」と表示されたら、「詳細情報」→「実行」を選んでください。

## 開発者向け

### 開発

```sh
npm install
npm start
```

開発時は `vendor/cjxl/<platform>-<arch>/` の同梱用バイナリを使い、なければ PATH 上の `cjxl` / `djxl` を使います。

### 同梱する libjxl の用意

最新リリースの libjxl を次の場所に置きます（git 管理外）。

```text
vendor/cjxl/win32-x64/cjxl.exe, djxl.exe
vendor/cjxl/darwin-arm64/cjxl, djxl
vendor/cjxl/darwin-x64/cjxl, djxl
```

**Windows**: 公式リリースの静的ビルドを取得します。

```sh
npm run fetch-cjxl -- --platform win32
```

**macOS**: libjxl は macOS 用バイナリを配布しておらず、Homebrew 版は動的リンクで同梱できないため、ソースから静的ビルドします。Xcode Command Line Tools・git・python3 が必要です（cmake / ninja は `.build-cjxl/venv` に自動で入ります）。

```sh
npm run build-cjxl-mac                 # 最新リリースを arm64 と x64 でビルド
npm run build-cjxl-mac -- v0.13.0 arm64 # タグとアーキテクチャを指定
```

依存はシステムの `libSystem` と `libc++` のみ（`otool -L` で確認できます）。GIF 入力用に giflib も静的リンクします。

### 配布ビルド

```sh
npm run dist:win   # NSIS インストーラーとポータブル版（x64）
npm run dist:mac   # dmg（arm64 / x64）
```

Electron Builder の `extraResources` が `vendor/cjxl/<platform>-<arch>/` を `Resources/bin/` に同梱します。macOS は ad-hoc 署名のみで公証しておらず、Windows は署名していません。

成果物は `dist/` に生成されます。macOS 版は `JXLPress-<version>-mac-arm64.dmg` と `JXLPress-<version>-mac-x64.dmg`、Windows 版は `JXLPress-<version>-win-x64.exe` などです。

### cjxl の検出順

1. パッケージに同梱した `Resources/bin/cjxl`
2. 開発用の `vendor/cjxl/<platform>-<arch>/cjxl`
3. PATH 上の `cjxl`

`djxl` は `cjxl` と同じディレクトリを先に探し、その後 PATH を確認します。

### 入力形式とメタデータ

入力形式は PNG / APNG / GIF / JPEG / HEIC / HEIF / WebP / AVIF / BMP / ICO / PPM / PNM / PFM / PAM / PGX / JXL です。BMP はドロップゾーンの対応形式表示から省いていますが、入力できます。WebP / AVIF / BMP / ICO は Chromium で PNG にデコードしてから変換し、HEIC / HEIF は main プロセスで libheif-js（WASM）により PAM にデコードしてから変換します。

EXIF は既定で引き継ぎます。WebP は読み込み時に EXIF を取り出して引き継ぎます。HEIC / HEIF は EXIF と ICC または nclx の色情報を引き継ぎます。Chromium 経由で処理する AVIF / BMP / ICO は EXIF を引き継げません。

