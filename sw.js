// 【ここに貼る】GitHub Pages ルートの sw.js（Service Worker：?v=不要化 & 毎回新鮮なHTMLを取得）
const CACHE_NAME = 'presence-pages-cache-prod-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c)=>c.addAll([])).catch(()=>{}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

// ネットワーク優先（HTMLは常に no-store で取りに行く）
self.addEventListener('fetch', (e) => {
  const req = e.request;

  // HTMLナビゲーションは常に最新
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))) {
    e.respondWith((async()=>{
      try{
        return await fetch(req, { cache: 'no-store' });
      }catch{
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match('/');
        return cached || new Response('<!doctype html><title>オフライン</title><h1>オフライン</h1>', {headers:{'Content-Type':'text/html; charset=utf-8'}});
      }
    })());
    return;
  }

  // それ以外も原則ネットワーク優先＋no-store（必要ならキャッシュに落とす）
  e.respondWith((async()=>{
    try{
      const res = await fetch(req, { cache: 'no-store' });
      return res;
    }catch{
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      throw new Error('offline');
    }
  })());
});
