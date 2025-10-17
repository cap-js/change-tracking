const formatOptions = {
  'cds.Date': {
    'de': { day: '2-digit', month: '2-digit', year: 'numeric' },
    'en': { day: 'numeric', month: 'short', year: 'numeric' },
    'es': { day: '2-digit', month: 'short', year: 'numeric' },
    'fi': { year: 'numeric', month: '2-digit', day: '2-digit' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric' },
    'it': { day: '2-digit', month: 'short', year: 'numeric' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric' }
  },
  'cds.DateTime': {
    'de': { day: '2-digit', month: '2-digit', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'el': { day: 'numeric', month: 'short', year: 'numeric',hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'en': { day: 'numeric', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es_MX': { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true },
    'fi': { year: 'numeric', month: '2-digit', day: '2-digit',hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'it': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' }
  },
  'cds.Timestamp': {
    'cs': { day: 'numeric', month: 'short', year: 'numeric',hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'de': { day: '2-digit', month: '2-digit', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'el': { day: 'numeric', month: 'short', year: 'numeric',hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'en': { day: 'numeric', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es_MX': { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true },
    'fi': { year: 'numeric', month: '2-digit', day: '2-digit',hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'it': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric',hour: '2-digit', minute: '2-digit', second: '2-digit' }
  },
  'cds.Time': {
    'cs': { hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'fi': { hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'de': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'el': { hour: 'numeric', minute: '2-digit', second: '2-digit' },
    'en': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'es_MX': { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true },
    'fr': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'it': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ja': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pl': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pt': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ru': { hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'zh-CN': { hour: '2-digit', minute: '2-digit', second: '2-digit' }
  }
};

module.exports = {
  formatOptions
};