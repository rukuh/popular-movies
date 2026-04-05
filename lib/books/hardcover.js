const axios = require('axios')

const HARDCOVER_API_TOKEN = process.env.HARDCOVER_API_TOKEN
const GRAPHQL_ENDPOINT = 'https://api.hardcover.app/v1/graphql'

const graphqlRequest = async (query, variables = {}) => {
  try {
    const response = await axios.post(
      GRAPHQL_ENDPOINT,
      { query, variables },
      {
        headers: {
          Authorization: `Bearer ${HARDCOVER_API_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (response.data.errors) {
      throw new Error(JSON.stringify(response.data.errors))
    }

    return response.data.data
  } catch (error) {
    console.error('Hardcover GraphQL Error:', error.message)
    throw error
  }
}

const getListIdAndBooks = async (slug) => {
  const query = `
    query GetListAndBooks($slug: String!) {
      lists(where: { slug: { _eq: $slug } }) {
        id
        list_books {
          id
        }
      }
    }
  `
  const data = await graphqlRequest(query, { slug })
  if (!data.lists[0]) return null
  return {
    id: data.lists[0].id,
    listBooks: data.lists[0].list_books
  }
}

const getBookByISBN = async (isbn) => {
  const query = `
    query GetBookByISBN($isbn: String!) {
      editions(where: {
        _or: [
          { isbn_10: { _eq: $isbn } },
          { isbn_13: { _eq: $isbn } }
        ]
      }) {
        book {
          id
          title
        }
      }
    }
  `
  const data = await graphqlRequest(query, { isbn })
  return data.editions[0]?.book
}

const searchBookByTitleAuthor = async (title, author) => {
  const query = `
    query SearchBooks($title: String!, $author: String!) {
      books(where: {
        _and: [
          { title: { _ilike: $title } },
          { contributions: { author: { name: { _ilike: $author } } } }
        ]
      }, limit: 1) {
        id
        title
      }
    }
  `
  const data = await graphqlRequest(query, {
    title: `%${title}%`,
    author: `%${author}%`
  })
  return data.books[0]
}

const replaceBooksInList = async (listId, existingListBookIds, newBookIds) => {
  if (existingListBookIds.length === 0 && newBookIds.length === 0) {
    console.log('No existing books to delete and no new books to insert.')
    return { status: 'no_change' }
  }

  // Construct a single large mutation to delete all old and insert all new
  let mutation = 'mutation ReplaceBooksInList {\n'
  
  // 1. Delete existing
  existingListBookIds.forEach((id, index) => {
    mutation += `  del_${index}: delete_list_book(id: ${id}) {\n    id\n  }\n`
  })

  // 2. Insert new
  newBookIds.forEach((bookId, index) => {
    mutation += `  ins_${index}: insert_list_book(object: {\n    list_id: ${listId},\n    book_id: ${bookId},\n    position: ${index + 1}\n  }) {\n    id\n  }\n`
  })

  mutation += '}'

  return graphqlRequest(mutation)
}

module.exports = {
  getListIdAndBooks,
  getBookByISBN,
  searchBookByTitleAuthor,
  replaceBooksInList
}
