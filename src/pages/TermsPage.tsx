import { Link } from 'react-router-dom';
import MarketingLayout from '../components/MarketingLayout';

const LAST_UPDATED = 'April 3, 2026';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    content: `By creating an account or using AYACODA AI Studio (the "Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Service. These Terms constitute a legally binding agreement between you and AYACODA AI Studio ("we", "our", or "us").`,
  },
  {
    title: '2. Eligibility',
    content: `You must be at least 13 years old (or 16 in the European Union) to use the Service. By using the Service, you represent that you meet this requirement. If you are using the Service on behalf of an organisation, you represent that you have the authority to bind that organisation to these Terms.`,
  },
  {
    title: '3. Your Account',
    content: `You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must immediately notify us of any unauthorised use of your account. We reserve the right to suspend or terminate accounts that violate these Terms or that have been inactive for an extended period.`,
  },
  {
    title: '4. Credits and Billing',
    content: `The Service operates on a credit-based system. Free accounts receive a one-time grant of 100 credits on sign-up. Subscription plans include monthly credit allocations that reset on each billing cycle and do not carry over. Credit packs are one-time purchases and do not expire.

All payments are processed by Stripe. By providing payment information, you authorise us to charge the amounts you authorise. Subscription fees are charged in advance on a recurring monthly basis. Refunds are issued at our discretion on a case-by-case basis.

We reserve the right to adjust credit costs for AI actions with reasonable notice. We will not retroactively change the cost of actions already completed.`,
  },
  {
    title: '5. Acceptable Use',
    content: `You agree not to use the Service to:

• Generate, distribute, or deploy malicious software, malware, or code designed to harm systems or users
• Build apps that violate applicable laws or regulations
• Infringe the intellectual property rights of others
• Generate content that is illegal, defamatory, harassing, or harmful
• Circumvent credit limits, authentication, or other Service restrictions
• Resell or sublicense access to the Service without written authorisation
• Use automated tools to abuse or overload the Service

We reserve the right to suspend or terminate your account if we determine, in our sole discretion, that you have violated these terms.`,
  },
  {
    title: '6. Intellectual Property',
    content: `You retain ownership of all prompts you submit and all code generated on your behalf through the Service. We do not claim ownership of your generated apps.

The AYACODA AI Studio platform, including all software, design, and branding, is owned by us and protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works of the platform itself.

Generated code may incorporate patterns, libraries, or techniques from the AI model's training data. We make no warranty that generated code is free from third-party IP claims. You are responsible for reviewing generated code before commercial deployment.`,
  },
  {
    title: '7. AI-Generated Content',
    content: `The Service uses third-party AI models (Anthropic Claude, OpenAI GPT-4o, Google Gemini) to generate code and content. We do not guarantee that generated code will be:

• Correct, bug-free, or fit for a particular purpose
• Free from security vulnerabilities
• Compliant with any specific regulatory or licensing requirements

You are responsible for reviewing, testing, and validating all generated code before deployment to production environments. The auto bug-fix engine is a convenience feature and does not guarantee correctness.`,
  },
  {
    title: '8. Third-Party Services',
    content: `The Service integrates with third-party services including Supabase, AWS S3, Vercel, and Stripe. Your use of these services is subject to their respective terms and privacy policies. We are not responsible for the availability, conduct, or content of third-party services.`,
  },
  {
    title: '9. Limitation of Liability',
    content: `To the maximum extent permitted by applicable law, AYACODA AI Studio and its affiliates, officers, employees, and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.

Our total liability to you for any claim arising out of or related to these Terms or the Service shall not exceed the total amount you paid us in the twelve months preceding the claim.`,
  },
  {
    title: '10. Disclaimer of Warranties',
    content: `The Service is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, express or implied. We do not warrant that the Service will be uninterrupted, error-free, or that generated content will meet your requirements.`,
  },
  {
    title: '11. Indemnification',
    content: `You agree to indemnify and hold harmless AYACODA AI Studio and its affiliates from any claims, damages, losses, or expenses (including reasonable legal fees) arising from: (a) your use of the Service; (b) any generated code you deploy; (c) your violation of these Terms; or (d) your infringement of any third-party rights.`,
  },
  {
    title: '12. Termination',
    content: `Either party may terminate these Terms at any time. You may terminate by deleting your account. We may terminate or suspend your access at any time for violation of these Terms or for any other reason with reasonable notice.

On termination, your right to use the Service ceases immediately. Sections 6, 9, 10, 11, and 13 survive termination.`,
  },
  {
    title: '13. Governing Law',
    content: `These Terms are governed by the laws of Australia without regard to its conflict of law provisions. Any disputes shall be resolved in the courts of New South Wales, Australia, except where prohibited by applicable consumer protection law in your jurisdiction.`,
  },
  {
    title: '14. Changes to Terms',
    content: `We may update these Terms at any time. If we make material changes, we will notify you via email or an in-app notice at least 14 days before the new Terms take effect. Your continued use of the Service after the effective date constitutes acceptance.`,
  },
  {
    title: '15. Contact',
    content: `Questions about these Terms? Contact us at legal@ayacoda.ai.`,
  },
];

export default function TermsPage() {
  return (
    <MarketingLayout>
      <div className="py-16 px-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-zinc-700 bg-zinc-800/50 text-zinc-400 text-[11px] font-medium mb-5">
            Last updated: {LAST_UPDATED}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Terms of Service</h1>
          <p className="text-[14px] text-zinc-400 leading-relaxed">
            Please read these Terms of Service carefully before using AYACODA AI Studio. By using our
            platform, you agree to be bound by these terms.
          </p>
          <div className="mt-5 flex items-center gap-3 text-[12px] text-zinc-600">
            <span>Also see:</span>
            <Link to="/privacy" className="text-indigo-400 hover:text-indigo-300 transition-colors">Privacy Policy</Link>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="text-[16px] font-semibold text-zinc-100 mb-3">{section.title}</h2>
              <p className="text-[13px] text-zinc-500 leading-relaxed whitespace-pre-line">{section.content}</p>
            </div>
          ))}
        </div>
      </div>
    </MarketingLayout>
  );
}
