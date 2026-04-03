const axios = require('axios');
const _ = require('lodash');
const moment = require('moment');

const REDDIT_KARMA_URL = 'https://animekarmalist.com/api/episodes';

module.exports.getWeeklyKarma = async function () {
  try {
    const end = moment().toISOString();
    const start = moment().subtract(7, 'days').toISOString();

    const response = await axios.get(REDDIT_KARMA_URL, {
      params: { start, end, offset: 0 }
    });

    return _.get(response, 'data', []).map(m => ({
      title: m.name,
      mal_id: m.malId,
      anilist_id: m.anilistId,
      reddit_karma: m.karma,
      reddit_comments: m.commentCount,
      score_anilist: m.anilistScore,
      source: 'Reddit'
    }));
  } catch (error) {
    console.error('Reddit Karma Error:', error.message);
    return [];
  }
};
