const Promise = require('bluebird');
const _ = require('lodash');
const moment = require('moment');
const anilist = require('./anilist');
const jikan = require('./jikan');
const simkl = require('./simkl');
const kitsu = require('./kitsu');
const reddit = require('./reddit');
const ai = require('../ai');

const evaluateAnime = async function (combinedData, anticipated = false, preferences = {}) {
  const { disliked_genres = [], disliked_tags = [] } = preferences;
  const system = `
You are an expert anime critic. Your goal is to suggest a "must-watch" list (Top 12-15) from the current season.

You will be given aggregated data points for each show:
1. METADATA (AniList): Title, Studio, Genres, Tags, Description.
2. CONSENSUS SCORES (MAL + AniList + Kitsu): Average "Quality" signals.
3. HYPE SIGNALS (Reddit Karma + AniList Popularity): Real-time "What's Hot" metrics.
4. PLATFORM SIGNAL (Simkl): Peer trending data.

JUDGMENT CRITERIA:
- OVERLAP: Shows appearing across many sources are high-confidence hits.
- QUALITY VS HYPE: Balance high-rated classics with currently trending/hyped shows.
- SEQUELS: Sequels to highly-rated shows are strong contenders.
- HIDDEN GEMS: Consider shows with high Reddit Karma or Simkl trending even if scores are lower.
${!_.isEmpty(disliked_genres) ? `- I strongly dislike the following genres: ${disliked_genres.join(', ')}. You MUST weigh these extremely negatively. Only include them if they are the absolute "top-tier" standouts of the season (e.g., Score > 85 or universal acclaim). Exclude them if they are merely popular or trending.` : ''}
${!_.isEmpty(disliked_tags) ? `- I strongly dislike shows with these tags: ${disliked_tags.join(', ')}. You MUST weigh these extremely negatively. Only include them if they are absolute "top-tier" standouts of the season (e.g., Score > 85). Exclude them if they are merely popular or trending.` : ''}

${anticipated ? 'NOTE: This list includes highly anticipated upcoming shows.' : 'NOTE: This list focuses on currently airing shows.'}

Return the IDs of the chosen shows in a JSON array. 
Return ONLY the JSON.

Example JSON output:
\`\`\`json
[
  { "id": "internal_id", "reasoning": "Brief explanation of why this show is included (mentioning specific signals like 'High Reddit Hype' or 'Global Consensus')." },
  ...
]
\`\`\`
`;

  try {
    // Optimize payload by removing descriptions for AI evaluation to save tokens
    const optimizedData = {
      masterList: combinedData.masterList.map(m => _.omit(m, ['description'])),
      malRanking: combinedData.malRanking
    };
    return await ai.prompt(system, JSON.stringify(optimizedData));
  } catch (e) {
    console.error('AI evaluation failed, fallback to weighted ranking.', e.message);
    
    return _.chain(combinedData.masterList)
      .filter(a => !!a.title)
      .map(a => {
        // Simple weighted score: (AL * 0.3) + (MAL * 0.3) + (Reddit/100 * 0.4)
        const alScore = (a.score_anilist || 0);
        const malScore = (a.score_mal || 0) * 10; // Normalize 0-10 to 0-100
        const redditScore = Math.min((a.reddit_karma || 0) / 50, 100); // Caps at 5000 karma
        
        a.fallback_weight = (alScore * 0.3) + (malScore * 0.3) + (redditScore * 0.4);
        if (a.on_simkl_trending) a.fallback_weight += 5; // Bonus for platform signal
        
        return a;
      })
      .orderBy(['fallback_weight'], ['desc'])
      .take(15)
      .map(a => ({ id: a.id, reasoning: 'Ranked by consensus of scores, reddit hype, and platform trending.' }))
      .value();
  }
};

const getAggregatedData = async function () {
  const [ani, malAiring, malUpcoming, sim, kit, red] = await Promise.all([
    anilist.getSeasonal(),
    jikan.getAiring(),
    jikan.getUpcoming(),
    simkl.getTrending(),
    kitsu.getTrending(),
    reddit.getWeeklyKarma()
  ]);

  const masterList = [];
  
  // 1. Initialize with AniList (Primary Metadata Source)
  ani.forEach(a => {
    if (!a.title.english && !a.title.romaji) return;
    masterList.push({
        id: `ani_${a.id}`,
        title: a.title.english || a.title.romaji,
        mal_id: a.idMal,
        anilist_id: a.id,
        tvdb_id: a.idTvdb,
        imdb_id: a.idImdb,
        score_anilist: a.averageScore,
        popularity_anilist: a.popularity,
        trending_anilist: a.trending,
        genres: (a.genres || []).map(g => _.snakeCase(g).toLowerCase()),
        tags: _.chain(a.tags || [])
          .filter(t => t.rank > 50)
          .map(t => _.snakeCase(t.name).toLowerCase())
          .uniq()
          .value(),
        studio: a.studios.nodes[0]?.name,
        status: a.status,
        description: a.description,
        source: 'AniList'
    });
  });

  // 2. Merge MAL Signals
  const malMap = _.keyBy([...malAiring, ...malUpcoming], 'mal_id');
  masterList.forEach(m => {
    if (m.mal_id && malMap[m.mal_id]) {
      m.score_mal = malMap[m.mal_id].score;
      m.popularity_mal = malMap[m.mal_id].popularity;
      m.is_airing = malMap[m.mal_id].source === 'MAL_AIRING';
    }
  });

  // 3. Merge Simkl (Platform Signal + IDs)
  sim.forEach(s => {
    const existing = s.mal_id ? masterList.find(m => m.mal_id === s.mal_id) : null;
    if (existing) {
        existing.simkl_id = s.simkl_id;
        if (!existing.tvdb_id) existing.tvdb_id = s.tvdb_id;
        if (!existing.imdb_id) existing.imdb_id = s.imdb_id;
        existing.on_simkl_trending = true;
    }
  });

  // 4. Merge Kitsu (Consensus Signal)
  kit.forEach(k => {
    const existing = masterList.find(m => m.title && k.title && m.title.toLowerCase() === k.title.toLowerCase());
    if (existing) {
      existing.score_kitsu = k.score;
      existing.popularity_rank_kitsu = k.popularityRank;
    }
  });

  // 5. Merge Reddit (Hype Signal)
  red.forEach(r => {
    const existing = r.mal_id ? masterList.find(m => m.mal_id === r.mal_id) : 
                     masterList.find(m => m.title && r.title && m.title.toLowerCase() === r.title.toLowerCase());
    if (existing) {
      existing.reddit_karma = r.reddit_karma;
      existing.reddit_comments = r.reddit_comments;
    }
  });

  return {
    masterList,
    malRanking: [...malAiring, ...malUpcoming]
  };
};

module.exports = (function () {
  let allAnime = null;

  const getAnime = function () {
    if (allAnime) {
      return Promise.resolve(allAnime);
    }

    return Promise.resolve(getAggregatedData())
      .tap(function (data) {
        allAnime = data;
      });
  };

  const ListBuilder = function () {};

  const filterByArrayValues = function (items, key, include = [], exclude = []) {
    return _.filter(items, function (item) {
      const values = _.get(item, key, [])
      
      const hasExclude = !_.isEmpty(exclude) && _.intersection(values, exclude).length > 0
      if (hasExclude) {
        return false
      }

      const hasInclude = _.isEmpty(include) || _.intersection(values, include).length > 0
      return hasInclude
    })
  }

  const filterByMinValue = function (items, key, value = 0) {
    return _.filter(items, function (item) {
      return _.get(item, key, 0) >= value
    })
  }

  ListBuilder.prototype.evaluate = function (opts = {}) {
    const anticipated = opts.anticipated === 'true';
    const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
    
    const includeGenres = opts.include_genres ? opts.include_genres.split(',').map(g => _.snakeCase(g.trim()).toLowerCase()) : []
    const excludeGenres = opts.exclude_genres ? opts.exclude_genres.split(',').map(g => _.snakeCase(g.trim()).toLowerCase()) : []
    
    const includeTags = opts.include_tags ? opts.include_tags.split(',').map(t => _.snakeCase(t.trim()).toLowerCase()) : []
    const excludeTags = opts.exclude_tags ? opts.exclude_tags.split(',').map(t => _.snakeCase(t.trim()).toLowerCase()) : []

    const minMalScore = opts.min_mal_score ? parseFloat(opts.min_mal_score) : 0
    const minAnilistScore = opts.min_anilist_score ? parseInt(opts.min_anilist_score, 10) : 0
    const minRedditKarma = opts.min_reddit_karma ? parseInt(opts.min_reddit_karma, 10) : 0

    const dislikedGenres = opts.disliked_genres ? opts.disliked_genres.split(',').map(g => _.snakeCase(g.trim()).toLowerCase()) : []
    const dislikedTags = opts.disliked_tags ? opts.disliked_tags.split(',').map(t => _.snakeCase(t.trim()).toLowerCase()) : []

    return getAnime()
      .then(async (data) => {
        let filteredData = _.cloneDeep(data);

        if (!anticipated) {
            filteredData.masterList = filteredData.masterList.filter(m => m.status !== 'NOT_YET_RELEASED');
        }

        // Apply filters
        filteredData.masterList = filterByArrayValues(filteredData.masterList, 'genres', includeGenres, excludeGenres)
        filteredData.masterList = filterByArrayValues(filteredData.masterList, 'tags', includeTags, excludeTags)
        
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'score_mal', minMalScore)
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'score_anilist', minAnilistScore)
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'reddit_karma', minRedditKarma)

        // Also filter the malRanking to avoid giving the AI shows that were filtered out
        const filteredMalIds = new Set(filteredData.masterList.map(m => m.mal_id).filter(Boolean));
        filteredData.malRanking = filteredData.malRanking.filter(m => filteredMalIds.has(m.mal_id));

        if (_.isEmpty(filteredData.masterList)) {
          return []
        }

        const evaluation = await evaluateAnime(filteredData, anticipated, {
          disliked_genres: dislikedGenres,
          disliked_tags: dislikedTags
        });
        
        // Final enrichment pass for only the selected items
        const results = await Promise.map(evaluation, async selection => {
            // CRITICAL FIX: Use the FILTERED masterList here to prevent the AI from "sneaking back" filtered-out items
            const full = filteredData.masterList.find(m => m.id === selection.id);
            if (!full || !full.title) return null;
            
            // Late-stage ID enrichment to save API calls
            if (!full.tvdb_id || !full.imdb_id) {
              try {
                const meta = full.simkl_id ? await simkl.getFullMetadata(full.simkl_id) : (full.mal_id ? await simkl.getMetadata(full.mal_id) : null);
                if (meta) {
                  full.tvdb_id = full.tvdb_id || meta.tvdb_id;
                  full.imdb_id = full.imdb_id || meta.imdb_id;
                }
              } catch (e) {
                console.warn(`Simkl enrichment failed for ${full.title}`);
              }
            }

            return {
                title: full.title,
                // SONARR COMPATIBILITY: tvdbId (Integer) and imdbId (String)
                tvdbId: full.tvdb_id ? parseInt(full.tvdb_id, 10) : undefined,
                imdbId: full.imdb_id || undefined,
                // Metadata
                malId: full.mal_id ? parseInt(full.mal_id, 10) : undefined,
                anilistId: full.anilist_id ? parseInt(full.anilist_id, 10) : undefined,
                genres: full.genres,
                tags: full.tags,
                studio: full.studio,
                score_anilist: full.score_anilist,
                score_mal: full.score_mal,
                reddit_karma: full.reddit_karma,
                reasoning: selection.reasoning
            };
        }, { concurrency: 5 }).filter(Boolean);

        return limit ? _.take(results, limit) : results;
      });
  };

  ListBuilder.prototype.dump = function () {
    return allAnime ? allAnime.masterList : [];
  };

  return ListBuilder;
})();
