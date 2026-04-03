const express = require('express')
const flatCache = require('flat-cache')
const Index = require('./index.js')
const AnimeIndex = require('./lib/anime/index.js')
const path = require('path')

const app = express()

// 1. Initialize Cache
// Saves to 'movie_cache.json' in '/app/data' folder
const cache = flatCache.load('movie_cache', path.resolve('/app/data'));

app.get('/health', (req, res) => {
  res.status(200).send('Ok');
});

const handleRequest = async function (req, res, listBuilderClass, cachePrefix) {
  // 2. Create a unique key based on the user's query
  // e.g., "movies_genre=action&year=2023" becomes the key
  const cacheKey = `${cachePrefix}_${JSON.stringify(req.query)}`;

  // 3. Check Cache
  const now = Date.now();
  if (req.query.clear_cache === 'true') {
    cache.removeKey(cacheKey);
    console.log(`Cache cleared for key: ${cacheKey}`);
  }
  const cachedItem = cache.getKey(cacheKey);

  if (cachedItem && cachedItem.expiry > now) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'cache_hit',
      key: cacheKey,
      timestamp: new Date().toISOString()
    }));
    return res.json(cachedItem.value);
  }

  // 4. If not in cache, run your original logic
  console.log(JSON.stringify({
    level: 'info',
    event: 'cache_miss',
    key: cacheKey,
    referer: req.get('referer'),
    clientIp: req.socket.remoteAddress,
    query: req.query,
    timestamp: new Date().toISOString()
  }));

  try {
    const listBuilder = new listBuilderClass()
    const results = await listBuilder.evaluate(req.query)

    // 5. Save result to cache (Expire in 24 hours)
    cache.setKey(cacheKey, {
      value: results,
      expiry: now + (24 * 60 * 60 * 1000) // 24 Hours
    });
    cache.save(true); // Persist to disk

    res.json(results)
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'request_failed',
      cacheKey,
      message: error.message,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
}

app.get('/movies', (req, res) => handleRequest(req, res, Index, 'movies'))
app.get('/anime', (req, res) => handleRequest(req, res, AnimeIndex, 'anime'))

app.listen(3000, () => console.log('Server running on 3000'))
