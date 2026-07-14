import { useMemo, useState } from 'react';
import { posZh } from '../lib/dict';
import { dueItems, removeSaved, review, useWordbook, type WordbookItem } from '../lib/wordbook';

export default function WordbookPage() {
  const items = useWordbook();
  const [mode, setMode] = useState<'list' | 'review'>('list');

  if (items.length === 0) {
    return <div className="notice">生词本还是空的 —— 去查词页把想记的单词加进来吧 ☆</div>;
  }

  return mode === 'list' ? (
    <ListView items={items} onStartReview={() => setMode('review')} />
  ) : (
    <ReviewView onDone={() => setMode('list')} />
  );
}

function ListView({ items, onStartReview }: { items: WordbookItem[]; onStartReview: () => void }) {
  const due = dueItems().length;
  return (
    <div>
      <div className="wordbook-toolbar">
        <span>共 {items.length} 个单词,{due} 个待复习</span>
        <button className="btn-primary" onClick={onStartReview} disabled={due === 0}>
          开始复习 ({due})
        </button>
      </div>
      <div className="results">
        {items.map((i) => (
          <div key={i.id} className="result-card static">
            <div className="result-head">
              <span className="result-word" dir="rtl" lang="ar">{i.voc}</span>
              <span className="result-roman">{i.roman}</span>
              <span className="badge pos">{posZh(i.pos)}</span>
              <span className="badge box">熟练度 {i.box}/6</span>
              <button className="btn-remove" title="移出生词本" onClick={() => removeSaved(i.id)}>
                ✕
              </button>
            </div>
            <div className="result-gloss">
              {i.zh && <span className="gloss-zh">{i.zh.split(';').join('、')}</span>}
              <span className="gloss-en">{i.en}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewView({ onDone }: { onDone: () => void }) {
  const queue = useMemo(() => shuffle(dueItems()), []);
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ known: 0, unknown: 0 });

  if (pos >= queue.length) {
    return (
      <div className="review-done">
        <h2>复习完成 🎉</h2>
        <p>
          认识 {stats.known} 个 · 不认识 {stats.unknown} 个
        </p>
        <button className="btn-primary" onClick={onDone}>
          返回生词本
        </button>
      </div>
    );
  }

  const card = queue[pos];
  const grade = (known: boolean) => {
    review(card.id, known);
    setStats((s) => ({ known: s.known + (known ? 1 : 0), unknown: s.unknown + (known ? 0 : 1) }));
    setRevealed(false);
    setPos(pos + 1);
  };

  return (
    <div className="review">
      <div className="review-progress">
        {pos + 1} / {queue.length}
        <button className="btn-plain" onClick={onDone}>
          退出复习
        </button>
      </div>
      <div className="flashcard" onClick={() => setRevealed(true)}>
        <div className="flash-word" dir="rtl" lang="ar">
          {card.voc}
        </div>
        {revealed ? (
          <div className="flash-back">
            <div className="flash-roman">{card.roman}</div>
            <div className="flash-zh">{card.zh ? card.zh.split(';').join('、') : ''}</div>
            <div className="flash-en">{card.en}</div>
          </div>
        ) : (
          <div className="flash-hint">点击显示释义</div>
        )}
      </div>
      {revealed && (
        <div className="review-buttons">
          <button className="btn-unknown" onClick={() => grade(false)}>
            😵 不认识
          </button>
          <button className="btn-known" onClick={() => grade(true)}>
            😄 认识
          </button>
        </div>
      )}
    </div>
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
