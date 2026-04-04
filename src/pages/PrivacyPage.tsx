import MarketingLayout from '../components/MarketingLayout';

const LAST_UPDATED = 'April 3, 2026';

const SECTIONS = [
  {
    title: '1. Information We Collect',
    content: [
      {
        heading: 'Account information',
        text: 'When you create an account, we collect your email address and the name or username you provide. This information is required to authenticate you and manage your account.',
      },
      {
        heading: 'Usage data',
        text: 'We collect information about how you use the Service, including prompts you submit, files generated, and features accessed. This data is used to improve generation quality and detect abuse.',
      },
      {
        heading: 'Payment information',
        text: 'Credit card and payment details are processed by Stripe and are never stored on our servers. We receive confirmation of successful payments and your Stripe customer ID.',
      },
      {
        heading: 'Technical data',
        text: 'We collect browser type, IP address, and basic device information for security, fraud prevention, and analytics purposes.',
      },
    ],
  },
  {
    title: '2. How We Use Your Information',
    content: [
      {
        heading: 'To provide the Service',
        text: 'We use your account data to authenticate you, run AI generation requests on your behalf, and store your projects.',
      },
      {
        heading: 'To improve the Service',
        text: 'Aggregated and anonymised usage patterns help us improve generation quality, prioritise features, and debug issues.',
      },
      {
        heading: 'To send transactional emails',
        text: 'We send emails for account verification, billing receipts, and important service updates. We do not send marketing emails without explicit opt-in.',
      },
      {
        heading: 'To prevent abuse',
        text: 'We monitor for automated abuse, credit fraud, and violations of our Terms of Service to protect all users.',
      },
    ],
  },
  {
    title: '3. Data Storage and Security',
    content: [
      {
        heading: 'Data storage',
        text: 'Your account data, generated projects, and file uploads are stored in Supabase (PostgreSQL + Storage) hosted on AWS in the Asia-Pacific (Sydney) region.',
      },
      {
        heading: 'Security measures',
        text: 'We use TLS encryption in transit, row-level security policies in PostgreSQL, and service-role key isolation to protect your data. Access to production databases is strictly limited.',
      },
      {
        heading: 'Data retention',
        text: 'Project data is retained for as long as your account is active. If you delete a project, its database schema and files are removed immediately. If you delete your account, all associated data is removed within 30 days.',
      },
    ],
  },
  {
    title: '4. Third-Party Services',
    content: [
      {
        heading: 'AI model providers',
        text: 'Your prompts and generated code are processed by Anthropic (Claude), OpenAI (GPT-4o), and Google (Gemini). Submissions are subject to each provider\'s usage policy. We do not send personally identifiable information to these providers beyond what is in your prompt.',
      },
      {
        heading: 'Stripe',
        text: 'Billing is handled by Stripe. When you make a payment, your payment details are submitted directly to Stripe. We receive a payment confirmation and a customer reference ID. Stripe\'s privacy policy applies to all payment data.',
      },
      {
        heading: 'Vercel',
        text: 'When you use the one-click deployment feature, your generated project files are sent to Vercel to create a deployment. Your use of the deployed URL is subject to Vercel\'s terms.',
      },
      {
        heading: 'Supabase',
        text: 'Authentication, database, and storage services are provided by Supabase. Supabase\'s privacy policy applies to data stored in these systems.',
      },
    ],
  },
  {
    title: '5. Cookies and Tracking',
    content: [
      {
        heading: 'Session cookies',
        text: 'We use session cookies set by Supabase Auth to keep you logged in. These are strictly necessary for the Service to function.',
      },
      {
        heading: 'No tracking or analytics cookies',
        text: 'We do not currently use third-party analytics, advertising networks, or tracking pixels. We do not sell your data to any third party.',
      },
    ],
  },
  {
    title: '6. Your Rights',
    content: [
      {
        heading: 'Access and portability',
        text: 'You can export your generated projects as Vite zip files at any time from the editor. To request a full export of your account data, contact us at privacy@ayacoda.ai.',
      },
      {
        heading: 'Deletion',
        text: 'You may delete individual projects from your dashboard at any time. To delete your account and all associated data, contact privacy@ayacoda.ai.',
      },
      {
        heading: 'Correction',
        text: 'To correct inaccurate account information, update your profile in-app or contact support.',
      },
      {
        heading: 'GDPR and CCPA',
        text: 'If you are located in the European Union or California, you have additional rights under the GDPR and CCPA respectively. Contact us at privacy@ayacoda.ai to exercise these rights.',
      },
    ],
  },
  {
    title: '7. Children\'s Privacy',
    content: [
      {
        heading: null,
        text: 'The Service is not directed to children under the age of 13 (or 16 in the EU). We do not knowingly collect personal information from children. If you believe a child has provided us personal data, contact us immediately at privacy@ayacoda.ai.',
      },
    ],
  },
  {
    title: '8. Changes to This Policy',
    content: [
      {
        heading: null,
        text: 'We may update this Privacy Policy from time to time. If we make material changes, we will notify you via email or a prominent in-app notice before the change takes effect. Your continued use of the Service after the effective date constitutes acceptance of the updated policy.',
      },
    ],
  },
  {
    title: '9. Contact Us',
    content: [
      {
        heading: null,
        text: 'For privacy-related questions or requests, contact us at privacy@ayacoda.ai. For general support, visit your account dashboard or email support@ayacoda.ai.',
      },
    ],
  },
];

export default function PrivacyPage() {
  return (
    <MarketingLayout>
      <div className="py-16 px-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[11px] font-medium mb-5">
            Last updated: {LAST_UPDATED}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-[14px] text-zinc-400 leading-relaxed">
            This Privacy Policy describes how AYACODA AI Studio ("we", "our", or "us") collects, uses, and
            protects information when you use our AI app-building platform and related services (the "Service").
            By using the Service, you agree to the practices described in this policy.
          </p>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="text-[16px] font-semibold text-zinc-100 mb-4">{section.title}</h2>
              <div className="space-y-4">
                {section.content.map((item, i) => (
                  <div key={i}>
                    {item.heading && (
                      <p className="text-[13px] font-semibold text-zinc-300 mb-1">{item.heading}</p>
                    )}
                    <p className="text-[13px] text-zinc-500 leading-relaxed">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
