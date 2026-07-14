# 阿拉伯语词典 قاموس

离线阿拉伯语↔中文查词网页应用。数据来自 Wiktionary(经 kaikki.org 抽取,CC BY-SA)与 CC-CEDICT(中文桥接),中文候选用 jieba 词频表排序。

## 功能

- **阿→中查词**:不需要输入元音符号;输入动词变位形式(如 يكتب)也能反查到原形
- **中→阿查词**:直接输入中文(如「图书馆」)
- **英文/罗马音查词**:输入 kitab 或 library 也可以
- **词条详情**:词根、动词式(I–X)、中英释义、例句、同根词、完整词形变化表(中文语法标签)
- **生词本**:收藏单词,localStorage 持久化,自带简单间隔复习(Leitner 盒)

## 目录结构

```
arabic-dict/
├── data/raw/          原始数据(kaikki JSONL、CC-CEDICT、jieba 词频表)
├── pipeline/build.mjs 数据管线:原始数据 → app/public/dict/
└── app/               Vite + React + TypeScript 前端
    └── public/dict/   生成的词典数据(index.json / chunks/ / forms/)
```

## 使用

```bash
# 启动开发服务器
cd app && npm install && npm run dev

# 重新生成词典数据(改了 pipeline 之后)
node pipeline/build.mjs

# 打包部署(纯静态,可放任何静态托管)
cd app && npm run build   # 产物在 app/dist/
```

## 数据说明

- 词条 26,013 个,其中 9,404 个含词根、约 1.8 万个含中文释义
- 中文释义是「阿→英→中」自动桥接的,可能有偏差,词条页有英文原释义可对照
- 变化形反查索引约 27 万键,按首字母分片按需加载

## 已知限制 / 后续方向

- 中文桥接质量依赖英文释义的规整程度,专业词汇可能给出偏门译名
- 未收录方言词汇(数据源以标准语 MSA 为主)
- 后续可做:发音朗读(TTS)、词根检索页、按教材单元的词表导入、PWA 离线缓存、手机 App(复用本数据管线)
