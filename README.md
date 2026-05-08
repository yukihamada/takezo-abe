# 阿部武蔵 ABE Takezo — Personal Site

> 車椅子で、世界一になった。<br>
> パラ柔術を、人と人をつなぐ共通言語へ。

公開URL: **https://takezo.jiuflow.com/**

## 構成

- 静的HTML（日本語 `/` ＋ 英語 `/en/`）
- Cloudflare Pages にホスティング
- Cloudflare Pages Functions で `/api/content` を提供
- Cloudflare KV (`takezo-content`) でコンテンツ永続化
- パスワード認証付き編集画面 `/edit/`

## ディレクトリ構造

```
takezo-abe/
├── index.html              # 日本語LP
├── en/index.html           # 英語LP
├── edit/index.html         # 管理者向け編集画面（パスワード認証）
├── functions/api/content.js  # Pages Function: GET/POST content
├── assets/
│   ├── img/                # 写真（オリジナル + crops/ 顔位置最適化版）
│   ├── video/highlight.mp4 # ハイライト動画
│   ├── favicon.svg / .ico / *.png
│   └── site.webmanifest
├── _headers                # Cloudflare セキュリティヘッダ
├── sitemap.xml
└── robots.txt
```

## デプロイ

```bash
wrangler pages deploy . --project-name=takezo-abe --branch=main --commit-dirty=true
```

## 環境変数（Cloudflare Pages）

- `EDIT_PASSWORD` — `/edit/` のログインパスワード
- `CONTENT` — KV namespace バインディング（コンテンツ永続化）

## 編集方法

1. https://takezo.jiuflow.com/edit/ にアクセス
2. パスワードを入力
3. 全項目を編集
4. 「保存」ボタンで本番に即反映

## クレジット

- Sponsored by [JIUFLOW](https://jiuflow.com)
- Photographs: ABE Takezo / YAWARA JIU-JITSU ACADEMY / SWEEP
- Master: Ryozo Murata, 7th-degree Black Belt (SJJJF)
