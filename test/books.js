/* eslint-env mocha */
const expect = require('must')
const axios = require('axios')
const hardcover = require('../lib/books/hardcover')

describe('books - hardcover client', function () {
  this.timeout(10000)

  let originalPost

  beforeEach(function () {
    originalPost = axios.post
  })

  afterEach(function () {
    axios.post = originalPost
  })

  it('should return data on successful GraphQL response', async function () {
    axios.post = async () => ({
      data: {
        data: { lists: [{ id: 123, slug: 'trending' }] }
      }
    })

    const res = await hardcover.graphqlRequest('query { lists { id } }')
    expect(res).to.be.an.object()
    expect(res.lists[0].id).to.equal(123)
  })

  it('should throw immediately if GraphQL response contains errors array', async function () {
    axios.post = async () => ({
      data: {
        errors: [{ message: 'Field not found' }]
      }
    })

    let caught = null
    try {
      await hardcover.graphqlRequest('query { invalid }')
    } catch (err) {
      caught = err
    }
    expect(caught).to.not.be.null()
    expect(caught.message).to.contain('Field not found')
  })

  it('should retry and succeed after receiving HTTP 429 rate limit', async function () {
    let callCount = 0
    axios.post = async () => {
      callCount++
      if (callCount === 1) {
        const err = new Error('Request failed with status code 429')
        err.response = {
          status: 429,
          headers: { 'retry-after': '1' }
        }
        throw err
      }
      return {
        data: {
          data: { status: 'recovered_from_rate_limit' }
        }
      }
    }

    const res = await hardcover.graphqlRequest('query { test }', {}, 2, 50)
    expect(callCount).to.equal(2)
    expect(res.status).to.equal('recovered_from_rate_limit')
  })

  it('should handle non-integer HTTP-date retry-after header without NaN delay', async function () {
    let callCount = 0
    axios.post = async () => {
      callCount++
      if (callCount === 1) {
        const err = new Error('Rate limit')
        err.response = {
          status: 429,
          headers: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }
        }
        throw err
      }
      return {
        data: {
          data: { success: true }
        }
      }
    }

    const res = await hardcover.graphqlRequest('query { test }', {}, 2, 50)
    expect(callCount).to.equal(2)
    expect(res.success).to.be.true()
  })

  it('should retry on transient 502/503 errors and socket drops', async function () {
    let callCount = 0
    axios.post = async () => {
      callCount++
      if (callCount === 1) {
        const err = new Error('Bad Gateway')
        err.response = { status: 502, headers: {} }
        throw err
      }
      if (callCount === 2) {
        const err = new Error('socket hang up')
        err.code = 'ECONNRESET'
        throw err
      }
      return {
        data: {
          data: { recovered: true }
        }
      }
    }

    const res = await hardcover.graphqlRequest('query { test }', {}, 3, 50)
    expect(callCount).to.equal(3)
    expect(res.recovered).to.be.true()
  })

  it('should throw immediately without retrying on 400 Bad Request or 401 Unauthorized', async function () {
    let callCount = 0
    axios.post = async () => {
      callCount++
      const err = new Error('Unauthorized')
      err.response = { status: 401, headers: {} }
      throw err
    }

    let caught = null
    try {
      await hardcover.graphqlRequest('query { test }', {}, 3, 50)
    } catch (err) {
      caught = err
    }

    expect(caught).to.not.be.null()
    expect(callCount).to.equal(1) // No retries for 401
  })
})
