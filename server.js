const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const LLAMA_API = 'http://127.0.0.1:1234/v1/chat/completions';
const LLAMA_MODEL = 'qwen/qwen3-4b-2507';

const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use('/output', express.static('output'));

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTextContent(html, maxLen = 2000) {
  const text = stripHtml(html);
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function getLanguageName(langcode) {
  const map = {
    'es': 'Spanish', 'es-ES': 'Spanish',
    'ca': 'Catalan', 'ca-ES': 'Catalan',
    'eu': 'Basque', 'eu-ES': 'Basque',
    'gl': 'Galician', 'gl-ES': 'Galician',
    'en': 'English',
    'cn': 'Chinese Simplified',
  };
  return map[langcode] || 'Spanish';
}

function extractJSON(text) {
  const patterns = [
    /```(?:json)?\s*(\{[\s\S]*?\})\s*```/,
    /(\{[\s\S]*"meta_title"[\s\S]*"twitter_description"[\s\S]*?\})/,
    /(\{[\s\S]*"meta_title"[\s\S]*?\})/,
    /\{[\s\S]*?\}/,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      try {
        const parsed = JSON.parse(m[1] || m[0]);
        if (parsed.meta_title || parsed.meta_description) return parsed;
      } catch {}
    }
  }
  return null;
}

const REQUIRED_KEYS = ['meta_title', 'meta_description', 'meta_keywords', 'og_title', 'og_description', 'twitter_title', 'twitter_description'];

function fillMissingKeys(obj) {
  const result = { ...obj };
  for (const key of REQUIRED_KEYS) {
    if (!result[key]) {
      if (key === 'meta_keywords') result[key] = '';
      else if (key.includes('og_')) result[key] = result.meta_title || '';
      else if (key.includes('twitter')) result[key] = result.meta_title || '';
      else result[key] = '';
    }
  }
  return result;
}

async function generateSEOMetaTags(title, bodyText, langcode, existingMetatags) {
  const language = getLanguageName(langcode);

  const currentMetatagSummary = existingMetatags.map(m => {
    const name = m.attributes?.name || m.attributes?.property || '';
    const content = m.attributes?.content || '';
    return `  - ${name}: "${content}"`;
  }).join('\n');

  const userPrompt = `Generate SEO meta tags for this content. Language: ${language}.

RULES:
- ALL meta tags in ${language}.
- NEVER change title or body.
- Use relevant keywords from the content.
- Meta description: 120-155 characters max.
- OG/Twitter: adapt for social sharing.

TITLE: "${title}"

BODY:
"${bodyText}"

CURRENT TAGS:
${currentMetatagSummary}

OUTPUT ONLY THIS JSON:
{"meta_title":"...","meta_description":"...","meta_keywords":"...","og_title":"...","og_description":"...","twitter_title":"...","twitter_description":"..."}`;

  const response = await fetch(LLAMA_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LLAMA_MODEL,
      messages: [
        { role: 'system', content: 'You are an expert SEO assistant. Output ONLY valid JSON. Never include thinking, analysis, or explanations.' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.01,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLaMA API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const msg = data.choices?.[0]?.message || {};
  const content = msg.content || '';
  const reasoning = msg.reasoning_content || '';

  let parsed = extractJSON(content);
  if (!parsed) parsed = extractJSON(reasoning);
  if (!parsed) {
    throw new Error(`Could not extract valid JSON from model response.\nContent: ${content.slice(0, 200)}\nReasoning: ${reasoning.slice(-500)}`);
  }

  return fillMissingKeys(parsed);
}

function updateMetatags(originalMetatag, seoData) {
  const updates = {
    'description': seoData.meta_description,
    'keywords': seoData.meta_keywords,
    'og_title': seoData.og_title,
    'og_description': seoData.og_description,
    'twitter_cards_title': seoData.twitter_title,
    'twitter_cards_description': seoData.twitter_description,
  };

  return originalMetatag.map(m => {
    const name = m.attributes?.name || '';
    if (updates[name] !== undefined) {
      return { ...m, attributes: { ...m.attributes, content: updates[name] } };
    }
    if (name === 'abstract') {
      return { ...m, attributes: { ...m.attributes, content: seoData.meta_description } };
    }
    return m;
  });
}

function computeChanges(oldMetatag, newMetatag) {
  const trackedTags = ['description', 'keywords', 'og_title', 'og_description', 'twitter_cards_title', 'twitter_cards_description', 'abstract'];
  const changes = [];
  const oldMap = {};
  oldMetatag.forEach(m => {
    const name = m.attributes?.name || '';
    oldMap[name] = m.attributes?.content || '';
  });
  newMetatag.forEach(m => {
    const name = m.attributes?.name || '';
    const val = m.attributes?.content || '';
    if (trackedTags.includes(name) && oldMap[name] !== undefined && oldMap[name] !== val) {
      changes.push({ tag: name, old: oldMap[name], new: val });
    }
  });
  return changes;
}

app.get('/validate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'validate.html'));
});

const VALIDATION_METATAG_FIELDS = [
  { field: 'description', label: 'Meta Description' },
  { field: 'keywords', label: 'Meta Keywords' },
  { field: 'og_title', label: 'OG Title' },
  { field: 'og_description', label: 'OG Description' },
  { field: 'twitter_cards_title', label: 'Twitter Title' },
  { field: 'twitter_cards_description', label: 'Twitter Description' },
  { field: 'abstract', label: 'Abstract' },
];

function validateNode(node) {
  const issues = [];
  const nid = node.nid?.[0]?.value || 'unknown';
  const title = node.title?.[0]?.value || '';
  const bodyHtml = node.body?.[0]?.value || '';
  const metatag = node.metatag || [];
  const langcode = node.langcode?.[0]?.value || '';

  if (!title.trim()) {
    issues.push({ field: 'title', label: 'Título', status: 'vacio' });
  }

  const bodyText = stripHtml(bodyHtml);
  if (!bodyText.trim()) {
    issues.push({ field: 'body', label: 'Cuerpo (body)', status: 'vacio' });
  }

  for (const vf of VALIDATION_METATAG_FIELDS) {
    const entry = metatag.find(m => m.attributes?.name === vf.field);
    const content = entry?.attributes?.content || '';
    if (!content.trim()) {
      issues.push({ field: vf.field, label: vf.label, status: 'vacio' });
    }
  }

  return { nid, title: title || '(sin título)', langcode, valid: issues.length === 0, issues };
}

app.post('/api/validate', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fileResults = [];
    let totalNodes = 0;
    let validNodes = 0;
    let invalidNodes = 0;

    for (const file of req.files) {
      const filePath = file.path;
      const fileName = file.originalname;
      let rawData;

      try {
        rawData = fs.readFileSync(filePath, 'utf-8');
      } catch {
        fs.unlinkSync(filePath);
        fileResults.push({ fileName, valid: false, error: 'No se pudo leer el archivo', nodeCount: 0, validCount: 0, invalidCount: 0, nodes: [] });
        continue;
      }

      let nodes;
      try { nodes = JSON.parse(rawData); } catch {
        fs.unlinkSync(filePath);
        fileResults.push({ fileName, valid: false, error: 'JSON inválido', nodeCount: 0, validCount: 0, invalidCount: 0, nodes: [] });
        continue;
      }

      if (!Array.isArray(nodes)) nodes = [nodes];

      const fileNodeResults = [];
      let fileValid = 0;
      let fileInvalid = 0;

      for (const node of nodes) {
        const result = validateNode(node);
        fileNodeResults.push(result);
        if (result.valid) fileValid++;
        else fileInvalid++;
      }

      fileResults.push({
        fileName,
        valid: fileInvalid === 0,
        nodeCount: nodes.length,
        validCount: fileValid,
        invalidCount: fileInvalid,
        nodes: fileNodeResults,
      });

      totalNodes += nodes.length;
      validNodes += fileValid;
      invalidNodes += fileInvalid;

      fs.unlinkSync(filePath);
    }

    res.json({
      success: true,
      summary: { totalFiles: req.files.length, totalNodes, validNodes, invalidNodes },
      fileResults,
    });
  } catch (err) {
    console.error('Validation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const rawData = fs.readFileSync(filePath, 'utf-8');
    let nodes;
    try { nodes = JSON.parse(rawData); } catch {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'Invalid JSON file' });
    }

    if (!Array.isArray(nodes)) nodes = [nodes];
    const results = [];
    const errors = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const title = node.title?.[0]?.value || 'Untitled';
      const bodyHtml = node.body?.[0]?.value || '';
      const bodyText = extractTextContent(bodyHtml);
      const langcode = node.langcode?.[0]?.value || 'es';
      const existingMetatag = node.metatag || [];

      console.log(`[${i + 1}/${nodes.length}] "${title}" (${langcode})`);

      try {
        const seoData = await generateSEOMetaTags(title, bodyText, langcode, existingMetatag);
        const updatedMetatag = updateMetatags(existingMetatag, seoData);
        const changes = computeChanges(existingMetatag, updatedMetatag);
        nodes[i] = { ...node, metatag: updatedMetatag };
        results.push({ index: i, title, langcode, status: 'ok', changes });
        console.log(`  -> OK: ${changes.length} tag(s) updated`);
      } catch (err) {
        errors.push({ index: i, title, langcode, error: err.message });
        console.error(`  -> ERROR: ${err.message}`);
      }
    }

    const outputFilename = `improved_seo_${Date.now()}.json`;
    const outputPath = path.join(__dirname, 'output', outputFilename);
    fs.writeFileSync(outputPath, JSON.stringify(nodes, null, 2), 'utf-8');
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      total: nodes.length,
      processed: results.length,
      errors: errors.length,
      errorDetails: errors,
      nodeDetails: results,
      downloadUrl: `/output/${outputFilename}`,
      filename: outputFilename,
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`SEO improver server running at http://localhost:${PORT}`);
  console.log(`Using LLaMA API at ${LLAMA_API}`);
});
