/* 阿拉伯语词典 Service Worker —— 手写,无框架依赖
 *
 * 下面三行常量由 `node pipeline/make-sw.mjs <构建目录>` 在构建后改写,
 * 源文件里保留可运行的默认值,所以直接看这个文件也是合法 JS。
 * 改写靠行尾的 /*__XXX__*\/ 标记做正则定位 —— 别删这些注释。
 */
const BUILD = '20a742d9a7'; /*__BUILD__*/
const DATA_VERSION = '9a19888a6b'; /*__DATA__*/
const APP_SHELL = ["./","./index.html","./manifest.webmanifest","./assets/index-BHz3YuKq.js","./assets/index-QklgQS2S.css","./icons/apple-touch-icon.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png"]; /*__SHELL__*/

// sw.js 位于部署根目录,所以它自己的位置就是 scope(线上是 /arabic-dict/)
const BASE = new URL('./', self.location).href;
const INDEX_URL = BASE;
const DICT_PREFIX = BASE + 'dict/';

const SHELL_CACHE = `dict-shell-${BUILD}`;
const DATA_CACHE = `dict-data-${DATA_VERSION}`;

// 装完即可离线全库搜索的三个文件(约 3.3MB),放 DATA 缓存,
// 这样只改前端重新部署时不会白白重下 index.json
const CORE_DATA = ['dict/index.json', 'dict/meta.json', 'dict/roots.json'].map(
  (p) => BASE + p,
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      // 逐个 put,避免 addAll 里任何一个 404 就整体失败
      await Promise.all(
        APP_SHELL.map(async (path) => {
          const url = new URL(path, BASE).href;
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok) await shell.put(url, res);
          } catch {
            /* 单个资源失败不阻断安装 */
          }
        }),
      );

      const data = await caches.open(DATA_CACHE);
      await Promise.all(
        CORE_DATA.map(async (url) => {
          if (await data.match(url, { ignoreVary: true })) return; // 同版本数据已在,跳过
          try {
            const res = await fetch(url);
            if (res.ok) await data.put(url, res);
          } catch {
            /* 离线安装时拿不到就算了,联网后按需缓存会补上 */
          }
        }),
      );
    })(),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, DATA_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.map((n) => (keep.has(n) ? null : caches.delete(n))),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', build: BUILD, data: DATA_VERSION });
  }
});

/** 缓存优先:命中直接返回,否则联网并写入缓存
 *
 * 断网且没缓存时必须返回一个 !ok 的 Response,不能让 fetch 直接 reject ——
 * dict.ts 里 lookupFormShard / getEntry 都只判断 res.ok,抛异常会让整个
 * search() 挂掉(实测:离线搜 كتاب,只因 forms/643.json 没缓存就整页无结果)。
 * 返回 504 + "{}" 后,这两处会各自退化成「没有变化形」「取不到词条」,
 * 索引里的精确/前缀匹配照常出结果。
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  // ignoreVary 必须加:预缓存是用普通 fetch(no-cors)存的,而页面里
  // <script type="module"> 发的是 CORS 请求带 Origin 头。服务器只要回一个
  // Vary: Origin(vite preview 就会),两者就对不上,离线时整包 assets 全落空。
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // 只缓存成功的同源响应(opaque / 206 不缓存)
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    return new Response('{}', {
      status: 504,
      statusText: 'Offline and not cached',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

/** 导航请求:网络优先,断网回退到缓存的 index.html(带 ?tab= 时也能命中) */
async function navigationHandler(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(INDEX_URL, res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const opts = { ignoreSearch: true, ignoreVary: true };
    return (
      (await cache.match(INDEX_URL, opts)) ||
      (await cache.match(BASE + 'index.html', opts)) ||
      new Response('离线且尚未缓存页面', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // 跳过 POST(含 DeepSeek 调用)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 跨域一律不接管
  if (!url.href.startsWith(BASE)) return; // scope 外不管

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // 词典数据:chunks / forms 共 93MB,查到才下;index/meta/roots 装机时已预缓存
  if (url.href.startsWith(DICT_PREFIX)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  // 其余 app shell 资源(带 hash 的 assets、图标、manifest)
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
