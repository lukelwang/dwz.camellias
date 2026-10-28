(function () {
  'use strict';

  const SOURCE = 'https://camellia-nomenclature.github.io/';
  let index = null;
  let searchable = [];
  let indexRequest = null;
  let revision = 0;
  const letters = new Map();
  const letterRequests = new Map();

  function normalize(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[-‐‑–—]/g, ' ').replace(/[\p{P}\p{S}]/gu, '')
      .replace(/\s+/g, ' ').trim();
  }

  function aliases(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
      throw new Error('The live catalogue returned invalid ' + field + '. Please retry.');
    }
    return value.filter(item => item.trim());
  }

  function entry(raw, fallbackName) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('The live catalogue returned an invalid variety. Please retry.');
    }
    const name = raw.name == null ? (raw.n == null ? fallbackName : raw.n) : raw.name;
    const species = raw.species == null ? raw.s : raw.species;
    if (typeof name !== 'string' || !name.trim() || (species != null && typeof species !== 'string')) {
      throw new Error('The live catalogue returned an invalid variety name or species. Please retry.');
    }
    return {
      name,
      species: species || '',
      chinese_name: aliases(raw.chinese_name, 'Chinese names'),
      japanese_name: aliases(raw.japanese_name, 'Japanese names')
    };
  }

  async function fetchJSON(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(SOURCE + path, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.json();
    } catch (error) {
      const reason = controller.signal.aborted ? 'The request timed out' : (error.message || 'Network error');
      throw new Error('Unable to load the live camellia catalogue. ' + reason + '. Please retry.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadIndex({ refresh = false } = {}) {
    if (indexRequest) return indexRequest;
    if (index && !refresh) return index;
    indexRequest = (async function () {
      const raw = await fetchJSON('data/index.json');
      if (!Array.isArray(raw) || !raw.length) {
        throw new Error('The live catalogue index is invalid or empty. Please retry.');
      }
      const seen = new Set();
      const next = raw.map(item => entry(item)).filter(item => {
        if (seen.has(item.name)) return false;
        seen.add(item.name);
        return true;
      });
      const nextSearchable = next.map((item, position) => ({
        item,
        position,
        name: normalize(item.name),
        aliases: [...item.chinese_name, ...item.japanese_name].map(normalize).filter(Boolean)
      }));
      index = next;
      searchable = nextSearchable;
      if (refresh) {
        revision += 1;
        letters.clear();
        letterRequests.clear();
      }
      return index;
    }());
    try {
      return await indexRequest;
    } finally {
      indexRequest = null;
    }
  }

  function search(query, { limit = 30 } = {}) {
    const term = normalize(typeof query === 'string' ? query : '');
    if (!term) return { results: [], total: 0 };
    const compact = term.replace(/ /g, '');
    const matches = [];
    for (const candidate of searchable) {
      const names = [candidate.name, ...candidate.aliases];
      let rank = Infinity;
      names.forEach((name, position) => {
        if (name === term) rank = Math.min(rank, position === 0 ? 0 : 1);
        else if (name.startsWith(term) || name.replace(/ /g, '').startsWith(compact)) {
          rank = Math.min(rank, position === 0 ? 2 : 3);
        } else if (name.includes(term)) rank = Math.min(rank, position === 0 ? 4 : 5);
      });
      if (rank !== Infinity) matches.push({ candidate, rank });
    }
    matches.sort((a, b) => a.rank - b.rank || a.candidate.position - b.candidate.position);
    const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 30;
    return { results: matches.slice(0, count).map(match => match.candidate.item), total: matches.length };
  }

  async function getEntry(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Choose a variety from the live catalogue.');
    const letter = name[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    let records = letters.get(letter);
    if (!records) {
      if (!letterRequests.has(letter)) {
        const requestRevision = revision;
        const request = (async function () {
          const raw = await fetchJSON('data/' + encodeURIComponent(letter) + '.json');
          if (!raw || typeof raw !== 'object') {
            throw new Error('The live catalogue variety details are invalid. Please retry.');
          }
          const records = new Map();
          const pairs = Array.isArray(raw) ? raw.map(value => [undefined, value]) : Object.entries(raw);
          for (const [key, value] of pairs) {
            const metadata = entry(value, key);
            records.set(metadata.name, { ...value, ...metadata });
          }
          if (requestRevision === revision) letters.set(letter, records);
          return records;
        }());
        letterRequests.set(letter, request);
      }
      const request = letterRequests.get(letter);
      try {
        records = await request;
      } finally {
        if (letterRequests.get(letter) === request) letterRequests.delete(letter);
      }
    }
    const record = records.get(name);
    if (!record) {
      if (letters.get(letter) === records) letters.delete(letter);
      throw new Error('The live catalogue has no full entry for “' + name + '”. Please refresh and retry.');
    }
    return record;
  }

  function toCultivar(raw) {
    const metadata = entry(raw);
    for (const field of ['size', 'description']) {
      if (raw[field] != null && typeof raw[field] !== 'string') {
        throw new Error('The live catalogue returned invalid ' + field + '. Please retry.');
      }
    }
    const hexName = Array.from(new TextEncoder().encode(metadata.name), byte => byte.toString(16).padStart(2, '0')).join('');
    return {
      id: 'camellia-library-' + hexName,
      ...metadata,
      size: raw.size || '',
      description: raw.description || '',
      display_name: metadata.name,
      summary_zh: '',
      color: '',
      form: '',
      reference_url: SOURCE + '#' + encodeURIComponent(metadata.name),
      photos: [],
      catalogue: true
    };
  }

  window.CamelliaCatalog = { loadIndex, search, getEntry, toCultivar };
}());
