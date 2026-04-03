const axios = require('axios');
const _ = require('lodash');

const JIKAN_API_URL = 'https://api.jikan.moe/v4';

module.exports.getAiring = async function () {
  try {
    const response = await axios.get(`${JIKAN_API_URL}/top/anime`, {
      params: { filter: 'airing', limit: 25 }
    });
    return _.get(response, 'data.data', []).map(m => ({ mal_id: m.mal_id, score: m.score, popularity: m.popularity, source: 'MAL_AIRING' }));
  } catch (error) {
    console.error('Jikan Airing Error:', error.message);
    return [];
  }
};

module.exports.getUpcoming = async function () {
  try {
    const response = await axios.get(`${JIKAN_API_URL}/top/anime`, {
      params: { filter: 'upcoming', limit: 25 }
    });
    return _.get(response, 'data.data', []).map(m => ({ mal_id: m.mal_id, source: 'MAL_UPCOMING' }));
  } catch (error) {
    console.error('Jikan Upcoming Error:', error.message);
    return [];
  }
};
