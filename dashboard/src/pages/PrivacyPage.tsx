import React from 'react';
import PublicNavbar from '../components/PublicNavbar';
import PublicFooter from '../components/PublicFooter';
import { Link } from 'react-router-dom';

const EFFECTIVE_DATE = 'January 1, 2025';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10 scroll-mt-24">
      <h2 className="text-xl font-black text-slate-900 dark:text-white mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">{title}</h2>
      <div className="space-y-3 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{children}</div>
    </section>
  );
}

const TOC = [
  { id: 'information-we-collect', label: 'Information We Collect' },
  { id: 'how-we-use-information', label: 'How We Use Your Information' },
  { id: 'data-sharing',           label: 'Data Sharing & Disclosure' },
  { id: 'data-security',          label: 'Data Security' },
  { id: 'retention',              label: 'Data Retention' },
  { id: 'your-rights',            label: 'Your Rights' },
  { id: 'cookies',                label: 'Cookies & Tracking' },
  { id: 'whatsapp-data',          label: 'WhatsApp Data' },
  { id: 'children',               label: 'Children\'s Privacy' },
  { id: 'changes',                label: 'Changes to This Policy' },
  { id: 'contact-privacy',        label: 'Contact Us' },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-white">
      <PublicNavbar />

      <div className="max-w-6xl mx-auto px-6 pt-32 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12">

          {/* Sidebar TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Contents</div>
              <nav className="space-y-1">
                {TOC.map(({ id, label }) => (
                  <a
                    key={id}
                    href={`#${id}`}
                    className="block text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 py-1.5 border-l-2 border-transparent hover:border-blue-500 pl-3 transition-all"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main content */}
          <main className="lg:col-span-3">
            <div className="mb-10">
              <div className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Legal</div>
              <h1 className="text-4xl font-black tracking-tighter mb-3">Privacy Policy</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">Effective date: <strong>{EFFECTIVE_DATE}</strong></p>
            </div>

            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl mb-10 text-sm text-blue-700 dark:text-blue-300">
              <strong>Summary:</strong> We collect only what we need to run PropDigest. We never sell your data. Your WhatsApp listing data belongs to you and is isolated to your account.
            </div>

            <Section id="information-we-collect" title="1. Information We Collect">
              <p><strong className="text-slate-800 dark:text-slate-200">Account information:</strong> When you create an account via Clerk, we receive your name, email address, and profile picture (if provided via Google/GitHub OAuth).</p>
              <p><strong className="text-slate-800 dark:text-slate-200">WhatsApp session data:</strong> We store your WhatsApp session credentials (encrypted) and the IDs of groups you choose to monitor. We do not store your full message history — only parsed listing data extracted from messages.</p>
              <p><strong className="text-slate-800 dark:text-slate-200">Parsed listing data:</strong> Price, location, property configuration, furnishing status, and intent — extracted from messages in your selected groups.</p>
              <p><strong className="text-slate-800 dark:text-slate-200">Usage data:</strong> Standard server logs including IP addresses, browser type, pages visited, and timestamps. Used for security monitoring and improving the service.</p>
            </Section>

            <Section id="how-we-use-information" title="2. How We Use Your Information">
              <ul className="list-disc list-inside space-y-2">
                <li>Provide, maintain, and improve the PropDigest service</li>
                <li>Authenticate your account and maintain your session</li>
                <li>Parse and structure WhatsApp messages from your selected groups</li>
                <li>Display analytics and market insights on your dashboard</li>
                <li>Send service-related notifications (account security, downtime)</li>
                <li>Respond to your support requests</li>
                <li>Comply with legal obligations</li>
              </ul>
              <p>We do <strong className="text-slate-800 dark:text-slate-200">not</strong> use your data for advertising, profiling, or training ML models for third parties.</p>
            </Section>

            <Section id="data-sharing" title="3. Data Sharing & Disclosure">
              <p><strong className="text-slate-800 dark:text-slate-200">We do not sell your data.</strong> We do not share your personal information or listing data with third parties for commercial purposes.</p>
              <p>We share data only in limited circumstances:</p>
              <ul className="list-disc list-inside space-y-2">
                <li><strong className="text-slate-800 dark:text-slate-200">Service providers:</strong> Neon (database hosting), Clerk (authentication), Groq (AI parsing) — each under strict data processing agreements.</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Legal requirements:</strong> If required by law, court order, or governmental authority.</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Business transfers:</strong> In the event of a merger or acquisition, with appropriate notice to you.</li>
              </ul>
            </Section>

            <Section id="data-security" title="4. Data Security">
              <p>We implement industry-standard security measures: TLS encryption in transit, encrypted storage at rest, and access controls limiting who can reach your data.</p>
              <p>WhatsApp session credentials are stored encrypted. No human on our team can read your messages — only the automated parsing pipeline processes them.</p>
              <p>No security system is perfect. We encourage you to use a strong password and report any suspicious activity to <a href="mailto:security@propdigest.in" className="text-blue-600 hover:underline">security@propdigest.in</a>.</p>
            </Section>

            <Section id="retention" title="5. Data Retention">
              <p>We retain your account data for as long as your account is active. Parsed listing data is retained for up to 90 days by default. You can request deletion at any time.</p>
              <p>WhatsApp session data is deleted immediately upon disconnecting your WhatsApp from the Settings page.</p>
            </Section>

            <Section id="your-rights" title="6. Your Rights">
              <p>Depending on your jurisdiction, you may have the right to:</p>
              <ul className="list-disc list-inside space-y-2">
                <li><strong className="text-slate-800 dark:text-slate-200">Access:</strong> Request a copy of the personal data we hold about you.</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Rectification:</strong> Correct inaccurate personal data.</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Erasure:</strong> Request deletion of your account and all associated data.</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Portability:</strong> Receive your listing data in a machine-readable format (CSV export).</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Objection:</strong> Object to certain processing activities.</li>
              </ul>
              <p>To exercise any of these rights, contact us at <Link to="/contact" className="text-blue-600 hover:underline">our contact page</Link> or email <a href="mailto:privacy@propdigest.in" className="text-blue-600 hover:underline">privacy@propdigest.in</a>.</p>
            </Section>

            <Section id="cookies" title="7. Cookies & Tracking">
              <p>We use essential cookies only — session cookies required for authentication and CSRF protection. We do not use advertising cookies or third-party tracking pixels.</p>
              <p>You can disable cookies in your browser, but this will prevent you from signing in to PropDigest.</p>
            </Section>

            <Section id="whatsapp-data" title="8. WhatsApp Data">
              <p>PropDigest connects to WhatsApp via the Baileys library using your personal WhatsApp account. By connecting your account, you acknowledge that:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>You are responsible for ensuring you have permission to monitor and process messages from selected groups.</li>
                <li>We only read messages from groups you explicitly select — we do not access your private chats.</li>
                <li>Message content is processed by our AI parsing system but not stored in raw form — only structured extracted data is retained.</li>
                <li>Using third-party tools with WhatsApp may be subject to WhatsApp's Terms of Service.</li>
              </ul>
            </Section>

            <Section id="children" title="9. Children's Privacy">
              <p>PropDigest is not directed at children under 18. We do not knowingly collect personal information from minors. If you believe a minor has provided us with personal information, please contact us.</p>
            </Section>

            <Section id="changes" title="10. Changes to This Policy">
              <p>We may update this Privacy Policy from time to time. We'll notify you of material changes via email or an in-app notice at least 14 days before the change takes effect. Continued use of the service after that date constitutes acceptance.</p>
            </Section>

            <Section id="contact-privacy" title="11. Contact Us">
              <p>For privacy-related questions or requests:</p>
              <ul className="list-none space-y-1">
                <li><strong className="text-slate-800 dark:text-slate-200">Email:</strong> <a href="mailto:privacy@propdigest.in" className="text-blue-600 hover:underline">privacy@propdigest.in</a></li>
                <li><strong className="text-slate-800 dark:text-slate-200">Form:</strong> <Link to="/contact" className="text-blue-600 hover:underline">Contact page</Link></li>
              </ul>
            </Section>
          </main>
        </div>
      </div>

      <PublicFooter />
    </div>
  );
}
