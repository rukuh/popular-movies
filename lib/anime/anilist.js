const axios = require('axios');
const _ = require('lodash');

const ANILIST_API_URL = 'https://graphql.anilist.co';

const query = `
query ($season: MediaSeason, $seasonYear: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    media(season: $season, seasonYear: $seasonYear, type: ANIME, status_in: [RELEASING, NOT_YET_RELEASED, FINISHED], sort: POPULARITY_DESC) {
      id
      idMal
      title {
        english
        romaji
      }
      status
      season
      seasonYear
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
      relations {
        edges {
          relationType
          node {
            id
            type
          }
        }
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

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

function getPreviousSeason(season, year) {
  const idx = SEASONS.indexOf(season);
  if (idx === 0) {
    return { season: 'FALL', year: year - 1 };
  }
  return { season: SEASONS[idx - 1], year };
}

function getUpcomingSeason(season, year) {
  const idx = SEASONS.indexOf(season);
  if (idx === 3) {
    return { season: 'WINTER', year: year + 1 };
  }
  return { season: SEASONS[idx + 1], year };
}

module.exports.getCurrentSeason = getCurrentSeason;

module.exports.getSeasonal = async function () {
  const now = new Date();
  const m = now.getMonth();
  const d = now.getDate();
  const year = now.getFullYear();
  const currentSeason = getCurrentSeason();

  const seasonsToFetch = [{ season: currentSeason, year }];

  // Transition window check:
  // - Last month of season (month % 3 === 2) and day >= 16: fetch upcoming
  // - First month of season (month % 3 === 0) and day <= 15: fetch previous
  if (m % 3 === 2 && d >= 16) {
    seasonsToFetch.push(getUpcomingSeason(currentSeason, year));
  } else if (m % 3 === 0 && d <= 15) {
    seasonsToFetch.push(getPreviousSeason(currentSeason, year));
  }
  
  try {
    const results = await Promise.all(
      seasonsToFetch.map(async ({ season, year: sYear }) => {
        const response = await axios.post(ANILIST_API_URL, {
          query,
          variables: { season, seasonYear: sYear, page: 1 }
        });
        return _.get(response, 'data.data.Page.media', []);
      })
    );

    const combinedMedia = _.uniqBy(_.flatten(results), 'id');

    return combinedMedia.filter(m => !m.isAdult).map(m => {
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

      // Map relations helper
      m.relations = m.relations ? m.relations.edges.map(e => ({
        relationType: e.relationType,
        nodeType: e.node.type,
        nodeId: e.node.id
      })) : [];

      return m;
    });
  } catch (error) {
    console.error('AniList Error:', error.message);
    return [];
  }
};
