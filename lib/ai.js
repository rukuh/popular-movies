const { GoogleGenAI } = require('@google/genai');
const Anthropic = require('@anthropic-ai/sdk');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const googleAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const anthropicAI = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

async function prompt(system, content) {
  let responseText;
  let lastError;

  // 1. Try Anthropic first
  if (anthropicAI) {
    try {
      const response = await anthropicAI.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: system,
        messages: [{ role: 'user', content: content }],
        temperature: 0
      });
      responseText = response.content[0].text;
      console.log('AI Response (Anthropic): Successful');
      return parseJsonResponse(responseText);
    } catch (e) {
      console.warn('Anthropic evaluation failed, falling back to Google...', e.message);
      lastError = e;
    }
  }

  // 2. Fallback to Google
  if (googleAI) {
    try {
      const response = await googleAI.models.generateContent({
        model: 'gemini-2.0-flash',
        config: { systemInstruction: system },
        contents: content
      });
      responseText = response.text();
      console.log('AI Response (Google): Successful');
      return parseJsonResponse(responseText);
    } catch (e) {
      console.warn('Google evaluation failed, falling back to non-AI logic...', e.message);
      lastError = e;
    }
  }

  // 3. If both failed (or keys are missing), throw error to trigger non-AI fallback in the caller
  throw lastError || new Error('No AI providers available');
}

function parseJsonResponse(text) {
  const lines = text.split('\n').map(line => line.trim());
  const bodyStartIndex = lines.findIndex(line => line.startsWith('```json') || line === '```');
  
  if (bodyStartIndex === -1) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error('Response does not contain a valid JSON block');
    }
  }

  const bodyEndIndex = lines.indexOf('```', bodyStartIndex + 1);
  const jsonStr = lines.slice(bodyStartIndex + 1, bodyEndIndex !== -1 ? bodyEndIndex : undefined).join('\n').trim();
  return JSON.parse(jsonStr);
}

module.exports = { prompt };
