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
  const { 
    disliked_genres = [], 
    disliked_tags = [], 
    preferred_genres = [], 
    preferred_tags = [],
    exclude_sequels = false
  } = preferences;
  const system = `
You are an expert anime critic. Your goal is to suggest a "must-watch" list (Top 12-15) from the current season.

You will be given the current context (today's date and season) and aggregated data points for each show:
1. METADATA (AniList): Title, Studio, Genres, Tags, Description.
2. CONSENSUS SCORES (MAL + AniList + Kitsu): Average "Quality" signals.
3. HYPE SIGNALS (Reddit Karma + AniList Popularity): Real-time "What's Hot" metrics.
4. PLATFORM SIGNAL (Simkl): Peer trending data.

JUDGMENT CRITERIA:
- OVERLAP: Shows appearing across many sources are high-confidence hits.
- QUALITY VS HYPE: Balance high-rated classics with currently trending/hyped shows.
- SEASONAL TRANSITION: If today's date is near a seasonal boundary, you may see shows from both the ending season and the upcoming season. Highly prioritize retaining high-quality finished or finishing shows from the ending season to prevent lower-rated shows from filling the list.
${exclude_sequels ? '- NO SEQUELS/RETURNING SEASONS: You MUST exclude sequels or returning seasons (e.g., Season 2, 3, 4, Part 2, etc.) or subsequent entries of a series. Only include completely new series (Season 1 / new franchises or spin-offs). Note that spin-offs and side stories are allowed as long as they are the first season of that spin-off.' : '- SEQUELS: Sequels to highly-rated shows are strong contenders.'}
- HIDDEN GEMS: Consider shows with high Reddit Karma or Simkl trending even if scores are lower.
${!_.isEmpty(disliked_genres) ? `- I strongly dislike the following genres: ${disliked_genres.join(', ')}. You MUST weigh these extremely negatively. Only include them if they are the absolute "top-tier" standouts of the season (e.g., Score > 85 or universal acclaim). Exclude them if they are merely popular or trending.` : ''}
${!_.isEmpty(disliked_tags) ? `- I strongly dislike shows with these tags: ${disliked_tags.join(', ')}. You MUST weigh these extremely negatively. Only include them if they are absolute "top-tier" standouts of the season (e.g., Score > 85). Exclude them if they are merely popular or trending.` : ''}
${!_.isEmpty(preferred_genres) ? `- I highly prefer the following genres: ${preferred_genres.join(', ')}. Please weigh these genres more positively and be more lenient with their ratings/consensus scores when selecting them, as they tend to have lower overall scores than shounen but are highly desired.` : ''}
${!_.isEmpty(preferred_tags) ? `- I highly prefer shows with these tags: ${preferred_tags.join(', ')}. Please weigh these tags more positively and be more lenient with their ratings/consensus scores when selecting them.` : ''}

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
    const currentSeason = anilist.getCurrentSeason();
    const optimizedData = {
      context: {
        currentDate: moment().format('YYYY-MM-DD'),
        currentSeason: currentSeason
      },
      masterList: combinedData.masterList.map(m => _.omit(m, [
        'description',
        'relations',
        'mal_id',
        'anilist_id',
        'tvdb_id',
        'imdb_id',
        'simkl_id',
        'source'
      ]))
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
        
        // Give a boost if it contains preferred genres or tags
        if (!_.isEmpty(preferred_genres) && a.genres && _.intersection(a.genres, preferred_genres).length > 0) {
          a.fallback_weight += 15;
        }
        if (!_.isEmpty(preferred_tags) && a.tags && _.intersection(a.tags, preferred_tags).length > 0) {
          a.fallback_weight += 15;
        }
        
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
        source: 'AniList',
        relations: a.relations,
        start_date: a.startDate ? `${a.startDate.year}-${String(a.startDate.month || 1).padStart(2, '0')}-${String(a.startDate.day || 1).padStart(2, '0')}` : null,
        season: a.season,
        season_year: a.seasonYear
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
  let cacheTime = null;
  const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 Hours

  const getAnime = function (clearCache = false) {
    const now = Date.now();
    if (clearCache || !cacheTime || (now - cacheTime) > CACHE_TTL) {
      allAnime = null;
      cacheTime = null;
    }

    if (allAnime) {
      return Promise.resolve(allAnime);
    }

    return Promise.resolve(getAggregatedData())
      .tap(function (data) {
        allAnime = data;
        cacheTime = Date.now();
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
    const excludeSequels = opts.exclude_sequels === 'true';
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

    const preferredGenres = opts.preferred_genres ? opts.preferred_genres.split(',').map(g => _.snakeCase(g.trim()).toLowerCase()) : []
    const preferredTags = opts.preferred_tags ? opts.preferred_tags.split(',').map(t => _.snakeCase(t.trim()).toLowerCase()) : []

    const clearCache = opts.clear_cache === 'true';

    return getAnime(clearCache)
      .then(async (data) => {
        let filteredData = _.cloneDeep(data);

        if (!anticipated) {
          const now = new Date();
          const m = now.getMonth();
          const d = now.getDate();
          const isTransition = (m % 3 === 2 && d >= 16) || (m % 3 === 0 && d <= 15);

          if (!isTransition) {
            filteredData.masterList = filteredData.masterList.filter(m => m.status !== 'NOT_YET_RELEASED');
          }
        }

        // Apply filters
        filteredData.masterList = filterByArrayValues(filteredData.masterList, 'genres', includeGenres, excludeGenres)
        filteredData.masterList = filterByArrayValues(filteredData.masterList, 'tags', includeTags, excludeTags)
        
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'score_mal', minMalScore)
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'score_anilist', minAnilistScore)
        filteredData.masterList = filterByMinValue(filteredData.masterList, 'reddit_karma', minRedditKarma)

        if (excludeSequels) {
          const sequelRegex = /\b(season\s+\d+|s\d+|\d+(nd|rd|th)\s+season|part\s+\d+|ii|iii|iv|v|vi)\b/i;
          filteredData.masterList = filteredData.masterList.filter(m => {
            const hasSequelTitle = m.title && sequelRegex.test(m.title);
            const hasPrequelRelation = m.relations && m.relations.some(r => 
              r.relationType === 'PREQUEL' && r.nodeType === 'ANIME'
            );
            return !hasSequelTitle && !hasPrequelRelation;
          });
        }

        // Also filter the malRanking to avoid giving the AI shows that were filtered out
        const filteredMalIds = new Set(filteredData.masterList.map(m => m.mal_id).filter(Boolean));
        filteredData.malRanking = filteredData.malRanking.filter(m => filteredMalIds.has(m.mal_id));

        if (_.isEmpty(filteredData.masterList)) {
          return []
        }

        const evaluation = await evaluateAnime(filteredData, anticipated, {
          disliked_genres: dislikedGenres,
          disliked_tags: dislikedTags,
          preferred_genres: preferredGenres,
          preferred_tags: preferredTags,
          exclude_sequels: excludeSequels
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
