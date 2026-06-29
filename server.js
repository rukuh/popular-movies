const express = require('express')
const flatCache = require('flat-cache')
const Index = require('./index.js')
const AnimeIndex = require('./lib/anime/index.js')
const BooksIndex = require('./lib/books/index.js')
const path = require('path')
const moment = require('moment')

const app = express()

// 1. Initialize Cache
// Saves to 'movie_cache.json' in '/app/data' folder
const cache = flatCache.load('movie_cache', path.resolve('/app/data'));

app.get('/health', (req, res) => {
  res.status(200).send('Ok');
});

const handleRequest = async function (req, res, listBuilderClass, cachePrefix) {
  // Extract limit and clear_cache from query parameters for key normalization
  const queryParams = { ...req.query };
  const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : null;
  const clearCache = queryParams.clear_cache === 'true';

  delete queryParams.limit;
  delete queryParams.clear_cache;

  // Create a unique key based on the normalized user query (excluding limit/clear_cache)
  const cacheKey = `${cachePrefix}_${JSON.stringify(queryParams)}`;

  // Check Cache
  const now = Date.now();
  if (clearCache) {
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
    const results = cachedItem.value;
    const finalResults = limit ? results.slice(0, limit) : results;
    return res.json(finalResults);
  }

  // If not in cache, run evaluation
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
    // Pass original query params so ListBuilder receives them, but evaluate returns full list (if limit is handled in server)
    // Actually, let's pass req.query so ListBuilder still runs fine, but we cache the full evaluated list.
    // Wait, if ListBuilder evaluates with limit, it will slice inside the builder and return sliced results.
    // To cache the full results, we should request evaluation without a limit from the builder!
    const evalParams = { ...req.query };
    delete evalParams.limit; // Make sure the builder returns the full list

    const results = await listBuilder.evaluate(evalParams)

    // Save full results to cache (Expire in 24 hours)
    cache.setKey(cacheKey, {
      value: results,
      expiry: now + (24 * 60 * 60 * 1000) // 24 Hours
    });
    cache.save(true); // Persist to disk

    const finalResults = limit ? results.slice(0, limit) : results;
    res.json(finalResults)
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
app.get('/books', (req, res) => handleRequest(req, res, BooksIndex, 'books'))

// Automated Weekly Sync for Books
// Run every Wednesday at 7:00 PM
const runWeeklySync = async () => {
  const now = moment();
  // Check if it's Wednesday (day 3) and the hour is 19 (7 PM)
  if (now.day() === 3 && now.hour() === 19) {
    console.log('Triggering automated weekly book sync...');
    try {
      const booksIndex = new BooksIndex();
      await booksIndex.sync();
      console.log('Automated weekly book sync completed successfully.');
    } catch (err) {
      console.error('Automated weekly book sync failed:', err.message);
    }
  }
};

// Check every hour
setInterval(runWeeklySync, 60 * 60 * 1000);

app.listen(3000, () => console.log('Server running on 3000'))
