const axios = require('axios');
const _ = require('lodash');

const SIMKL_API_URL = 'https://api.simkl.com';
const CLIENT_ID = process.env.SIMKL_CLIENT_ID;

module.exports.getTrending = async function () {
  try {
    const response = await axios.get(`${SIMKL_API_URL}/anime/trending?extended=full&client_id=${CLIENT_ID}`);
    return _.get(response, 'data', []).map(m => ({ 
      mal_id: m.ids.mal, 
      simkl_id: m.ids.simkl, 
      tvdb_id: m.ids.tvdb, 
      title: m.title 
    }));
  } catch (error) {
    console.error('Simkl Trending Error:', error.message);
    return [];
  }
};

module.exports.getMetadata = async function (malId) {
  try {
    // 1. Search for Simkl ID by MAL ID
    const searchResponse = await axios.get(`${SIMKL_API_URL}/search/id?mal=${malId}&client_id=${CLIENT_ID}`);
    const simklId = _.get(searchResponse, 'data[0].ids.simkl');
    
    if (!simklId) return null;

    return module.exports.getFullMetadata(simklId);
  } catch (e) {
    return null;
  }
};

module.exports.getFullMetadata = async function (simklId) {
  try {
    const fullResponse = await axios.get(`${SIMKL_API_URL}/anime/${simklId}?extended=full&client_id=${CLIENT_ID}`);
    const data = fullResponse.data;

    return {
      tvdb_id: _.get(data, 'ids.tvdb'),
      imdb_id: _.get(data, 'ids.imdb'),
      simkl_id: simklId
    };
  } catch (e) {
    return null;
  }
};
