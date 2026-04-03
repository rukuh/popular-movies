const axios = require('axios');
const _ = require('lodash');

const KITSU_API_URL = 'https://kitsu.io/api/edge';

module.exports.getTrending = async function () {
  try {
    const response = await axios.get(`${KITSU_API_URL}/trending/anime`, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json'
      }
    });

    return _.get(response, 'data.data', []).map(m => {
      const attr = m.attributes;
      return {
        id: m.id,
        title: attr.titles.en || attr.titles.en_jp || attr.titles.ja_jp,
        score: attr.averageRating,
        popularityRank: attr.popularityRank,
        ratingRank: attr.ratingRank,
        userCount: attr.userCount,
        status: attr.status,
        source: 'Kitsu'
      };
    });
  } catch (error) {
    console.error('Kitsu Trending Error:', error.message);
    return [];
  }
};
