const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('\n========================================');
console.log('  GLITCH SEO OPS ENGINE - TEST RUNNER   ');
console.log('========================================\n');

let passedCount = 0;
let totalCount = 0;

function runTest(name, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error('    Error:', err.message);
  }
}

// 1. Priority Score Heuristic
runTest('Core: Heuristic priority scoring calculation', () => {
  const { calculatePriorityScore } = require('../core/dist/scoring/index.js');
  const score = calculatePriorityScore({
    impact: 9,
    confidence: 1.0,
    affectedUrlsCount: 100,
    businessImportance: 1.5,
    effort: 2,
    risk: 1
  });
  assert(score > 15, 'Priority score should reflect high impact & URLs');
});

// 2. IP Anonymization & Sensitive Query Params
runTest('Core: IP anonymization & query string redaction', () => {
  const { anonymizeIp, sanitizeQueryString } = require('../core/dist/privacy/index.js');
  const hash1 = anonymizeIp('192.168.1.1', 'secret-salt');
  const hash2 = anonymizeIp('192.168.1.1', 'secret-salt');
  assert.strictEqual(hash1, hash2, 'Consistent hash for same IP & salt');
  assert.notStrictEqual(hash1, '192.168.1.1', 'Original IP must never be exposed');

  const clean = sanitizeQueryString('?page=2&token=xyz123&sort=desc');
  assert(clean.includes('token=%5BREDACTED%5D') || clean.includes('token=[REDACTED]'), 'Sensitive token must be redacted');
  assert(clean.includes('page=2'), 'Safe query parameter preserved');
});

// 3. Bot Identification
runTest('Log-Parser: Bot identification for Search Engines & AI Crawlers', () => {
  const { identifyBot } = require('../log-parser/dist/bots.js');
  const gbot = identifyBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  assert.strictEqual(gbot.name, 'Googlebot Smartphone' || gbot.name === 'Googlebot', 'Identified Googlebot');
  assert.strictEqual(gbot.category, 'SEARCH_ENGINE');

  const gpt = identifyBot('Mozilla/5.0 AppleWebKit/537.36 (compatible; GPTBot/1.2; +https://openai.com/gptbot)');
  assert.strictEqual(gpt.name, 'GPTBot');
  assert.strictEqual(gpt.category, 'AI_CRAWLER');
});

// 4. Schema Validator
runTest('Schema-Engine: JSON-LD Article validation', () => {
  const { validateJsonLd } = require('../schema-engine/dist/validator.js');
  const valid = validateJsonLd(JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    'headline': 'Modern Technical SEO',
    'author': { '@type': 'Person', 'name': 'James' }
  }));
  assert.strictEqual(valid.isValid, true, 'Valid schema returns true');

  const invalid = validateJsonLd(JSON.stringify({
    '@type': 'Article' // missing @context & headline
  }));
  assert.strictEqual(invalid.isValid, false, 'Invalid schema caught');
});

// 5. Content Engine: Shingles & Similarity
runTest('Content-Engine: Shingles & Jaccard duplication check', () => {
  const { computeJaccardSimilarity } = require('../content-engine/dist/similarity.js');
  const textA = 'Comprehensive breakdown of technical SEO and server logs.';
  const textB = 'Comprehensive breakdown of technical SEO and server logs.';
  const textC = 'Completely different unrelated cooking recipe about pasta.';

  assert.strictEqual(computeJaccardSimilarity(textA, textB), 1.0, 'Identical texts have 1.0 similarity');
  assert(computeJaccardSimilarity(textA, textC) < 0.2, 'Divergent texts have low similarity');
});

// 6. Content Engine: Quality Gates
runTest('Content-Engine: Quality gate blocking thin or duplicate pages', () => {
  const { evaluateQualityGate } = require('../content-engine/dist/quality-gates.js');
  const result = evaluateQualityGate({
    title: 'Short',
    metaDescription: 'Desc',
    content: 'Too short body',
    similarityScore: 0.95,
    slug: 'valid-slug'
  });
  assert.strictEqual(result.status, 'BLOCKED', 'High similarity and thin content must be BLOCKED');
});

console.log(`\nTest Results: ${passedCount} / ${totalCount} Passed.`);
if (passedCount !== totalCount) {
  process.exit(1);
}
