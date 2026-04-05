const Promise = require('bluebird')
const axios = require('axios')
const nyt = require('./nyt')
const hardcover = require('./hardcover')

const READARR_API_KEY = process.env.READARR_API_KEY
const HARDCOVER_LIST_ID = process.env.HARDCOVER_LIST_ID
const READARR_URL = process.env.READARR_URL || 'http://readarr:8787'

const BooksIndex = function () {}

BooksIndex.prototype.sync = async function () {
  console.log('Starting NYT to Hardcover sync...')

  // 1. Get NYT Best Sellers
  const nytBooks = await nyt.getBestSellers()
  console.log(`Fetched ${nytBooks.length} books from NYT.`)

  // 2. Resolve Hardcover List and existing books
  console.log(`Resolving list and existing items for: ${HARDCOVER_LIST_ID}`)
  const listInfo = await hardcover.getListIdAndBooks(HARDCOVER_LIST_ID)

  if (!listInfo) {
    throw new Error(`Could not find Hardcover list for: ${HARDCOVER_LIST_ID}`)
  }

  const listId = listInfo.id
  const existingListBookIds = listInfo.listBooks.map(lb => lb.id)
  console.log(`List ID: ${listId}, found ${existingListBookIds.length} existing items to clear.`)

  // 3. Map NYT books to Hardcover Book IDs
  const newBookIds = await Promise.mapSeries(nytBooks, async (nytBook) => {
    try {
      // Try ISBN first (most accurate)
      let hcBook = await hardcover.getBookByISBN(nytBook.isbn13 || nytBook.isbn10)
      
      // Fallback to Title/Author search
      if (!hcBook) {
        hcBook = await hardcover.searchBookByTitleAuthor(nytBook.title, nytBook.author)
      }

      if (hcBook) {
        console.log(`Matched: ${nytBook.title} -> Hardcover ID: ${hcBook.id}`)
        return hcBook.id
      } else {
        console.warn(`Could not find book on Hardcover: ${nytBook.title} by ${nytBook.author}`)
        return null
      }
    } catch (err) {
      console.error(`Error matching book ${nytBook.title}:`, err.message)
      return null
    }
  }).filter(id => id !== null)

  // Remove duplicates if any
  const uniqueBookIds = [...new Set(newBookIds)]
  console.log(`Found ${uniqueBookIds.length} unique matching books on Hardcover.`)

  // 4. Replace books in Hardcover list (Delete existing, Insert new)
  await hardcover.replaceBooksInList(listId, existingListBookIds, uniqueBookIds)
  console.log('Successfully updated Hardcover list.')

  // 5. Trigger Readarr/Bookshelf Import List Sync
  try {
    console.log(`Triggering Bookshelf sync at ${READARR_URL}...`)
    await axios.post(`${READARR_URL}/api/v1/command`, {
      name: 'ImportListSync'
    }, {
      headers: { 'X-Api-Key': READARR_API_KEY }
    })
    console.log('Triggered Bookshelf Import List Sync.')
  } catch (err) {
    console.error('Failed to trigger Bookshelf sync:', err.message)
    // Don't throw here, the primary task (Hardcover sync) succeeded
  }

  return {
    nyt_count: nytBooks.length,
    matched_count: uniqueBookIds.length,
    status: 'success'
  }
}

// Support the common interface used in server.js handleRequest
BooksIndex.prototype.evaluate = async function () {
  return this.sync()
}

module.exports = BooksIndex
