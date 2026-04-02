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
  /** Patterns matched against the user's chat message to suggest adding a key upfront */
  patterns: RegExp[];
  /**
   * Stricter patterns matched against generated file contents.
   * Must indicate actual API usage (SDK init, window.ENV access, API endpoint call).
   * If omitted, falls back to `patterns`. If provided, ONLY these are used for file scanning.
   */
  codePatterns?: RegExp[];
}

export const KNOWN_INTEGRATIONS: IntegrationDef[] = [
  {
    service: 'ElevenLabs',
    description: 'Text-to-speech',
    keys: [{ name: 'API Key', envName: 'ELEVENLABS_API_KEY', hint: 'elevenlabs.io → Profile → API Keys', placeholder: 'sk_...' }],
    patterns: [/eleven\s*labs?/i],
    codePatterns: [/window\.ENV\.ELEVENLABS_API_KEY/i, /ElevenLabsClient\s*\(/i, /elevenlabs\.io\/v1/i],
  },
  {
    service: 'OpenAI',
    description: 'GPT / Chat / Embeddings',
    keys: [{ name: 'API Key', envName: 'OPENAI_API_KEY', hint: 'platform.openai.com/api-keys', placeholder: 'sk-...' }],
    patterns: [/openai/i, /\bgpt-?[34o]\b/i],
    codePatterns: [/window\.ENV\.OPENAI_API_KEY/i, /new OpenAI\s*\(/i, /api\.openai\.com/i],
  },
  {
    service: 'Anthropic',
    description: 'Claude AI',
    keys: [{ name: 'API Key', envName: 'ANTHROPIC_API_KEY', hint: 'console.anthropic.com → API Keys', placeholder: 'sk-ant-...' }],
    patterns: [/\banthropic\b/i, /\bclaude\s+ai\b/i],
    codePatterns: [/window\.ENV\.ANTHROPIC_API_KEY/i, /new Anthropic\s*\(/i, /api\.anthropic\.com/i],
  },
  {
    service: 'Stripe',
    description: 'Payment processing',
    keys: [{ name: 'Publishable Key', envName: 'STRIPE_PUBLISHABLE_KEY', hint: 'dashboard.stripe.com → Developers → API keys', placeholder: 'pk_live_... or pk_test_...' }],
    patterns: [/\bstripe\b/i],
    codePatterns: [/window\.ENV\.STRIPE_PUBLISHABLE_KEY/i, /loadStripe\s*\(/i, /stripe\.com\/v\d/i, /Stripe\s*\(window\.ENV/i],
  },
  {
    service: 'Google Maps',
    description: 'Maps & geocoding',
    keys: [{ name: 'API Key', envName: 'GOOGLE_MAPS_API_KEY', hint: 'console.cloud.google.com → APIs & Services → Credentials', placeholder: 'AIza...' }],
    patterns: [/google\s*maps?/i],
    codePatterns: [/window\.ENV\.GOOGLE_MAPS_API_KEY/i, /maps\.googleapis\.com/i, /GoogleMap\s*[({<]/i],
  },
  {
    service: 'Mapbox',
    description: 'Maps & location',
    keys: [{ name: 'Access Token', envName: 'MAPBOX_TOKEN', hint: 'account.mapbox.com → Access tokens', placeholder: 'pk.eyJ1...' }],
    patterns: [/\bmapbox\b/i],
    codePatterns: [/window\.ENV\.MAPBOX_TOKEN/i, /mapboxgl\s*\./i, /api\.mapbox\.com/i],
  },
  {
    service: 'Firebase',
    description: 'Google Firebase',
    keys: [
      { name: 'API Key', envName: 'FIREBASE_API_KEY', hint: 'Firebase Console → Project Settings → Your apps', placeholder: 'AIza...' },
      { name: 'Project ID', envName: 'FIREBASE_PROJECT_ID', hint: 'Firebase Console → Project Settings', placeholder: 'my-project-id', isSecret: false },
    ],
    patterns: [/\bfirebase\b/i],
    codePatterns: [/window\.ENV\.FIREBASE_API_KEY/i, /initializeApp\s*\(/i, /firebase\.app\(\)/i],
  },
  {
    service: 'Pusher',
    description: 'Real-time events & channels',
    keys: [
      { name: 'App Key', envName: 'PUSHER_APP_KEY', hint: 'dashboard.pusher.com → App Keys', placeholder: '' },
      { name: 'Cluster', envName: 'PUSHER_CLUSTER', hint: 'e.g. us2, eu, ap1', placeholder: 'us2', isSecret: false },
    ],
    patterns: [/\bpusher\b/i],
    codePatterns: [/window\.ENV\.PUSHER_APP_KEY/i, /new Pusher\s*\(/i],
  },
  {
    service: 'Algolia',
    description: 'Search & discovery',
    keys: [
      { name: 'Application ID', envName: 'ALGOLIA_APP_ID', hint: 'Algolia Dashboard → Settings → API Keys', placeholder: '', isSecret: false },
      { name: 'Search API Key', envName: 'ALGOLIA_SEARCH_KEY', hint: 'Algolia Dashboard → Settings → API Keys', placeholder: '' },
    ],
    patterns: [/\balgolia\b/i],
    codePatterns: [/window\.ENV\.ALGOLIA_APP_ID/i, /algoliasearch\s*\(/i],
  },
  {
    service: 'Cloudinary',
    description: 'Image & video management',
    keys: [
      { name: 'Cloud Name', envName: 'CLOUDINARY_CLOUD_NAME', hint: 'cloudinary.com/console', placeholder: 'my-cloud', isSecret: false },
      { name: 'Upload Preset', envName: 'CLOUDINARY_UPLOAD_PRESET', hint: 'Cloudinary → Settings → Upload presets', placeholder: '' },
    ],
    patterns: [/\bcloudinary\b/i],
    codePatterns: [/window\.ENV\.CLOUDINARY_CLOUD_NAME/i, /cloudinary\.com\/.*\/upload/i, /window\.cloudinary/i],
  },
  {
    service: 'Deepgram',
    description: 'Speech-to-text / transcription',
    keys: [{ name: 'API Key', envName: 'DEEPGRAM_API_KEY', hint: 'console.deepgram.com → API Keys', placeholder: '' }],
    patterns: [/\bdeeepgram\b/i, /\bdeepgram\b/i],
    codePatterns: [/window\.ENV\.DEEPGRAM_API_KEY/i, /createClient.*deepgram/i, /api\.deepgram\.com/i],
  },
  {
    service: 'Hugging Face',
    description: 'Open-source AI models',
    keys: [{ name: 'API Token', envName: 'HUGGINGFACE_TOKEN', hint: 'huggingface.co/settings/tokens', placeholder: 'hf_...' }],
    patterns: [/hugging\s*face/i, /\bhuggingface\b/i],
    codePatterns: [/window\.ENV\.HUGGINGFACE_TOKEN/i, /api-inference\.huggingface\.co/i],
  },
  {
    service: 'Resend',
    description: 'Email sending API',
    keys: [{ name: 'API Key', envName: 'RESEND_API_KEY', hint: 'resend.com/api-keys', placeholder: 're_...' }],
    patterns: [/\bresend\b/i],
    codePatterns: [/window\.ENV\.RESEND_API_KEY/i, /api\.resend\.com/i, /new Resend\s*\(/i],
  },
  {
    service: 'Twilio',
    description: 'SMS & voice calls',
    keys: [
      { name: 'Account SID', envName: 'TWILIO_ACCOUNT_SID', hint: 'console.twilio.com → Dashboard', placeholder: 'AC...', isSecret: false },
      { name: 'Auth Token', envName: 'TWILIO_AUTH_TOKEN', hint: 'console.twilio.com → Dashboard', placeholder: '' },
    ],
    patterns: [/\btwilio\b/i],
    codePatterns: [/window\.ENV\.TWILIO_ACCOUNT_SID/i, /api\.twilio\.com/i],
  },
  {
    service: 'OpenWeatherMap',
    description: 'Weather data',
    keys: [{ name: 'API Key', envName: 'OPENWEATHER_API_KEY', hint: 'openweathermap.org/api_keys', placeholder: '' }],
    patterns: [/open\s*weather/i, /openweather/i],
    codePatterns: [/window\.ENV\.OPENWEATHER_API_KEY/i, /api\.openweathermap\.org/i],
  },
  {
    service: 'Lemon Squeezy',
    description: 'Payments for SaaS',
    keys: [{ name: 'API Key', envName: 'LEMONSQUEEZY_API_KEY', hint: 'app.lemonsqueezy.com/settings/api', placeholder: '' }],
    patterns: [/lemon\s*squeezy/i],
    codePatterns: [/window\.ENV\.LEMONSQUEEZY_API_KEY/i, /api\.lemonsqueezy\.com/i],
  },
  {
    service: 'Pexels',
    description: 'Free stock photos & videos',
    keys: [{ name: 'API Key', envName: 'PEXELS_API_KEY', hint: 'www.pexels.com/api/new/', placeholder: '' }],
    patterns: [/\bpexels\b/i],
    codePatterns: [/window\.ENV\.PEXELS_API_KEY/i, /api\.pexels\.com/i],
  },
  {
    service: 'Unsplash',
    description: 'Free stock photos',
    keys: [{ name: 'Access Key', envName: 'UNSPLASH_ACCESS_KEY', hint: 'unsplash.com/oauth/applications', placeholder: '' }],
    patterns: [/\bunsplash\b/i],
    codePatterns: [/window\.ENV\.UNSPLASH_ACCESS_KEY/i, /api\.unsplash\.com/i],
  },
];

export interface DetectedIntegration {
  def: IntegrationDef;
  missingKeys: ServiceKeyDef[];
}

// Intent verbs that indicate the user wants to USE a service (not just mention it)
const INTENT_PATTERN = /\b(use|add|integrate|connect|call|send|fetch|embed|include|implement|build|create|make|enable|set\s*up|hook\s*up|plug\s*in|show|display|generate|get|pull|search)\b/i;

/**
 * Detects third-party integrations mentioned in a user's chat message.
 * Requires both a service name match AND an action/intent verb nearby to avoid
 * false positives when the user just mentions a service name in passing text.
 */
export function detectIntegrations(
  message: string,
  storedSecrets: Record<string, string>
): DetectedIntegration[] {
  // Only trigger if the message also contains an intent verb — prevents false positives
  // like "I'm a developer who has worked with OpenAI" from prompting for an API key.
  if (!INTENT_PATTERN.test(message)) return [];
  const results: DetectedIntegration[] = [];
  for (const def of KNOWN_INTEGRATIONS) {
    if (!def.patterns.some((p) => p.test(message))) continue;
    const missing = def.keys.filter((k) => !storedSecrets[k.envName]);
    if (missing.length > 0) results.push({ def, missingKeys: missing });
  }
  return results;
}

/**
 * Scans generated file contents for integration usage.
 * Uses strict `codePatterns` (actual API calls / SDK usage / window.ENV access)
 * to avoid false positives from service names mentioned in static text or comments.
 */
export function detectIntegrationsInFiles(
  files: Record<string, string>,
  storedSecrets: Record<string, string>
): DetectedIntegration[] {
  const allContent = Object.values(files).join('\n');
  const results: DetectedIntegration[] = [];
  for (const def of KNOWN_INTEGRATIONS) {
    // Use codePatterns (strict) when available, else broad patterns
    const patternsToUse = def.codePatterns ?? def.patterns;
    if (!patternsToUse.some((p) => p.test(allContent))) continue;
    const missing = def.keys.filter((k) => !storedSecrets[k.envName]);
    if (missing.length > 0) results.push({ def, missingKeys: missing });
  }
  return results;
}
