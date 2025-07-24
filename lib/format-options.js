const formatOptions = {
  'cds.Date': {
    'de': { day: '2-digit', month: '2-digit', year: 'numeric' },
    'en': { day: 'numeric', month: 'short', year: 'numeric' },
    'es': { day: '2-digit', month: 'short', year: 'numeric' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric' },
    'it': { day: '2-digit', month: 'short', year: 'numeric' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric' }
  },
  'cds.DateTime': {
    'de': { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'en': { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true },
    'es': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'it': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
  },
  'cds.Timestamp': {
    'de': { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'en': { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true },
    'es': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'fr': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'it': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ja': { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pl': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'pt': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'ru': { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' },
    'zh-CN': { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
  },
  'cds.Time': {
    'de': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'en': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true },
    'es': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'fr': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'it': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'ja': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'pl': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'pt': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'ru': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    'zh-CN': { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }
  }
};

module.exports = {
  formatOptions
};