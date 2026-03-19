export interface ServiceKeyDef {
  name: string;       // human label, e.g. "API Key"
  envName: string;    // window.ENV key, e.g. "ELEVENLABS_API_KEY"
  hint?: string;      // where to find the key
  placeholder?: string;
  isSecret?: boolean; // mask input (default true)
}

export interface IntegrationDef {
  service: string;
  description: string;
  keys: ServiceKeyDef[];
  patterns: RegExp[];
}

export const KNOWN_INTEGRATIONS: IntegrationDef[] = [
  {
    service: 'ElevenLabs',
    description: 'Text-to-speech',
    keys: [{ name: 'API Key', envName: 'ELEVENLABS_API_KEY', hint: 'elevenlabs.io → Profile → API Keys', placeholder: 'sk_...' }],
    patterns: [/eleven\s*labs?/i],
  },
  {
    service: 'OpenAI',
    description: 'GPT / Chat / Embeddings',
    keys: [{ name: 'API Key', envName: 'OPENAI_API_KEY', hint: 'platform.openai.com/api-keys', placeholder: 'sk-...' }],
    patterns: [/openai/i, /\bgpt-?[34o]\b/i],
  },
  {
    service: 'Anthropic',
    description: 'Claude AI',
    keys: [{ name: 'API Key', envName: 'ANTHROPIC_API_KEY', hint: 'console.anthropic.com → API Keys', placeholder: 'sk-ant-...' }],
    patterns: [/\banthropic\b/i, /\bclaude\s+ai\b/i],
  },
  {
    service: 'Stripe',
    description: 'Payment processing',
    keys: [{ name: 'Publishable Key', envName: 'STRIPE_PUBLISHABLE_KEY', hint: 'dashboard.stripe.com → Developers → API keys', placeholder: 'pk_live_... or pk_test_...' }],
    patterns: [/\bstripe\b/i],
  },
  {
    service: 'Google Maps',
    description: 'Maps & geocoding',
    keys: [{ name: 'API Key', envName: 'GOOGLE_MAPS_API_KEY', hint: 'console.cloud.google.com → APIs & Services → Credentials', placeholder: 'AIza...' }],
    patterns: [/google\s*maps?/i],
  },
  {
    service: 'Mapbox',
    description: 'Maps & location',
    keys: [{ name: 'Access Token', envName: 'MAPBOX_TOKEN', hint: 'account.mapbox.com → Access tokens', placeholder: 'pk.eyJ1...' }],
    patterns: [/\bmapbox\b/i],
  },
  {
    service: 'Firebase',
    description: 'Google Firebase',
    keys: [
      { name: 'API Key', envName: 'FIREBASE_API_KEY', hint: 'Firebase Console → Project Settings → Your apps', placeholder: 'AIza...' },
      { name: 'Project ID', envName: 'FIREBASE_PROJECT_ID', hint: 'Firebase Console → Project Settings', placeholder: 'my-project-id', isSecret: false },
    ],
    patterns: [/\bfirebase\b/i],
  },
  {
    service: 'Pusher',
    description: 'Real-time events & channels',
    keys: [
      { name: 'App Key', envName: 'PUSHER_APP_KEY', hint: 'dashboard.pusher.com → App Keys', placeholder: '' },
      { name: 'Cluster', envName: 'PUSHER_CLUSTER', hint: 'e.g. us2, eu, ap1', placeholder: 'us2', isSecret: false },
    ],
    patterns: [/\bpusher\b/i],
  },
  {
    service: 'Algolia',
    description: 'Search & discovery',
    keys: [
      { name: 'Application ID', envName: 'ALGOLIA_APP_ID', hint: 'Algolia Dashboard → Settings → API Keys', placeholder: '', isSecret: false },
      { name: 'Search API Key', envName: 'ALGOLIA_SEARCH_KEY', hint: 'Algolia Dashboard → Settings → API Keys', placeholder: '' },
    ],
    patterns: [/\balgolia\b/i],
  },
  {
    service: 'Cloudinary',
    description: 'Image & video management',
    keys: [
      { name: 'Cloud Name', envName: 'CLOUDINARY_CLOUD_NAME', hint: 'cloudinary.com/console', placeholder: 'my-cloud', isSecret: false },
      { name: 'Upload Preset', envName: 'CLOUDINARY_UPLOAD_PRESET', hint: 'Cloudinary → Settings → Upload presets', placeholder: '' },
    ],
    patterns: [/\bcloudinary\b/i],
  },
  {
    service: 'Deepgram',
    description: 'Speech-to-text / transcription',
    keys: [{ name: 'API Key', envName: 'DEEPGRAM_API_KEY', hint: 'console.deepgram.com → API Keys', placeholder: '' }],
    patterns: [/\bdeeepgram\b/i, /\bdeepgram\b/i],
  },
  {
    service: 'Hugging Face',
    description: 'Open-source AI models',
    keys: [{ name: 'API Token', envName: 'HUGGINGFACE_TOKEN', hint: 'huggingface.co/settings/tokens', placeholder: 'hf_...' }],
    patterns: [/hugging\s*face/i, /\bhuggingface\b/i],
  },
  {
    service: 'Resend',
    description: 'Email sending API',
    keys: [{ name: 'API Key', envName: 'RESEND_API_KEY', hint: 'resend.com/api-keys', placeholder: 're_...' }],
    patterns: [/\bresend\b/i],
  },
  {
    service: 'Twilio',
    description: 'SMS & voice calls',
    keys: [
      { name: 'Account SID', envName: 'TWILIO_ACCOUNT_SID', hint: 'console.twilio.com → Dashboard', placeholder: 'AC...', isSecret: false },
      { name: 'Auth Token', envName: 'TWILIO_AUTH_TOKEN', hint: 'console.twilio.com → Dashboard', placeholder: '' },
    ],
    patterns: [/\btwilio\b/i],
  },
  {
    service: 'OpenWeatherMap',
    description: 'Weather data',
    keys: [{ name: 'API Key', envName: 'OPENWEATHER_API_KEY', hint: 'openweathermap.org/api_keys', placeholder: '' }],
    patterns: [/open\s*weather/i, /openweather/i],
  },
  {
    service: 'Lemon Squeezy',
    description: 'Payments for SaaS',
    keys: [{ name: 'API Key', envName: 'LEMONSQUEEZY_API_KEY', hint: 'app.lemonsqueezy.com/settings/api', placeholder: '' }],
    patterns: [/lemon\s*squeezy/i],
  },
  {
    service: 'Pexels',
    description: 'Free stock photos & videos',
    keys: [{ name: 'API Key', envName: 'PEXELS_API_KEY', hint: 'www.pexels.com/api/new/', placeholder: '' }],
    patterns: [/\bpexels\b/i],
  },
  {
    service: 'Unsplash',
    description: 'Free stock photos',
    keys: [{ name: 'Access Key', envName: 'UNSPLASH_ACCESS_KEY', hint: 'unsplash.com/oauth/applications', placeholder: '' }],
    patterns: [/\bunsplash\b/i],
  },
];

// Detect integration intent in a message
const INTENT_RE = /\b(integrat|connect|add|use|set\s*up|implement|enable|hook\s*up|incorporat|embed|include|build\s*with|plug\s*in)\b/i;
const API_CTX_RE = /\b(api|sdk|key|token|library|lib|endpoint|integration)\b/i;

export interface DetectedIntegration {
  def: IntegrationDef;
  missingKeys: ServiceKeyDef[];
}

export function detectIntegrations(
  message: string,
  storedSecrets: Record<string, string>
): DetectedIntegration[] {
  const hasIntent = INTENT_RE.test(message);
  const hasApiCtx = API_CTX_RE.test(message);
  if (!hasIntent && !hasApiCtx) return [];

  const results: DetectedIntegration[] = [];
  for (const def of KNOWN_INTEGRATIONS) {
    if (!def.patterns.some((p) => p.test(message))) continue;
    const missing = def.keys.filter((k) => !storedSecrets[k.envName]);
    if (missing.length > 0) results.push({ def, missingKeys: missing });
  }
  return results;
}
