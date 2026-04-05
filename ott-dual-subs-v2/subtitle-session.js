(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.OTTDualSubsSession = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalizeSubtitleSources(urls, formats, limit) {
    const normalized = [];
    const seenUrls = new Set();
    const safeUrls = Array.isArray(urls) ? urls : [];
    const safeFormats = Array.isArray(formats) ? formats : [];
    const maxSources = Number.isInteger(limit) && limit > 0 ? limit : 2;

    for (let i = 0; i < safeUrls.length; i += 1) {
      const url = safeUrls[i];
      if (!url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      normalized.push({
        url,
        format: safeFormats[i] || 'vtt',
      });
    }

    return normalized.slice(-maxSources);
  }

  function createSubtitleSourceSignature(sources) {
    const safeSources = Array.isArray(sources) ? sources : [];
    return safeSources.map((source) => `${source.url}::${source.format || 'vtt'}`).join('|');
  }

  function resolveSubtitleSourceUpdate(currentSignature, urls, formats, limit) {
    const sources = normalizeSubtitleSources(urls, formats, limit);
    const signature = createSubtitleSourceSignature(sources);

    return {
      sources,
      signature,
      changed: signature !== currentSignature,
    };
  }

  return {
    normalizeSubtitleSources,
    createSubtitleSourceSignature,
    resolveSubtitleSourceUpdate,
  };
});
