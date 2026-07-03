import { createTravelGuideProvider } from '../src/guideStream.js';
import { consumeStream } from '@a2ui-stream/core';

const provider = createTravelGuideProvider({
  start: { lng: 116.4644, lat: 39.9089 },
  end: { lng: 116.295, lat: 39.9999 },
  startName: '国贸',
  endName: '颐和园',
  samples: 100,
  llm: {
    apiKey: process.env.VITE_LLM_API_KEY,
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-Text-01',
    providerName: 'minimax',
  },
});

const parts = [];
const t0 = performance.now();
let tFirstDelta = null;
let tDone = null;
let chars = 0;

for await (const part of provider.stream({ messages: [] })) {
  parts.push(part);
  console.log(`[+${(performance.now()-t0).toFixed(0)}ms]`, JSON.stringify(part).slice(0, 200));
}

console.log(`\n=== SUMMARY ===`);
console.log(`parts: ${parts.length}`);
console.log(`keys:`, [...new Set(parts.flatMap(p => Object.keys(p)))]);
