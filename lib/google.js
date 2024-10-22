const { GoogleGenAI } = require('@google/genai')
const config = require('../config')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

module.exports.prompt = async function (systemInstruction, contents) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction
    },
    contents
  });
  console.log(response.text);

  const lines = response.text.split('\n').map(line => line.trim())

  const bodyStartIndex = lines.findIndex(line => line === '```json' || line === '```')
  if (bodyStartIndex === -1) {
    throw new Error('Response does not contain a code block')
  }

  const bodyEndIndex = lines.indexOf('```', bodyStartIndex + 1)
  if (bodyEndIndex === -1) {
    throw new Error('Response does not contain a closing code block')
  }

  const data = JSON.parse(lines.slice(bodyStartIndex + 1, bodyEndIndex).join('\n').trim())
  return data
}
