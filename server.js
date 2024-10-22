#!/usr/bin/env node
const Index = require('./index')
const express = require('express')
const tmdb = require('./lib/tmdb')
const app = express()

let genreMap;

app.get('/movies', async function (req, res) {
  console.log('Query parameters', req.query)

  if (!genreMap) {
    const genres = await tmdb.getGenres()
    genreMap = new Map(genres.genres.map(genre => [genre.name.toLowerCase(), genre.id]))
  }

  if (req.query.excl_genre) {
    req.query.excl_genre_id = genreMap.get(req.query.excl_genre)
  }

  const listBuilder = new Index()
  const movies = await listBuilder.filter(req.query)
  res.json(movies)
})

app.listen(3000)
