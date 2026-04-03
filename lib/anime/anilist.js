const axios = require('axios');
const _ = require('lodash');

const ANILIST_API_URL = 'https://graphql.anilist.co';

const query = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    media(season: $season, seasonYear: $seasonYear, type: ANIME, status_in: [RELEASING, NOT_YET_RELEASED]) {
      id
      idMal
      title {
        english
        romaji
      }
      status
      episodes
      genres
      tags {
        name
        rank
      }
      averageScore
      popularity
      trending
      description
      studios(isMain: true) {
        nodes {
          name
        }
      }
      startDate {
        year
        month
        day
      }
      coverImage {
        extraLarge
      }
      externalLinks {
        url
        site
      }
    }
  }
}
`;

function getCurrentSeason() {
  const month = new Date().getMonth();
  if (month >= 0 && month <= 2) return 'WINTER';
  if (month >= 3 && month <= 5) return 'SPRING';
  if (month >= 6 && month <= 8) return 'SUMMER';
  return 'FALL';
}

module.exports.getSeasonal = async function () {
  const season = getCurrentSeason();
  const year = new Date().getFullYear();
  
  try {
    const response = await axios.post(ANILIST_API_URL, {
      query,
      variables: { season, seasonYear: year, page: 1 }
    });

    const media = _.get(response, 'data.data.Page.media', []);
    return media.filter(m => !m.isAdult).map(m => {
      // Extract TVDB ID
      const tvdbLink = m.externalLinks.find(l => l.site === 'TVDB' || l.url.includes('thetvdb.com'));
      if (tvdbLink) {
        const match = tvdbLink.url.match(/series\/([^\/\?]+)/);
        if (match) {
          m.idTvdb = match[1];
        } else if (tvdbLink.url.includes('id=')) {
          const idMatch = tvdbLink.url.match(/id=(\d+)/);
          if (idMatch) m.idTvdb = idMatch[1];
        }
      }

      // Extract IMDB ID
      const imdbLink = m.externalLinks.find(l => l.site === 'IMDb' || l.url.includes('imdb.com'));
      if (imdbLink) {
        const match = imdbLink.url.match(/title\/(tt\d+)/);
        if (match) m.idImdb = match[1];
      }

      return m;
    });
  } catch (error) {
    console.error('AniList Error:', error.message);
    return [];
  }
};
